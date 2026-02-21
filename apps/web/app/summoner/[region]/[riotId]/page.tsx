"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { analyzeStats } from "@/lib/api";
import type { AnalyzeProgressUpdate } from "@/lib/analysisContract";
import {
    ArrowLeft, Trophy, Skull, Crown, Flame, HeartCrack, Umbrella,
    Baby, UserX, Swords, Castle, Wheat, Eye, EyeOff, Coins, Shield, Target,
    Sword, Banknote, HelpCircle, HeartHandshake, Ghost, Users, MoveHorizontal,
    TrendingDown, Frown, Sparkles, Hand, HeartPulse, Bot, Gamepad2,
    ChartLine, Crosshair, Trees, MessageCircle, BarChart3,
    Zap, Heart, Timer, Layers, Map, Compass, TrendingUp,
    Search, Menu, Settings, Bell, ChevronRight, Share2, Download,
    Medal
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { AnalysisProgressCard } from "@/components/AnalysisProgressCard";

// --- Types & Constants ---

// Map icon names from backend to Lucide components
const iconMap: Record<string, React.ElementType> = {
    "crown": Crown, "flame": Flame, "skull": Skull, "heart-crack": HeartCrack, "umbrella": Umbrella,
    "baby": Baby, "user-x": UserX, "swords": Swords, "castle": Castle, "wheat": Wheat,
    "eye": Eye, "eye-off": EyeOff, "coins": Coins, "shield": Shield, "target": Target,
    "sword": Sword, "banknote": Banknote, "help-circle": HelpCircle, "heart-handshake": HeartHandshake,
    "ghost": Ghost, "users": Users, "move-horizontal": MoveHorizontal, "trending-down": TrendingDown,
    "frown": Frown, "sparkles": Sparkles, "hand": Hand, "heart-pulse": HeartPulse, "bot": Bot,
};

interface Mood {
    title: string;
    icon: string;
    color: string;
    description: string;
    advice: string;
}

const RANK_COLORS: Record<string, { text: string; border: string; glow: string; bg: string }> = {
    "IRON": { text: "text-zinc-500", border: "border-zinc-600", glow: "shadow-zinc-500/20", bg: "bg-zinc-900" },
    "BRONZE": { text: "text-[#CD7F32]", border: "border-[#CD7F32]", glow: "shadow-[#CD7F32]/20", bg: "bg-[#CD7F32]/10" },
    "SILVER": { text: "text-zinc-300", border: "border-zinc-400", glow: "shadow-zinc-300/20", bg: "bg-zinc-900" },
    "GOLD": { text: "text-[#FFD700]", border: "border-[#FFD700]", glow: "shadow-[#FFD700]/20", bg: "bg-[#FFD700]/10" },
    "PLATINUM": { text: "text-[#00CED1]", border: "border-[#00CED1]", glow: "shadow-[#00CED1]/20", bg: "bg-[#00CED1]/10" },
    "EMERALD": { text: "text-[#50C878]", border: "border-[#50C878]", glow: "shadow-[#50C878]/20", bg: "bg-[#50C878]/10" },
    "DIAMOND": { text: "text-[#B9F2FF]", border: "border-[#B9F2FF]", glow: "shadow-[#B9F2FF]/20", bg: "bg-[#B9F2FF]/10" },
    "MASTER": { text: "text-[#9B59B6]", border: "border-[#9B59B6]", glow: "shadow-[#9B59B6]/20", bg: "bg-[#9B59B6]/10" },
    "GRANDMASTER": { text: "text-[#DC143C]", border: "border-[#DC143C]", glow: "shadow-[#DC143C]/20", bg: "bg-[#DC143C]/10" },
    "CHALLENGER": { text: "text-[#F4C542]", border: "border-[#F4C542]", glow: "shadow-[#F4C542]/20", bg: "bg-[#F4C542]/10" },
};

function rankTierToEmblemSrc(tier: string | null | undefined): string | null {
    if (!tier) return null;
    const t = tier.toUpperCase();
    const file = (() => {
        switch (t) {
            case "IRON":
            case "BRONZE":
            case "SILVER":
            case "GOLD":
            case "PLATINUM":
            case "EMERALD":
            case "DIAMOND":
            case "MASTER":
            case "GRANDMASTER":
            case "CHALLENGER":
                return t.toLowerCase();
            default:
                return null;
        }
    })();

    return file ? `/rank-emblems/${file}.png` : null;
}

// --- Sub-Components ---

function StatCard({ label, value, icon: Icon, subtext, trend, color }: { label: string; value: string | number; icon?: React.ElementType; subtext?: string; trend?: number; color?: string }) {
    return (
        <div
            className="p-5 rounded-xl group transition-all"
            style={{ background: "rgba(200,168,75,0.03)", border: "1px solid rgba(200,168,75,0.1)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(200,168,75,0.06)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(200,168,75,0.03)"; }}
        >
            <div className="flex justify-between items-start mb-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: "rgba(200,168,75,0.5)" }}>{label}</span>
                {Icon && <Icon className={cn("w-4 h-4 transition-colors", color || "")} style={color ? {} : { color: "rgba(200,168,75,0.4)" }} />}
            </div>
            <div className={cn("text-2xl font-black mb-1 group-hover:scale-105 transition-transform origin-left", color || "text-white")}>{value}</div>
            {subtext && <div className="text-xs" style={{ color: "rgba(200,168,75,0.35)" }}>{subtext}</div>}
            {trend !== undefined && (
                <div className={cn("text-xs font-bold flex items-center gap-1 mt-2", trend > 0 ? "text-green-400" : "text-red-400")}>
                    {trend > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {Math.abs(trend)}% vs avg
                </div>
            )}
        </div>
    );
}

function InsightBar({ label, value, color = "bg-[#C8A84B]", max = 100 }: { label: string; value: number; color?: string; max?: number }) {
    const safeVal = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    return (
        <div className="mb-3">
            <div className="flex justify-between text-xs font-bold uppercase tracking-[0.1em] mb-1">
                <span style={{ color: "rgba(200,168,75,0.5)" }}>{label}</span>
                <span style={{ color: "#FFD870" }}>{safeVal.toFixed(1)}%</span>
            </div>
            <div className="h-[3px] w-full rounded-full overflow-hidden" style={{ background: "rgba(200,168,75,0.08)" }}>
                <div className={cn("h-full rounded-full transition-all duration-1000", color)} style={{ width: `${Math.min((safeVal / max) * 100, 100)}%` }} />
            </div>
        </div>
    );
}

function DetailBlock({ title, icon: Icon, color, children }: { title: string; icon: any; color: string; children: React.ReactNode }) {
    return (
        <div className="rounded-xl p-5 transition-colors" style={{ background: "rgba(200,168,75,0.025)", border: "1px solid rgba(200,168,75,0.1)" }}>
            <h4 className={cn("font-bold text-sm mb-4 flex items-center gap-2", color)}>
                <Icon className="w-4 h-4" />
                {title}
            </h4>
            <div className="space-y-3">
                {children}
            </div>
        </div>
    );
}

function StatRow({ label, value, highlight = false, valueColor }: { label: string; value: string | number; highlight?: boolean; valueColor?: string }) {
    return (
        <div className="flex justify-between items-center text-sm">
            <span style={{ color: "rgba(200,168,75,0.45)" }}>{label}</span>
            <span className={cn("font-bold", valueColor || (highlight ? "text-white" : ""))} style={valueColor || highlight ? {} : { color: "rgba(255,255,255,0.7)" }}>{value}</span>
        </div>
    );
}


import { DetailedMatchAnalysis } from "@/components/DetailedMatchAnalysis";
import { PlayerPerformanceTrends } from "@/components/PlayerPerformanceTrends";
import { HeatmapVisualization } from "@/components/HeatmapVisualization";

export default function Dashboard() {
    const params = useParams();
    const router = useRouter();
    const region = params.region as string;
    const riotId = decodeURIComponent(params.riotId as string);

    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [progress, setProgress] = useState<AnalyzeProgressUpdate>({ message: "Initializing...", percent: 0 });
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<"overview" | "match" | "trends" | "heatmap">("overview");
    const [rankEmblemErrored, setRankEmblemErrored] = useState(false);

    useEffect(() => {
        async function fetchData() {
            try {
                const result = await analyzeStats(riotId, region, (p) => {
                    setProgress(p);
                });
                setData(result);
            } catch (err: any) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        }
        if (riotId && region) fetchData();
    }, [riotId, region]);

    useEffect(() => {
        setRankEmblemErrored(false);
    }, [data?.ranked_data?.tier]);

    // Derived formatting helpers
    const fmt = (val: any, decimals = 1) => typeof val === 'number' ? val.toFixed(decimals) : "0";
    const fmtSigned = (val: unknown) => {
        const n = typeof val === 'number' ? val : Number(val);
        if (!Number.isFinite(n)) return "0";
        return (n >= 0 ? "+" : "") + n.toFixed(1);
    };
    const fmtPct = (val: any) => typeof val === 'number' ? (val * 100).toFixed(1) + "%" : "0%";


    // Loading Screen
    if (loading) {
        return <AnalysisProgressCard progress={progress} />;
    }

    // Error State
    if (error || !data) return (
        <div className="min-h-screen text-white flex items-center justify-center font-sans relative overflow-hidden" style={{ background: "#030308" }}>
            {/* Grid */}
            <div className="fixed inset-0 pointer-events-none" style={{ backgroundImage: "linear-gradient(rgba(200,168,75,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(200,168,75,0.025) 1px, transparent 1px)", backgroundSize: "48px 48px" }} />
            {/* Vignette */}
            <div className="fixed inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 80% 80% at 50% 50%, transparent 40%, rgba(3,3,8,0.9) 100%)" }} />
            {/* Scan line */}
            <div className="fixed left-0 right-0 h-px pointer-events-none" style={{ background: "linear-gradient(90deg, transparent, rgba(200,168,75,0.2) 50%, transparent)", animation: "ticker-scroll 10s linear infinite", top: "40%" }} />

            {/* Card */}
            <div
                className="relative z-10 flex flex-col items-center text-center w-full max-w-sm mx-4 p-10 rounded-2xl"
                style={{
                    background: "linear-gradient(135deg, rgba(200,168,75,0.04) 0%, rgba(8,8,18,0.96) 50%, rgba(200,168,75,0.02) 100%)",
                    border: "1px solid rgba(200,168,75,0.15)",
                    boxShadow: "0 0 60px rgba(200,168,75,0.05), 0 32px 80px rgba(0,0,0,0.65), inset 0 1px 0 rgba(200,168,75,0.08)",
                    backdropFilter: "blur(24px)",
                }}
            >
                {/* FUI corners */}
                {(["tl","tr","bl","br"] as const).map((pos) => {
                    const vMap = { tl: "top-0 left-0", tr: "top-0 right-0", bl: "bottom-0 left-0", br: "bottom-0 right-0" };
                    const rotMap = { tl: "0deg", tr: "90deg", br: "180deg", bl: "270deg" };
                    return (
                        <div key={pos} className={`absolute ${vMap[pos]} w-5 h-5`} style={{ transform: `rotate(${rotMap[pos]})` }}>
                            <div className="absolute top-0 left-0 w-full h-[1px]" style={{ background: "rgba(200,168,75,0.5)" }} />
                            <div className="absolute top-0 left-0 h-full w-[1px]" style={{ background: "rgba(200,168,75,0.5)" }} />
                        </div>
                    );
                })}

                {/* Header label */}
                <div className="w-full flex items-center justify-between mb-6">
                    <span className="text-[9px] font-bold uppercase tracking-[0.25em]" style={{ color: "rgba(200,168,75,0.4)" }}>NEXUS SCAN</span>
                    <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: "rgba(200,168,75,0.4)" }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#C8A84B", boxShadow: "0 0 6px rgba(200,168,75,0.8)" }} />
                        ERROR
                    </span>
                </div>

                {/* Icon */}
                <div className="relative mb-6 flex items-center justify-center">
                    {/* Pulse rings */}
                    <span className="absolute w-20 h-20 rounded-full border animate-ping" style={{ borderColor: "rgba(200,168,75,0.15)", animationDuration: "2s" }} />
                    <span className="absolute w-16 h-16 rounded-full border animate-pulse" style={{ borderColor: "rgba(200,168,75,0.12)" }} />
                    {/* Hex container */}
                    <div className="relative flex items-center justify-center w-14 h-14">
                        <svg className="absolute inset-0 w-full h-full animate-spin-xl" viewBox="0 0 56 56" fill="none">
                            <polygon points="28,3 51,15.5 51,40.5 28,53 5,40.5 5,15.5" stroke="rgba(200,168,75,0.25)" strokeWidth="1" strokeDasharray="4 3" />
                        </svg>
                        <Skull className="relative z-10 w-7 h-7" style={{ color: "#C8A84B", filter: "drop-shadow(0 0 8px rgba(200,168,75,0.5))" }} />
                    </div>
                </div>

                {/* Title */}
                <h2 className="text-xl font-black uppercase tracking-[0.12em] mb-3" style={{ color: "#FFD870", textShadow: "0 0 24px rgba(255,216,112,0.3)" }}>
                    Analysis Failed
                </h2>

                {/* Divider */}
                <div className="w-full h-px mb-4" style={{ background: "linear-gradient(90deg, transparent, rgba(200,168,75,0.2), transparent)" }} />

                {/* Error message */}
                <p className="text-sm mb-8 leading-relaxed" style={{ color: "rgba(200,168,75,0.5)" }}>
                    {error || "Could not retrieve data"}
                </p>

                {/* Button */}
                <Link
                    href="/"
                    className="group relative px-8 py-3 rounded-xl font-bold uppercase tracking-[0.15em] text-sm overflow-hidden transition-all duration-300"
                    style={{
                        background: "linear-gradient(135deg, rgba(200,168,75,0.12), rgba(200,168,75,0.06))",
                        border: "1px solid rgba(200,168,75,0.35)",
                        color: "#FFD870",
                        boxShadow: "0 0 20px rgba(200,168,75,0.08)",
                    }}
                    onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "linear-gradient(135deg, rgba(200,168,75,0.22), rgba(200,168,75,0.12))";
                        (e.currentTarget as HTMLElement).style.boxShadow = "0 0 24px rgba(200,168,75,0.2)";
                        (e.currentTarget as HTMLElement).style.borderColor = "rgba(200,168,75,0.6)";
                    }}
                    onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = "linear-gradient(135deg, rgba(200,168,75,0.12), rgba(200,168,75,0.06))";
                        (e.currentTarget as HTMLElement).style.boxShadow = "0 0 20px rgba(200,168,75,0.08)";
                        (e.currentTarget as HTMLElement).style.borderColor = "rgba(200,168,75,0.35)";
                    }}
                >
                    Return to Base
                </Link>

                {/* Footer */}
                <div className="w-full flex items-center justify-between mt-8">
                    <span className="text-[8px] font-bold uppercase tracking-[0.2em]" style={{ color: "rgba(200,168,75,0.2)" }}>NEXUSINSIGHT</span>
                    <span className="text-[8px] font-bold uppercase tracking-[0.2em]" style={{ color: "rgba(200,168,75,0.2)" }}>v2.0</span>
                </div>
            </div>
        </div>
    );

    // Data Destructuring
    const {
        user,
        metrics,
        win_probability,
        player_moods = [],
        weighted_averages: avg = {},
        last_match_stats: lastMatch = {},
        win_rate = 0,
        total_matches = 0,
        territory_metrics = {},
        ranked_data,
        ddragon_version = "14.24.1",
        win_drivers = [],
        skill_focus = [],
        match_timeline_series = {},
        performance_trends = [],
        enemy_stats: enemyStats = {},
        heatmap_data = null
    } = data;

    const { top_differentiators = [], category_importance = [] } = metrics || {};
    const profileIconUrl = `https://ddragon.leagueoflegends.com/cdn/${ddragon_version}/img/profileicon/${user.profile_icon_id}.png`;
    const rankTier = typeof ranked_data?.tier === "string" ? ranked_data.tier.toUpperCase() : null;
    const rankConfig = rankTier ? (RANK_COLORS[rankTier] ?? null) : null;
    const rankEmblemSrc = rankTierToEmblemSrc(rankTier);
    const rankText = ranked_data
        ? [ranked_data.tier, ranked_data.rank].filter(Boolean).join(" ").trim()
        : "";

    const winProbDelta =
        typeof win_probability === "number" && Number.isFinite(win_probability) &&
        typeof win_rate === "number" && Number.isFinite(win_rate)
            ? win_probability - win_rate
            : undefined;


    return (
        <div className="min-h-screen text-white font-sans pb-20" style={{ background: "#030308", caretColor: "#C8A84B" }}>
            {/* Gold grid */}
            <div className="fixed inset-0 z-0 pointer-events-none" style={{ backgroundImage: "linear-gradient(rgba(200,168,75,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(200,168,75,0.02) 1px, transparent 1px)", backgroundSize: "48px 48px" }} />
            {/* Vignette */}
            <div className="fixed inset-0 z-0 pointer-events-none" style={{ background: "radial-gradient(ellipse 100% 70% at 50% 0%, transparent 60%, rgba(3,3,8,0.7) 100%)" }} />

            {/* Sidebar Navigation */}
            <aside
                className="fixed left-0 top-0 bottom-0 w-20 z-50 flex flex-col items-center pt-6 pb-8 gap-8 hidden lg:flex"
                style={{ borderRight: "1px solid rgba(200,168,75,0.1)", background: "rgba(3,3,8,0.85)", backdropFilter: "blur(20px)" }}
            >
                <Link href="/" className="w-12 h-12 flex items-center justify-center hover:scale-110 transition-transform">
                    <img src="/logo.png" alt="NexusInsight" className="w-full h-full object-contain" />
                </Link>
                <nav className="flex flex-col gap-6 mt-auto mb-auto">
                    {(["overview", "match", "trends", "heatmap"] as const).map((tab, i) => {
                        const icons = [Trophy, Crosshair, ChartLine, Map];
                        const Icon = icons[i];
                        const active = activeTab === tab;
                        return (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className="p-3 rounded-xl transition-all"
                                style={active ? { color: "#FFD870", background: "rgba(200,168,75,0.1)", boxShadow: "0 0 12px rgba(200,168,75,0.2)" } : { color: "rgba(200,168,75,0.3)" }}
                                onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.color = "rgba(200,168,75,0.7)"; }}
                                onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.color = "rgba(200,168,75,0.3)"; }}
                            >
                                <Icon className="w-6 h-6" />
                            </button>
                        );
                    })}
                </nav>
                <div className="mt-auto">
                    <img src={profileIconUrl} className="w-10 h-10 rounded-lg opacity-50 grayscale hover:grayscale-0 transition-all" style={{ border: "1px solid rgba(200,168,75,0.15)" }} />
                </div>
            </aside>

            {/* Main Content */}
            <main className="lg:pl-20 min-h-screen relative z-10">
                {/* Header */}
                <header className="h-20 sticky top-0 z-40 px-8 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(200,168,75,0.1)", background: "rgba(3,3,8,0.9)", backdropFilter: "blur(20px)" }}>
                    <div className="flex items-center gap-4">
                        <Link href="/" className="lg:hidden p-2 -ml-2 transition-colors" style={{ color: "rgba(200,168,75,0.5)" }}><ArrowLeft className="w-5 h-5" /></Link>
                        <h1 className="text-xl font-bold uppercase tracking-widest hidden md:block" style={{ color: "#C8A84B" }}>NEXUS<span className="text-white">INSIGHT</span></h1>
                        <div className="h-6 w-px bg-white/10 hidden md:block"></div>
                        <div className="flex items-center gap-5">
                            <img src={profileIconUrl} className={cn("w-12 h-12 rounded-xl border-2 shadow-xl", rankConfig ? rankConfig.border : "border-zinc-700")} />
                            <div className="flex items-center gap-4">
                                <div className="flex flex-col justify-center">
                                    <div className="text-xl font-black text-white tracking-tight leading-tight">{user.game_name} <span className="text-zinc-500 font-medium opacity-80">#{user.tag_line}</span></div>
                                    <div className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest mt-1 flex items-center gap-2 opacity-70">
                                        <span>{user.region}</span>
                                        <span className="w-1 h-1 rounded-full bg-zinc-800"></span>
                                        <span>Level {user.summoner_level}</span>
                                    </div>
                                </div>
                                {ranked_data ? (
                                    <div className={cn("flex items-center gap-3 px-4 h-12 rounded-2xl shadow-lg shadow-black/40", rankConfig ? `${rankConfig.bg} ${rankConfig.glow}` : "bg-white/5")}>
                                        {rankEmblemSrc && !rankEmblemErrored ? (
                                            <img
                                                src={rankEmblemSrc}
                                                alt={`${ranked_data.tier} rank emblem`}
                                                className="w-8 h-8 object-contain"
                                                loading="lazy"
                                                decoding="async"
                                                onError={() => setRankEmblemErrored(true)}
                                            />
                                        ) : (
                                            <Crown className={cn("w-6 h-6", rankConfig?.text)} />
                                        )}
                                        <span className={cn("text-xs font-black uppercase tracking-widest whitespace-nowrap", rankConfig?.text)}>
                                            {rankText} • {ranked_data.lp} LP
                                        </span>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-3 px-4 h-12 rounded-2xl shadow-lg shadow-black/40 bg-white/5">
                                        <Medal className="w-6 h-6 text-zinc-500" />
                                        <span className="text-xs font-black uppercase tracking-widest whitespace-nowrap text-zinc-400">Unranked</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="hidden md:flex items-center gap-1 rounded-lg p-1" style={{ background: "rgba(200,168,75,0.05)", border: "1px solid rgba(200,168,75,0.1)" }}>
                            {["Overview", "Match", "Trends", "Heatmap"].map((tab) => {
                                const active = activeTab === tab.toLowerCase();
                                return (
                                    <button
                                        key={tab}
                                        onClick={() => setActiveTab(tab.toLowerCase() as any)}
                                        className="px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-[0.1em] transition-all"
                                        style={active
                                            ? { background: "rgba(200,168,75,0.15)", color: "#FFD870", boxShadow: "0 0 10px rgba(200,168,75,0.15)", border: "1px solid rgba(200,168,75,0.25)" }
                                            : { color: "rgba(200,168,75,0.4)", border: "1px solid transparent" }
                                        }
                                    >
                                        {tab}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </header>

                <div className="p-6 md:p-8 max-w-[1600px] mx-auto">

                    {/* OVERVIEW TAB */}
                    {activeTab === "overview" && (
                        <div className="space-y-8 animate-in fade-in slide-in-from-bottom duration-500">
                            {/* Top Stats */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                <div className="p-6 rounded-xl relative overflow-hidden group" style={{ background: "rgba(200,168,75,0.04)", border: "1px solid rgba(200,168,75,0.25)", boxShadow: "0 0 30px rgba(200,168,75,0.05)" }}>
                                    <div className="absolute top-0 right-0 p-4 opacity-30"><Zap className="w-8 h-8" style={{ color: "#C8A84B" }} /></div>
                                    <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] mb-2" style={{ color: "rgba(200,168,75,0.5)" }}>Win Probability</h3>
                                    <div className="flex items-baseline gap-2">
                                        <div className="text-4xl font-black italic tracking-tighter" style={{ color: "#FFD870", textShadow: "0 0 20px rgba(255,216,112,0.3)" }}>{win_probability.toFixed(0)}<span className="text-xl" style={{ color: "#C8A84B" }}>%</span></div>
                                        {winProbDelta !== undefined ? (
                                            <span
                                                className={cn(
                                                    "text-xs font-bold px-2 py-0.5 rounded",
                                                    winProbDelta >= 0 ? "text-green-400 bg-green-400/10" : "text-red-400 bg-red-400/10"
                                                )}
                                            >
                                                {winProbDelta >= 0 ? "+" : ""}{winProbDelta.toFixed(1)}%
                                            </span>
                                        ) : null}
                                    </div>
                                    <div className="w-full h-[3px] rounded-full mt-4 overflow-hidden" style={{ background: "rgba(200,168,75,0.1)" }}>
                                        <div className="h-full rounded-full transition-all" style={{ width: `${win_probability}%`, background: win_probability > 50 ? "linear-gradient(90deg, #C8A84B, #FFD870)" : "#ef4444", boxShadow: win_probability > 50 ? "0 0 8px rgba(255,216,112,0.4)" : "none" }}></div>
                                    </div>
                                    <p className="text-[10px] mt-2 uppercase tracking-[0.1em]" style={{ color: "rgba(200,168,75,0.3)" }}>Based on {total_matches} analyzed matches</p>
                                </div>

                                <div className="p-6 rounded-xl" style={{ background: "rgba(200,168,75,0.03)", border: "1px solid rgba(200,168,75,0.1)" }}>
                                    <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] mb-2" style={{ color: "rgba(200,168,75,0.5)" }}>Avg Performance</h3>
                                    <div className="flex items-baseline gap-2">
                                        <div className="text-3xl font-black text-white">{data.win_rate.toFixed(1)}%</div>
                                        <span className={cn("text-xs font-bold px-2 py-0.5 rounded", data.win_rate >= 50 ? "text-green-400 bg-green-400/10" : "text-red-400 bg-red-400/10")}>Win Rate</span>
                                    </div>
                                    <div className="mt-4 flex gap-4 text-xs font-bold uppercase tracking-[0.1em]" style={{ color: "rgba(200,168,75,0.4)" }}>
                                        <div><span className="text-white">{fmt(avg.kills)}</span> K</div>
                                        <div><span className="text-white">{fmt(avg.deaths)}</span> D</div>
                                        <div><span className="text-white">{fmt(avg.assists)}</span> A</div>
                                    </div>
                                </div>

                                <div className="p-6 rounded-xl" style={{ background: "rgba(200,168,75,0.03)", border: "1px solid rgba(200,168,75,0.1)" }}>
                                    <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] mb-2" style={{ color: "rgba(200,168,75,0.5)" }}>Style Signature</h3>
                                    <div className="flex flex-wrap gap-2 mt-2">
                                        {player_moods.slice(0, 3).map((mood: Mood, i: number) => (
                                            <span key={i} className={cn("px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest border", mood.color.replace('text-', 'border-').replace('text-', 'text-'))}>
                                                {mood.title}
                                            </span>
                                        ))}
                                    </div>
                                    <div className="mt-3 text-xs line-clamp-2" style={{ color: "rgba(200,168,75,0.4)" }}>
                                        {player_moods[0]?.description}
                                    </div>
                                </div>

                                <div className="p-6 rounded-xl" style={{ background: "linear-gradient(135deg, rgba(200,168,75,0.07), rgba(200,168,75,0.02))", border: "1px solid rgba(200,168,75,0.18)" }}>
                                    <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] mb-2" style={{ color: "#C8A84B" }}>AI Coach Insight</h3>
                                    <p className="text-sm font-medium text-white italic">
                                        "{player_moods[0]?.advice || 'Focus on maintaining your gold lead in mid-game transitions.'}"
                                    </p>
                                </div>
                            </div>

                            {/* Predictive Indicators (Restored) */}
                            <div className="rounded-2xl p-8" style={{ background: "rgba(200,168,75,0.02)", border: "1px solid rgba(200,168,75,0.1)" }}>
                                <h3 className="text-xl font-black uppercase italic tracking-tighter flex items-center gap-3 mb-6">
                                    <BarChart3 className="w-6 h-6 text-amber-500" />
                                    Predictive Indicators
                                    <span className="px-3 py-1 bg-amber-500/10 text-amber-500 rounded text-[10px] font-bold uppercase tracking-widest">Early Game Analysis</span>
                                    <span className="px-3 py-1 rounded text-[10px] font-bold uppercase tracking-widest" style={{ background: "rgba(200,168,75,0.06)", color: "rgba(200,168,75,0.5)" }}>{total_matches} matches</span>
                                </h3>

                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                    <DetailBlock title="Early Game Leads" icon={Zap} color="text-amber-400">
                                        <StatRow label="Gold Lead @14m" value={fmtSigned(avg.laneGoldLeadAt14)} valueColor={(Number(avg.laneGoldLeadAt14) || 0) > 0 ? "text-green-400" : "text-red-400"} />
                                        <StatRow label="XP Lead @14m" value={fmtSigned(avg.laneXpLeadAt14)} valueColor={(Number(avg.laneXpLeadAt14) || 0) > 0 ? "text-green-400" : "text-red-400"} />
                                        <StatRow label="Max CS Lead" value={fmtSigned(avg.maxCsAdvantageOnLaneOpponent)} valueColor={(Number(avg.maxCsAdvantageOnLaneOpponent) || 0) > 0 ? "text-green-400" : "text-red-400"} />
                                        <StatRow label="Turret Plates" value={fmt(avg.turretPlatesTaken, 0)} valueColor="text-amber-400" />
                                    </DetailBlock>

                                    <DetailBlock title="Mechanical Skills" icon={Target} color="text-cyan-400">
                                        <StatRow label="Hit Rate" value={fmt(avg.skillshotHitRate) + "%"} valueColor="text-cyan-400" />
                                        <StatRow label="Dodge Rate" value={fmt(avg.skillshotDodgeRate) + "%"} valueColor="text-cyan-400" />
                                        <StatRow label="Avg Hits" value={fmt(avg.skillshotsHit, 0)} />
                                        <StatRow label="Avg Dodged" value={fmt(avg.skillshotsDodged, 0)} />
                                    </DetailBlock>

                                    <DetailBlock title="Vision Habits" icon={Eye} color="text-green-400">
                                        <StatRow label="Vision Score" value={fmt(avg.visionScore)} valueColor="text-green-400" />
                                        <StatRow label="Wards Placed" value={fmt(avg.wardsPlaced, 0)} />
                                        <StatRow label="Control Wards" value={fmt(avg.controlWardsPlaced, 0)} />
                                        <StatRow label="Enemy Jungle" value={fmtPct(avg.controlWardTimeCoverageInRiverOrEnemyHalf)} valueColor="text-emerald-400" />
                                    </DetailBlock>

                                    <DetailBlock title="Communication" icon={MessageCircle} color="text-blue-400">
                                        <StatRow label="Enemy Missing" value={fmt(avg.enemyMissingPings, 0)} />
                                        <StatRow label="On My Way" value={fmt(avg.onMyWayPings, 0)} />
                                        <StatRow label="Assist Me" value={fmt(avg.assistMePings, 0)} />
                                        <StatRow label="Retreat" value={fmt(avg.getBackPings, 0)} />
                                    </DetailBlock>
                                </div>
                            </div>

                            {/* ML Insights */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                <div className="rounded-2xl p-8" style={{ background: "rgba(200,168,75,0.02)", border: "1px solid rgba(200,168,75,0.1)" }}>
                                    <h3 className="text-xl font-black uppercase italic tracking-tighter flex items-center gap-3 mb-6">
                                        <Crosshair className="w-6 h-6" style={{ color: "#C8A84B" }} /> Key Win Drivers
                                    </h3>
                                    <div className="space-y-4">
                                        {win_drivers.slice(0, 4).map((driver: any, idx: number) => {
                                            const diff = driver.diff_pct * 100;
                                            return (
                                                <div
                                                    key={idx}
                                                    className="relative group p-4 rounded-xl transition-all"
                                                    style={{ background: "rgba(200,168,75,0.025)", borderLeft: "2px solid rgba(200,168,75,0.15)" }}
                                                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(200,168,75,0.05)"; (e.currentTarget as HTMLElement).style.borderLeftColor = "rgba(200,168,75,0.5)"; }}
                                                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(200,168,75,0.025)"; (e.currentTarget as HTMLElement).style.borderLeftColor = "rgba(200,168,75,0.15)"; }}
                                                >
                                                    <div className="flex justify-between items-center relative z-10">
                                                        <div>
                                                            <div className="text-xs font-bold uppercase tracking-[0.15em] mb-1" style={{ color: "rgba(200,168,75,0.4)" }}>Win Driver {idx + 1}</div>
                                                            <div className="font-bold text-white text-sm">{driver.name}</div>
                                                        </div>
                                                        <div className={cn("text-lg font-black italic", diff > 0 ? "text-green-400" : "text-red-400")}>
                                                            {diff > 0 ? "+" : ""}{diff.toFixed(1)}%
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="rounded-2xl p-8" style={{ background: "rgba(200,168,75,0.02)", border: "1px solid rgba(200,168,75,0.1)" }}>
                                    <h3 className="text-xl font-black uppercase italic tracking-tighter flex items-center gap-3 mb-6">
                                        <Layers className="w-6 h-6" style={{ color: "#C8A84B" }} /> Performance Breakdown
                                    </h3>
                                    <div className="space-y-4">
                                        <InsightBar label="Combat Efficiency" value={Number(avg.combat_efficiency) || 0} max={100} color="bg-red-500" />
                                        <InsightBar label="Vision Control" value={Math.min(((Number(avg.visionScorePerMinute) || 0) * 100) / 2.5, 100)} max={100} color="bg-green-500" />
                                        <InsightBar label="Aggression" value={Number(avg.aggressionScore) || 0} max={100} color="bg-red-600" />
                                        <InsightBar label="Time in Enemy Half" value={Number(territory_metrics?.time_in_enemy_territory_pct) || 0} max={100} color="bg-purple-500" />
                                        <InsightBar label="Consistency" value={Number(metrics?.consistency_score) || 75} max={100} color="bg-blue-400" />
                                        <InsightBar label="Forward Pos" value={Number(territory_metrics?.forward_positioning_score) || 0} max={100} color="bg-orange-400" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* MATCH ANALYSIS TAB */}
                    {activeTab === "match" && (
                        <div className="space-y-8 animate-in fade-in slide-in-from-bottom duration-500">
                            <DetailedMatchAnalysis
                                lastMatchStats={lastMatch}
                                winDrivers={win_drivers}
                                skillFocus={skill_focus}
                                timelineSeries={match_timeline_series}
                                winProbability={win_probability}
                                enemyStats={enemyStats}
                            />
                        </div>
                    )}

                    {/* TRENDS TAB */}
                    {activeTab === "trends" && (
                        <div className="space-y-8 animate-in fade-in slide-in-from-bottom duration-500">
                            <PlayerPerformanceTrends
                                data={performance_trends}
                                loading={loading}
                            />
                        </div>
                    )}

                    {/* HEATMAP TAB */}
                    {activeTab === "heatmap" && (
                        <div className="space-y-8 animate-in fade-in slide-in-from-bottom duration-500">
                            <HeatmapVisualization
                                heatmapData={heatmap_data}
                                ddragonVersion={ddragon_version}
                            />
                        </div>
                    )}

                </div>
            </main>
        </div>
    );
}
