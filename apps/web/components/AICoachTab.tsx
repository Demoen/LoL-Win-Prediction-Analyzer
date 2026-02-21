"use client";

import { useState } from "react";
import { coachAnalysis } from "@/lib/api";
import {
    Bot, Brain, Target, Eye, Activity, TrendingUp, AlertTriangle, CheckCircle,
    Swords, Coins, Shield, Crown, Sparkles, Send, Loader2,
    Copy, RotateCcw, Star, Flame, TrendingDown, Award, Zap, ChevronDown,
    ChevronUp, MessageSquare, BarChart3, Check
} from "lucide-react";

interface AICoachTabProps {
    lastMatchStats: any;
    winDrivers: any[];
    skillFocus: any[];
    playerMoods: any[];
    weightedAverages: any;
    enemyStats: any;
    winProbability: number;
    winRate: number;
    timelineSeries: any;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function moodColorClass(colorStr: string) {
    // colorStr from backend like "text-amber-400 border-amber-500/30"
    return colorStr || "text-[#C8A84B]";
}

const MOOD_ICONS: Record<string, React.ElementType> = {
    crown: Crown,
    flame: Flame,
    skull: Zap,
    sparkles: Sparkles,
    target: Target,
    eye: Eye,
    shield: Shield,
    swords: Swords,
    "trending-up": TrendingUp,
    "trending-down": TrendingDown,
    award: Award,
    star: Star,
    brain: Brain,
    bot: Bot,
    activity: Activity,
};

function getMoodIcon(iconName: string): React.ElementType {
    return MOOD_ICONS[iconName?.toLowerCase()] ?? Sparkles;
}

// Simple markdown-lite renderer: bold, headers, lists
function renderMarkdown(text: string) {
    const lines = text.split("\n");
    const elements: React.ReactNode[] = [];

    lines.forEach((line, i) => {
        if (!line.trim()) {
            elements.push(<div key={i} className="h-3" />);
            return;
        }

        // H2: ## heading
        if (/^##\s+/.test(line)) {
            elements.push(
                <h3 key={i} className="text-base font-black uppercase tracking-widest mt-6 mb-2" style={{ color: "#FFD870" }}>
                    {line.replace(/^##\s+/, "")}
                </h3>
            );
            return;
        }

        // H1: # heading
        if (/^#\s+/.test(line)) {
            elements.push(
                <h2 key={i} className="text-xl font-black uppercase tracking-widest mt-6 mb-3" style={{ color: "#FFD870" }}>
                    {line.replace(/^#\s+/, "")}
                </h2>
            );
            return;
        }

        // Bullet
        if (/^[-*•]\s+/.test(line)) {
            const content = line.replace(/^[-*•]\s+/, "");
            elements.push(
                <div key={i} className="flex items-start gap-2 mt-1">
                    <span className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full" style={{ background: "#C8A84B" }} />
                    <span className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.8)" }}>
                        {inlineBold(content)}
                    </span>
                </div>
            );
            return;
        }

        // Numbered list
        if (/^\d+\.\s+/.test(line)) {
            const num = line.match(/^(\d+)\./)?.[1];
            const content = line.replace(/^\d+\.\s+/, "");
            elements.push(
                <div key={i} className="flex items-start gap-3 mt-2">
                    <span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black" style={{ background: "rgba(200,168,75,0.15)", color: "#FFD870" }}>
                        {num}
                    </span>
                    <span className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.8)" }}>
                        {inlineBold(content)}
                    </span>
                </div>
            );
            return;
        }

        // Normal paragraph
        elements.push(
            <p key={i} className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.75)" }}>
                {inlineBold(line)}
            </p>
        );
    });

    return elements;
}

function inlineBold(text: string): React.ReactNode {
    const parts = text.split(/\*\*(.+?)\*\*/g);
    return parts.map((part, i) =>
        i % 2 === 1
            ? <strong key={i} style={{ color: "#FFD870" }}>{part}</strong>
            : part
    );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AICoachTab({
    lastMatchStats,
    winDrivers,
    skillFocus,
    playerMoods,
    weightedAverages,
    enemyStats,
    winProbability,
    winRate,
}: AICoachTabProps) {
    const [customPrompt, setCustomPrompt] = useState("");
    const [aiResponse, setAiResponse] = useState("");
    const [loading, setLoading] = useState(false);
    const [aiError, setAiError] = useState("");
    const [copied, setCopied] = useState(false);
    const [showPromptHelper, setShowPromptHelper] = useState(false);

    const m = lastMatchStats || {};
    const e = enemyStats || {};
    const avg = weightedAverages || {};
    const moods = playerMoods || [];
    const drivers = winDrivers || [];
    const focus = skillFocus || [];

    // ── Build stats context block for OpenAI ──
    const buildStatsContext = () => `You are a professional, high-elo League of Legends performance coach. You have reviewed the VOD and the following statistical data. Reply with structured, ruthlessly honest, and precise coaching feedback. Be direct.

## PLAYER PROFILE
- Win Rate: ${winRate.toFixed(1)}%
- ML Win Probability Score: ${winProbability.toFixed(1)}%
- Play Style Archetypes: ${moods.map((m: any) => m.title).join(", ")}

## LAST MATCH
- Champion: ${m.championName || "Unknown"}
- Result: ${m.win ? "WIN ✓" : "LOSS ✗"}
- KDA: ${m.kills || 0} / ${m.deaths || 0} / ${m.assists || 0}  (${(m.kda || 0).toFixed(2)} ratio)
- Kill Participation: ${((m.killParticipation || 0) * 100).toFixed(0)}%
- Game Duration: ${Math.floor((m.gameDuration || 0) / 60)}m ${(m.gameDuration || 0) % 60}s
- Solo Kills: ${m.soloKills || 0}
- Damage / min: ${(m.damagePerMinute || 0).toFixed(0)}
- Gold / min: ${(m.goldPerMinute || 0).toFixed(0)}
- CS / min: ${((m.totalMinionsKilled || 0) / ((m.gameDuration || 1) / 60)).toFixed(2)}
- Total CS: ${m.totalMinionsKilled || 0}
- Vision Score: ${m.visionScore || 0}
- Wards Placed: ${m.wardsPlaced || 0}
- Control Wards Bought: ${m.controlWardsPlaced || 0}
- Skillshot Hit Rate: ${(m.skillshotHitRate || 0).toFixed(1)}%
- Turret Plates Taken: ${m.turretPlatesTaken || 0}
- Gold + XP Lead @8m: ${m.earlyLaningPhaseGoldExpAdvantage || 0}
- Gold + XP Lead @14m: ${m.laningPhaseGoldExpAdvantage || 0}
- Max CS Lead vs Opponent: ${m.maxCsAdvantageOnLaneOpponent || 0}
- Max Level Lead vs Opponent: ${m.maxLevelLeadLaneOpponent || 0}
- Vision Score Advantage vs Laner: ${(m.visionScoreAdvantageLaneOpponent || 0).toFixed(1)}
- Objective Damage: ${m.damageDealtToObjectives || 0}
- CS @First 10 min: ${m.laneMinionsFirst10Minutes || 0}

## LANE OPPONENT (${e.championName || "Unknown"})
- KDA: ${(e.kda || 0).toFixed(2)}
- Damage / min: ${(e.damagePerMinute || 0).toFixed(0)}
- Gold / min: ${(e.goldPerMinute || 0).toFixed(0)}
- CS / min: ${((e.totalMinionsKilled || 0) / ((m.gameDuration || 1) / 60)).toFixed(2)}
- Vision Score: ${e.visionScore || 0}
- Control Wards: ${e.controlWardsPlaced || 0}
- Turret Plates: ${e.turretPlatesTaken || 0}

## WIN DRIVERS (Where Player Excelled)
${drivers.length > 0 ? drivers.map((d: any) => `- ${d.name}: ${d.value} (${d.diff_pct > 0 ? "+" : ""}${Math.round(d.diff_pct * 100)}% above baseline)`).join("\n") : "- No clear win drivers detected"}

## SKILL GAPS (Critical Improvements Needed)
${focus.length > 0 ? focus.map((f: any) => `- ${f.title}: Player ${typeof f.current === "number" ? f.current.toFixed(1) : f.current} vs Opponent ${typeof f.target === "number" ? f.target.toFixed(1) : f.target} (${Math.round(Math.abs((f.diff || 0) * 100))}% gap)\n  "${f.description}"`).join("\n") : "- No significant skill gaps detected"}

## WEIGHTED AVERAGES (Last N Matches)
- Avg KDA: ${(avg.kills || 0).toFixed(1)} / ${(avg.deaths || 0).toFixed(1)} / ${(avg.assists || 0).toFixed(1)}
- Avg Vision Score: ${(avg.visionScore || 0).toFixed(1)}
- Avg Gold Lead @14m: ${(avg.laneGoldLeadAt14 || 0).toFixed(0)}
- Avg CS Lead: ${(avg.maxCsAdvantageOnLaneOpponent || 0).toFixed(0)}
- Avg Skillshot Hit Rate: ${(avg.skillshotHitRate || 0).toFixed(1)}%
- Avg Skillshot Dodge Rate: ${(avg.skillshotDodgeRate || 0).toFixed(1)}%
- Aggression Score: ${(avg.aggressionScore || 0).toFixed(1)}

## STYLE PERSONALITY
${moods.map((mood: any) => `- ${mood.title}: ${mood.description}\n  Advice: "${mood.advice}"`).join("\n")}`;

    const DEFAULT_PROMPT = `Analyze this player's last match performance as a professional League of Legends coach. Structure your response as:

1. **Match Summary** – What happened overall and key turning points
2. **Lane Phase Verdict** – Specific lane phase mistakes and wins
3. **3 Critical Improvements** – The most impactful things to fix, with concrete exercises
4. **Strengths to Leverage** – What to keep doing and build on
5. **Mental/Macro Issues** – Decision-making, positioning, objective priority mistakes
6. **Coaching Prescription** – A specific drill or focus for the next 5 games

Be direct, analytical, and unfiltered. Reference specific stats.`;

    const handleAnalyze = async () => {
        setLoading(true);
        setAiError("");
        setAiResponse("");

        try {
            const content = await coachAnalysis(
                buildStatsContext(),
                customPrompt.trim() || DEFAULT_PROMPT,
            );
            setAiResponse(content || "No response received.");
        } catch (err: any) {
            setAiError(err.message || "Failed to reach the coaching service.");
        } finally {
            setLoading(false);
        }
    };

    const copyResponse = () => {
        navigator.clipboard.writeText(aiResponse ?? "");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    // ── Static coach report derived from existing data ──
    const hasDrivers = drivers.length > 0;
    const hasFocus = focus.length > 0;
    const won = !!m.win;
    const kda = m.kda || 0;
    const visionScore = m.visionScore || 0;
    const avgVision = avg.visionScore || 0;
    const visionGap = visionScore - avgVision;
    const goldLead14 = m.laningPhaseGoldExpAdvantage || 0;

    return (
        <div className="space-y-8">

            {/* ── STYLE SIGNATURE ───────────────────────────────── */}
            <section className="rounded-3xl overflow-hidden relative" style={{ background: "rgba(200,168,75,0.03)", border: "1px solid rgba(200,168,75,0.12)" }}>
                {/* Glow */}
                <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(200,168,75,0.06) 0%, transparent 70%)" }} />

                <div className="p-8">
                    {/* Header */}
                    <div className="flex items-center gap-4 mb-8">
                        <div className="p-3 rounded-xl" style={{ background: "rgba(200,168,75,0.08)", border: "1px solid rgba(200,168,75,0.18)" }}>
                            <Sparkles className="w-7 h-7" style={{ color: "#FFD870" }} />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black uppercase italic tracking-tighter" style={{ color: "#FFD870" }}>Style DNA</h2>
                            <p className="text-xs font-bold uppercase tracking-widest mt-0.5" style={{ color: "rgba(200,168,75,0.4)" }}>Player Archetype Analysis</p>
                        </div>
                        <div className="ml-auto flex gap-2 flex-wrap justify-end">
                            {moods.slice(0, 3).map((mood: any, i: number) => (
                                <span key={i} className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest" style={{ background: "rgba(200,168,75,0.1)", border: "1px solid rgba(200,168,75,0.2)", color: "#FFD870" }}>
                                    {mood.title}
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* Mood Cards */}
                    {moods.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {moods.map((mood: any, i: number) => {
                                const MoodIcon = getMoodIcon(mood.icon);
                                return (
                                    <div
                                        key={i}
                                        className="p-5 rounded-2xl relative overflow-hidden transition-all group"
                                        style={{ background: "rgba(200,168,75,0.025)", border: "1px solid rgba(200,168,75,0.1)" }}
                                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(200,168,75,0.3)"; (e.currentTarget as HTMLElement).style.background = "rgba(200,168,75,0.05)"; }}
                                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(200,168,75,0.1)"; (e.currentTarget as HTMLElement).style.background = "rgba(200,168,75,0.025)"; }}
                                    >
                                        {/* Rank badge */}
                                        <div className="absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black" style={{ background: "rgba(200,168,75,0.1)", color: "rgba(200,168,75,0.5)" }}>
                                            {i + 1}
                                        </div>

                                        <div className="flex items-center gap-3 mb-3">
                                            <div className="p-2.5 rounded-xl" style={{ background: "rgba(200,168,75,0.1)", border: "1px solid rgba(200,168,75,0.15)" }}>
                                                <MoodIcon className="w-5 h-5" style={{ color: "#FFD870" }} />
                                            </div>
                                            <h3 className="font-black text-sm uppercase tracking-wider" style={{ color: "#FFD870" }}>{mood.title}</h3>
                                        </div>

                                        <p className="text-xs leading-relaxed mb-4" style={{ color: "rgba(200,168,75,0.55)" }}>
                                            {mood.description}
                                        </p>

                                        <div className="p-3 rounded-xl" style={{ background: "rgba(200,168,75,0.06)", borderLeft: "2px solid rgba(200,168,75,0.3)" }}>
                                            <div className="text-[9px] font-black uppercase tracking-widest mb-1" style={{ color: "rgba(200,168,75,0.4)" }}>Coach Says</div>
                                            <p className="text-xs italic font-medium" style={{ color: "rgba(255,255,255,0.75)" }}>
                                                "{mood.advice}"
                                            </p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <p className="text-center py-8 italic" style={{ color: "rgba(200,168,75,0.35)" }}>No style data available.</p>
                    )}
                </div>
            </section>

            {/* ── STATIC AI COACH REPORT ────────────────────────── */}
            <section className="rounded-3xl overflow-hidden relative" style={{ background: "rgba(200,168,75,0.025)", border: "1px solid rgba(200,168,75,0.12)" }}>
                <div className="absolute -bottom-16 -left-16 w-64 h-64 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(200,168,75,0.04) 0%, transparent 70%)" }} />

                <div className="p-8 relative z-10">
                    <div className="flex items-center gap-4 mb-8">
                        <div className="p-3 rounded-xl" style={{ background: "rgba(200,168,75,0.08)", border: "1px solid rgba(200,168,75,0.18)" }}>
                            <Brain className="w-7 h-7" style={{ color: "#FFD870" }} />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black uppercase italic tracking-tighter" style={{ color: "#FFD870" }}>Coach Report</h2>
                            <p className="text-xs font-bold uppercase tracking-widest mt-0.5" style={{ color: "rgba(200,168,75,0.4)" }}>Last Match Intelligence</p>
                        </div>
                        <div className="ml-auto px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest" style={{ background: won ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", color: won ? "#4ade80" : "#f87171", border: `1px solid ${won ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)"}` }}>
                            {won ? "Victory" : "Defeat"} · {m.championName || "—"}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                        {/* ✅ What Went Well */}
                        <div className="p-5 rounded-2xl" style={{ background: "rgba(34,197,94,0.04)", border: "1px solid rgba(34,197,94,0.12)" }}>
                            <div className="flex items-center gap-2 mb-4 pb-4" style={{ borderBottom: "1px solid rgba(34,197,94,0.1)" }}>
                                <CheckCircle className="w-5 h-5 text-green-500" />
                                <h3 className="font-black text-sm uppercase tracking-wider text-green-400">Strengths</h3>
                            </div>
                            <div className="space-y-3">
                                {hasDrivers ? drivers.map((d: any, i: number) => (
                                    <div key={i} className="flex items-start gap-2">
                                        <div className="shrink-0 w-1.5 h-1.5 rounded-full mt-1.5 bg-green-500" />
                                        <div>
                                            <div className="text-xs font-bold text-green-300">{d.name}</div>
                                            <div className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>
                                                {typeof d.value === "number" ? d.value.toFixed(1) : d.value} · +{Math.round(Math.abs(d.diff_pct) * 100)}% above avg
                                            </div>
                                        </div>
                                    </div>
                                )) : (
                                    <p className="text-xs italic" style={{ color: "rgba(34,197,94,0.4)" }}>No dominant strengths — performance was balanced.</p>
                                )}
                            </div>
                        </div>

                        {/* ⚠️ Critical Issues */}
                        <div className="p-5 rounded-2xl" style={{ background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.12)" }}>
                            <div className="flex items-center gap-2 mb-4 pb-4" style={{ borderBottom: "1px solid rgba(239,68,68,0.1)" }}>
                                <AlertTriangle className="w-5 h-5 text-red-500" />
                                <h3 className="font-black text-sm uppercase tracking-wider text-red-400">Critical Gaps</h3>
                            </div>
                            <div className="space-y-3">
                                {hasFocus ? focus.map((f: any, i: number) => (
                                    <div key={i} className="flex items-start gap-2">
                                        <div className="shrink-0 w-1.5 h-1.5 rounded-full mt-1.5 bg-red-500" />
                                        <div>
                                            <div className="text-xs font-bold text-red-300">{f.title}</div>
                                            <div className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>
                                                {Math.round(Math.abs((f.diff || 0) * 100))}% gap · {f.description?.slice(0, 60)}
                                                {(f.description?.length || 0) > 60 ? "…" : ""}
                                            </div>
                                        </div>
                                    </div>
                                )) : (
                                    <p className="text-xs italic" style={{ color: "rgba(239,68,68,0.4)" }}>No major gaps found vs. opponent.</p>
                                )}
                            </div>
                        </div>

                        {/* 📊 Performance Snapshot */}
                        <div className="p-5 rounded-2xl" style={{ background: "rgba(200,168,75,0.03)", border: "1px solid rgba(200,168,75,0.1)" }}>
                            <div className="flex items-center gap-2 mb-4 pb-4" style={{ borderBottom: "1px solid rgba(200,168,75,0.08)" }}>
                                <BarChart3 className="w-5 h-5" style={{ color: "#C8A84B" }} />
                                <h3 className="font-black text-sm uppercase tracking-wider" style={{ color: "#C8A84B" }}>Snapshot</h3>
                            </div>
                            <div className="space-y-3">
                                {[
                                    {
                                        label: "KDA Ratio", value: kda.toFixed(2),
                                        good: kda >= 3, note: kda >= 3 ? "Strong game" : kda >= 2 ? "Average" : "Too many deaths"
                                    },
                                    {
                                        label: "Vision Score", value: visionScore.toFixed(0),
                                        good: visionGap >= 0, note: visionGap >= 0 ? "Above your avg" : `${Math.abs(visionGap).toFixed(0)} below avg`
                                    },
                                    {
                                        label: "Lane Phase @14m", value: goldLead14 > 0 ? `+${goldLead14}` : `${goldLead14}`,
                                        good: goldLead14 > 0, note: goldLead14 > 0 ? "Positive lead" : "Behind in lane"
                                    },
                                    {
                                        label: "CS / min", value: ((m.totalMinionsKilled || 0) / ((m.gameDuration || 1) / 60)).toFixed(1),
                                        good: ((m.totalMinionsKilled || 0) / ((m.gameDuration || 1) / 60)) >= 6,
                                        note: ((m.totalMinionsKilled || 0) / ((m.gameDuration || 1) / 60)) >= 7 ? "Excellent" : ((m.totalMinionsKilled || 0) / ((m.gameDuration || 1) / 60)) >= 6 ? "Acceptable" : "Needs work"
                                    },
                                    {
                                        label: "Damage / min", value: (m.damagePerMinute || 0).toFixed(0),
                                        good: (m.damagePerMinute || 0) > (e.damagePerMinute || 0),
                                        note: (m.damagePerMinute || 0) > (e.damagePerMinute || 0) ? "Outpacing enemy" : "Enemy outperforming"
                                    },
                                ].map((row, i) => (
                                    <div key={i} className="flex items-center justify-between text-xs">
                                        <span style={{ color: "rgba(200,168,75,0.5)" }}>{row.label}</span>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>{row.note}</span>
                                            <span className={`font-black font-mono ${row.good ? "text-green-400" : "text-red-400"}`}>{row.value}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Priority Improvements Footer */}
                    {hasFocus && (
                        <div className="mt-6 p-5 rounded-2xl" style={{ background: "rgba(200,168,75,0.04)", border: "1px solid rgba(200,168,75,0.1)" }}>
                            <div className="flex items-center gap-2 mb-4">
                                <Target className="w-4 h-4" style={{ color: "#C8A84B" }} />
                                <span className="text-xs font-black uppercase tracking-widest" style={{ color: "#C8A84B" }}>Priority Training Goals</span>
                            </div>
                            <div className="flex flex-wrap gap-3">
                                {focus.slice(0, 4).map((f: any, i: number) => (
                                    <div key={i} className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)", color: "rgba(255,255,255,0.7)" }}>
                                        <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black bg-red-500/20 text-red-400 shrink-0">{i + 1}</span>
                                        {f.title}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </section>

            {/* ── OPENAI DEEP ANALYSIS ──────────────────────────── */}
            <section className="rounded-3xl overflow-hidden relative" style={{ background: "rgba(200,168,75,0.025)", border: "1px solid rgba(200,168,75,0.15)" }}>
                {/* Animated gold top bar */}
                <div className="h-px w-full" style={{ background: "linear-gradient(90deg, transparent 0%, rgba(200,168,75,0.6) 30%, rgba(255,216,112,0.8) 50%, rgba(200,168,75,0.6) 70%, transparent 100%)" }} />

                <div className="p-8">
                    <div className="flex items-center gap-4 mb-2">
                        <div className="p-3 rounded-xl" style={{ background: "linear-gradient(135deg, rgba(200,168,75,0.15), rgba(200,168,75,0.06))", border: "1px solid rgba(200,168,75,0.25)" }}>
                            <Bot className="w-7 h-7" style={{ color: "#FFD870" }} />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black uppercase italic tracking-tighter" style={{ color: "#FFD870" }}>AI Coach</h2>
                            <p className="text-xs font-bold uppercase tracking-widest mt-0.5" style={{ color: "rgba(200,168,75,0.4)" }}>AI-Powered Deep Analysis · Professional Coaching</p>
                        </div>
                        <div className="ml-auto hidden md:block px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest" style={{ background: "rgba(200,168,75,0.08)", border: "1px solid rgba(200,168,75,0.2)", color: "rgba(200,168,75,0.6)" }}>
                            Powered by riotskillissue
                        </div>
                    </div>
                    <p className="text-xs mb-8" style={{ color: "rgba(200,168,75,0.4)" }}>
                        Your full match stats, lane matchup, win drivers, skill gaps, and style archetypes are automatically included in the prompt.
                    </p>

                    <div className="space-y-5">

                        {/* Custom Prompt */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-[10px] font-black uppercase tracking-widest" style={{ color: "rgba(200,168,75,0.5)" }}>
                                    <MessageSquare className="w-3 h-3 inline mr-1 mb-0.5" />
                                    Custom Prompt <span style={{ color: "rgba(200,168,75,0.3)" }}>(optional)</span>
                                </label>
                                <button
                                    onClick={() => setShowPromptHelper((v) => !v)}
                                    className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider transition-colors"
                                    style={{ color: "rgba(200,168,75,0.4)" }}
                                >
                                    {showPromptHelper ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                    {showPromptHelper ? "Hide" : "See"} default
                                </button>
                            </div>

                            {showPromptHelper && (
                                <div className="mb-3 p-4 rounded-xl text-xs whitespace-pre-wrap leading-relaxed" style={{ background: "rgba(200,168,75,0.04)", border: "1px solid rgba(200,168,75,0.1)", color: "rgba(200,168,75,0.5)", fontFamily: "monospace" }}>
                                    {DEFAULT_PROMPT}
                                </div>
                            )}

                            <textarea
                                value={customPrompt}
                                onChange={(e) => setCustomPrompt(e.target.value)}
                                placeholder={`Leave blank to use the default coaching prompt, or type your own:\n\n"Focus only on my vision game and explain what I should have done differently..."`}
                                rows={4}
                                className="w-full rounded-xl px-4 py-3 text-sm focus:outline-none transition-all resize-none"
                                style={{
                                    background: "rgba(200,168,75,0.04)",
                                    border: "1px solid rgba(200,168,75,0.12)",
                                    color: "#fff",
                                    caretColor: "#C8A84B",
                                }}
                                onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(200,168,75,0.4)"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(200,168,75,0.05)"; }}
                                onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(200,168,75,0.12)"; e.currentTarget.style.boxShadow = "none"; }}
                            />
                        </div>

                        {/* Analyze Button */}
                        <button
                            onClick={handleAnalyze}
                            disabled={loading}
                            className="w-full py-4 rounded-xl font-black uppercase tracking-[0.15em] text-sm transition-all flex items-center justify-center gap-3 relative overflow-hidden group"
                            style={{
                                background: loading
                                    ? "rgba(200,168,75,0.04)"
                                    : "linear-gradient(135deg, rgba(200,168,75,0.18) 0%, rgba(200,168,75,0.08) 100%)",
                                border: `1px solid ${loading ? "rgba(200,168,75,0.1)" : "rgba(200,168,75,0.35)"}`,
                                color: loading ? "rgba(200,168,75,0.3)" : "#FFD870",
                                boxShadow: loading ? "none" : "0 0 20px rgba(200,168,75,0.08)",
                            }}
                            onMouseEnter={(e) => {
                                if (!loading) {
                                    (e.currentTarget as HTMLElement).style.background = "linear-gradient(135deg, rgba(200,168,75,0.28) 0%, rgba(200,168,75,0.14) 100%)";
                                    (e.currentTarget as HTMLElement).style.boxShadow = "0 0 30px rgba(200,168,75,0.15)";
                                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(200,168,75,0.55)";
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (!loading) {
                                    (e.currentTarget as HTMLElement).style.background = "linear-gradient(135deg, rgba(200,168,75,0.18) 0%, rgba(200,168,75,0.08) 100%)";
                                    (e.currentTarget as HTMLElement).style.boxShadow = "0 0 20px rgba(200,168,75,0.08)";
                                    (e.currentTarget as HTMLElement).style.borderColor = "rgba(200,168,75,0.35)";
                                }
                            }}
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    Analyzing…
                                </>
                            ) : (
                                <>
                                    <Send className="w-5 h-5" />
                                    Run AI Coaching Analysis
                                </>
                            )}
                        </button>

                        {/* Error */}
                        {aiError && (
                            <div className="p-4 rounded-xl flex items-start gap-3" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                                <p className="text-sm text-red-300">{aiError}</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* AI Response */}
                {aiResponse && (
                    <div className="border-t" style={{ borderColor: "rgba(200,168,75,0.1)" }}>
                        {/* Response header */}
                        <div className="flex items-center justify-between px-8 py-4" style={{ background: "rgba(200,168,75,0.03)" }}>
                            <div className="flex items-center gap-3">
                                <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#4ade80", boxShadow: "0 0 8px rgba(74,222,128,0.6)" }} />
                                <span className="text-xs font-black uppercase tracking-widest" style={{ color: "rgba(200,168,75,0.6)" }}>AI Coach Analysis</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={copyResponse}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all"
                                    style={{ background: "rgba(200,168,75,0.06)", border: "1px solid rgba(200,168,75,0.15)", color: "rgba(200,168,75,0.5)" }}
                                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(200,168,75,0.3)"; (e.currentTarget as HTMLElement).style.color = "#FFD870"; }}
                                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(200,168,75,0.15)"; (e.currentTarget as HTMLElement).style.color = "rgba(200,168,75,0.5)"; }}
                                >
                                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                                    {copied ? "Copied!" : "Copy"}
                                </button>
                                <button
                                    onClick={() => { setAiResponse(""); setAiError(""); }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all"
                                    style={{ background: "rgba(200,168,75,0.06)", border: "1px solid rgba(200,168,75,0.15)", color: "rgba(200,168,75,0.5)" }}
                                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(200,168,75,0.3)"; (e.currentTarget as HTMLElement).style.color = "#FFD870"; }}
                                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(200,168,75,0.15)"; (e.currentTarget as HTMLElement).style.color = "rgba(200,168,75,0.5)"; }}
                                >
                                    <RotateCcw className="w-3.5 h-3.5" />
                                    Reset
                                </button>
                            </div>
                        </div>

                        {/* The response content */}
                        <div className="px-8 py-6 space-y-1 relative">
                            {/* Decorative left bar */}
                            <div className="absolute left-0 top-6 bottom-6 w-0.5 rounded-full" style={{ background: "linear-gradient(180deg, rgba(200,168,75,0.0) 0%, rgba(200,168,75,0.4) 20%, rgba(200,168,75,0.4) 80%, rgba(200,168,75,0.0) 100%)" }} />

                            {renderMarkdown(aiResponse)}
                        </div>

                        {/* Footer attribution */}
                        <div className="px-8 py-4 flex items-center justify-between" style={{ borderTop: "1px solid rgba(200,168,75,0.06)", background: "rgba(200,168,75,0.02)" }}>
                            <span className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: "rgba(200,168,75,0.2)" }}>AI Coach · NexusInsight</span>
                            <span className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: "rgba(200,168,75,0.2)" }}>For educational purposes only</span>
                        </div>
                    </div>
                )}
            </section>

        </div>
    );
}
