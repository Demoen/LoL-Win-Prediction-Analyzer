"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, Loader2, Clock, Users } from "lucide-react";
import type { AnalyzeProgressUpdate } from "@/lib/analysisContract";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Stage definitions grouped for cleaner visual hierarchy             */
/* ------------------------------------------------------------------ */

type StageDef = {
    id: string;
    label: string;
    stage: string;
    minPercent: number;
    group: "setup" | "data" | "analysis" | "finalize";
};

const STAGES: StageDef[] = [
    // Setup
    { id: "find", label: "Finding Account", stage: "FIND_ACCOUNT", minPercent: 0, group: "setup" },
    { id: "rank", label: "Fetching Ranked Info", stage: "FETCH_RANKED", minPercent: 8, group: "setup" },
    // Data
    { id: "history", label: "Loading Match History", stage: "MATCH_HISTORY", minPercent: 10, group: "data" },
    { id: "load", label: "Loading Match Data", stage: "LOAD_MATCH_DATA", minPercent: 72, group: "data" },
    // Analysis
    { id: "train", label: "Training AI Model", stage: "TRAIN_MODEL", minPercent: 75, group: "analysis" },
    { id: "perf", label: "Analyzing Performance", stage: "PERFORMANCE_METRICS", minPercent: 78, group: "analysis" },
    { id: "lane", label: "Computing Lane Leads", stage: "LANE_LEADS", minPercent: 79, group: "analysis" },
    { id: "mood", label: "Analyzing Player Mood", stage: "MOOD", minPercent: 80, group: "analysis" },
    { id: "terr", label: "Analyzing Territorial Control", stage: "TERRITORIAL", minPercent: 83, group: "analysis" },
    { id: "win", label: "Calculating Win Probability", stage: "WIN_PROB", minPercent: 88, group: "analysis" },
    { id: "opp", label: "Comparing Opponent", stage: "OPPONENT_COMPARE", minPercent: 90, group: "analysis" },
    { id: "factors", label: "Analyzing Win Factors", stage: "WIN_FACTORS", minPercent: 92, group: "analysis" },
    // Finalize
    { id: "timeline", label: "Fetching Timeline Data", stage: "FETCH_TIMELINE", minPercent: 95, group: "finalize" },
    { id: "final", label: "Finalizing Results", stage: "PREPARE_RESULTS", minPercent: 98, group: "finalize" },
];

const GROUP_LABELS: Record<string, string> = {
    setup: "SETUP",
    data: "DATA COLLECTION",
    analysis: "DEEP ANALYSIS",
    finalize: "FINALIZE",
};

function clampPercent(value: unknown): number {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
}

function stageIndexFromPercent(percent: number): number {
    const idx = STAGES.findIndex((stage, i) => {
        const next = STAGES[i + 1];
        return percent >= stage.minPercent && (!next || percent < next.minPercent);
    });
    return idx >= 0 ? idx : 0;
}

/* ------------------------------------------------------------------ */
/*  Elapsed timer hook                                                 */
/* ------------------------------------------------------------------ */
function useElapsed() {
    const start = useRef(Date.now());
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setElapsed(Math.floor((Date.now() - start.current) / 1000)), 1000);
        return () => clearInterval(id);
    }, []);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/*  Canvas background — stars + hex network (gold palette)            */
/* ------------------------------------------------------------------ */
function ParticleCanvas() {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const GOLD   = { r: 200, g: 168, b: 75  };
        const BRIGHT = { r: 255, g: 216, b: 112 };
        const DEEP   = { r: 168, g: 128, b: 38  };

        let W = 0, H = 0, raf = 0, t = 0;

        const STAR_COUNT = 130;
        const stars = Array.from({ length: STAR_COUNT }, () => ({
            x: Math.random(), y: Math.random(),
            r: Math.random() * 1.2 + 0.2,
            phase: Math.random() * Math.PI * 2,
            speed: 0.003 + Math.random() * 0.005,
        }));

        const HEX_COUNT = 16;
        const hexNodes = Array.from({ length: HEX_COUNT }, (_, i) => {
            const tier = i === 0 ? 0 : i < 4 ? 1 : 2;
            return {
                xp: 0.1 + Math.random() * 0.8,
                yp: 0.1 + Math.random() * 0.8,
                vx: (Math.random() - 0.5) * 0.00018,
                vy: (Math.random() - 0.5) * 0.00018,
                size: tier === 0 ? 13 : tier === 1 ? 8 : 5,
                tier,
                pulse: Math.random() * Math.PI * 2,
            };
        });

        const BEAMS: { a: number; b: number; phase: number; speed: number }[] = [];
        for (let i = 0; i < HEX_COUNT; i++) {
            for (let j = i + 1; j < HEX_COUNT; j++) {
                if (Math.random() < 0.2) {
                    BEAMS.push({ a: i, b: j, phase: Math.random() * Math.PI * 2, speed: 0.4 + Math.random() * 0.6 });
                }
            }
        }

        function hexPath(cx: number, cy: number, r: number) {
            ctx!.beginPath();
            for (let i = 0; i < 6; i++) {
                const a = (Math.PI / 3) * i - Math.PI / 6;
                const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
                i === 0 ? ctx!.moveTo(x, y) : ctx!.lineTo(x, y);
            }
            ctx!.closePath();
        }

        function resize() {
            const dpr = window.devicePixelRatio || 1;
            W = canvas!.offsetWidth; H = canvas!.offsetHeight;
            canvas!.width = W * dpr; canvas!.height = H * dpr;
            ctx!.scale(dpr, dpr);
        }
        const ro = new ResizeObserver(resize);
        ro.observe(canvas);
        resize();

        function frame() {
            ctx!.clearRect(0, 0, W, H);
            t++;

            for (const s of stars) {
                const alpha = 0.2 + 0.4 * Math.abs(Math.sin(s.phase + t * s.speed));
                ctx!.beginPath();
                ctx!.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
                ctx!.fillStyle = `rgba(${GOLD.r},${GOLD.g},${GOLD.b},${alpha})`;
                ctx!.fill();
            }

            for (const n of hexNodes) {
                n.xp += n.vx; n.yp += n.vy;
                if (n.xp < 0.02 || n.xp > 0.98) n.vx *= -1;
                if (n.yp < 0.02 || n.yp > 0.98) n.vy *= -1;
            }

            for (const b of BEAMS) {
                const na = hexNodes[b.a], nb = hexNodes[b.b];
                const ax = na.xp * W, ay = na.yp * H;
                const bx = nb.xp * W, by = nb.yp * H;
                const dist = Math.hypot(bx - ax, by - ay);
                if (dist > Math.max(W, H) * 0.5) continue;
                const alpha = 0.06 + 0.05 * Math.sin(b.phase + t * 0.012);
                ctx!.beginPath(); ctx!.moveTo(ax, ay); ctx!.lineTo(bx, by);
                ctx!.strokeStyle = `rgba(${GOLD.r},${GOLD.g},${GOLD.b},${alpha})`;
                ctx!.lineWidth = 0.6; ctx!.stroke();
                const prog = ((t * b.speed * 0.008 + b.phase) % 1 + 1) % 1;
                const px = ax + (bx - ax) * prog, py = ay + (by - ay) * prog;
                ctx!.beginPath(); ctx!.arc(px, py, 1.6, 0, Math.PI * 2);
                ctx!.fillStyle = `rgba(${BRIGHT.r},${BRIGHT.g},${BRIGHT.b},0.55)`;
                ctx!.fill();
            }

            for (const n of hexNodes) {
                const px = n.xp * W, py = n.yp * H;
                const pulse = 0.55 + 0.45 * Math.sin(n.pulse + t * 0.025);
                const c = n.tier === 0 ? GOLD : n.tier === 1 ? BRIGHT : DEEP;
                const alpha = n.tier === 0 ? 0.8 : n.tier === 1 ? 0.55 * pulse : 0.3 * pulse;
                hexPath(px, py, n.size);
                ctx!.strokeStyle = `rgba(${c.r},${c.g},${c.b},${alpha})`;
                ctx!.lineWidth = n.tier === 0 ? 1.5 : 1;
                ctx!.stroke();
                if (n.tier === 0) {
                    for (let ring = 1; ring <= 2; ring++) {
                        const ringR = n.size + ring * 10 + 4 * Math.sin(t * 0.03 + ring);
                        ctx!.beginPath(); ctx!.arc(px, py, ringR, 0, Math.PI * 2);
                        ctx!.strokeStyle = `rgba(${GOLD.r},${GOLD.g},${GOLD.b},${0.1 / ring})`;
                        ctx!.lineWidth = 0.7; ctx!.stroke();
                    }
                }
            }

            raf = requestAnimationFrame(frame);
        }
        raf = requestAnimationFrame(frame);
        return () => { cancelAnimationFrame(raf); ro.disconnect(); };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
            style={{ mixBlendMode: "screen", opacity: 0.5 }}
        />
    );
}

/* ------------------------------------------------------------------ */
/*  Scanning hex animation                                             */
/* ------------------------------------------------------------------ */
function ScanHex({ percent }: { percent: number }) {
    return (
        <div className="relative flex items-center justify-center w-32 h-32">
            <svg className="absolute inset-0 w-full h-full animate-spin-xl" viewBox="0 0 128 128" fill="none">
                <polygon
                    points="64,6 116,35 116,93 64,122 12,93 12,35"
                    stroke="rgba(200,168,75,0.18)"
                    strokeWidth="1"
                    strokeDasharray="6 4"
                />
            </svg>
            <svg className="absolute inset-4 animate-spin-xl-rev" viewBox="0 0 96 96" fill="none">
                <polygon
                    points="48,4 86,26 86,70 48,92 10,70 10,26"
                    stroke="rgba(255,216,112,0.28)"
                    strokeWidth="1.2"
                />
            </svg>
            <svg className="absolute inset-2 w-[calc(100%-16px)] h-[calc(100%-16px)] -rotate-90" viewBox="0 0 88 88">
                <circle cx="44" cy="44" r="40" stroke="rgba(200,168,75,0.08)" strokeWidth="2" fill="none" />
                <circle
                    cx="44" cy="44" r="40"
                    stroke="url(#arcGold)"
                    strokeWidth="2"
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 40}`}
                    strokeDashoffset={`${2 * Math.PI * 40 * (1 - percent / 100)}`}
                    style={{ transition: "stroke-dashoffset 0.7s ease-out" }}
                />
                <defs>
                    <linearGradient id="arcGold" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#C8A84B" />
                        <stop offset="100%" stopColor="#FFD870" />
                    </linearGradient>
                </defs>
            </svg>
            <div className="relative z-10 flex flex-col items-center">
                <span
                    className="text-3xl font-black tabular-nums"
                    style={{ color: "#FFD870", textShadow: "0 0 20px rgba(255,216,112,0.6)" }}
                >
                    {percent}
                </span>
                <span className="text-[8px] font-bold uppercase tracking-[0.2em] mt-0.5" style={{ color: "rgba(200,168,75,0.55)" }}>%</span>
            </div>
            <div className="absolute inset-0 rounded-full" style={{ background: "radial-gradient(ellipse at center, rgba(200,168,75,0.07) 0%, transparent 70%)" }} />
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Queue waiting overlay                                              */
/* ------------------------------------------------------------------ */
function QueueOverlay({ position, total }: { position: number; total: number }) {
    return (
        <div className="w-full flex flex-col items-center gap-5 py-4">
            <div className="relative flex items-center justify-center w-28 h-28">
                <span className="absolute inset-0 rounded-full border border-[#C8A84B]/30 animate-ping" />
                <span className="absolute inset-3 rounded-full border border-[#FFD870]/20 animate-pulse" />
                <div className="flex flex-col items-center z-10">
                    <span className="text-4xl font-black tabular-nums" style={{ color: "#FFD870", textShadow: "0 0 20px rgba(255,216,112,0.5)" }}>{position}</span>
                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "rgba(200,168,75,0.5)" }}>in queue</span>
                </div>
            </div>
            <div className="text-center space-y-1">
                <p className="text-sm" style={{ color: "rgba(200,168,75,0.7)" }}>
                    <Users className="inline w-3.5 h-3.5 mr-1 -mt-0.5" style={{ color: "#C8A84B" }} />
                    {total} {total === 1 ? "person" : "people"} ahead of you
                </p>
                <p className="text-xs" style={{ color: "rgba(200,168,75,0.3)" }}>Analysis will start automatically when a slot opens</p>
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  FUI corner bracket                                                 */
/* ------------------------------------------------------------------ */
function Corner({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) {
    const vMap = { tl: "top-0 left-0", tr: "top-0 right-0", bl: "bottom-0 left-0", br: "bottom-0 right-0" };
    const rotMap = { tl: "0deg", tr: "90deg", br: "180deg", bl: "270deg" };
    return (
        <div className={`absolute ${vMap[pos]} w-5 h-5`} style={{ transform: `rotate(${rotMap[pos]})` }}>
            <div className="absolute top-0 left-0 w-full h-[1px]" style={{ background: "rgba(200,168,75,0.5)" }} />
            <div className="absolute top-0 left-0 h-full w-[1px]" style={{ background: "rgba(200,168,75,0.5)" }} />
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */
export function AnalysisProgressCard({ progress }: { progress: AnalyzeProgressUpdate }) {
    const percent = clampPercent(progress.percent);
    const elapsed = useElapsed();
    const listRef = useRef<HTMLDivElement>(null);
    const isQueued = progress.stage === "QUEUED";

    const stageIndexFromStage =
        typeof progress.stage === "string" ? STAGES.findIndex((s) => s.stage === progress.stage) : -1;
    const currentStageIndex = isQueued ? -1 : stageIndexFromStage >= 0 ? stageIndexFromStage : stageIndexFromPercent(percent);

    useEffect(() => {
        if (listRef.current && currentStageIndex >= 0) {
            const el = listRef.current.children[currentStageIndex] as HTMLElement | undefined;
            el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
    }, [currentStageIndex]);

    const queuePos   = progress.queuePosition ?? 0;
    const queueTotal = progress.queue?.queued ?? queuePos;

    const serverLoad = (() => {
        if (progress.queue) {
            const { active, maxConcurrent } = progress.queue;
            return { active, max: maxConcurrent };
        }
        if (progress.limits) {
            const { inFlight, maxConcurrent } = progress.limits;
            return { active: inFlight, max: maxConcurrent };
        }
        return null;
    })();

    let lastSeenGroup: string | null = null;

    return (
        <div
            className="min-h-screen text-white flex items-center justify-center relative overflow-hidden font-sans"
            style={{ background: "#030308" }}
        >
            {/* Canvas particle background */}
            <ParticleCanvas />

            {/* Radial vignette */}
            <div
                className="fixed inset-0 pointer-events-none z-[1]"
                style={{ background: "radial-gradient(ellipse 80% 80% at 50% 50%, transparent 40%, rgba(3,3,8,0.88) 100%)" }}
            />

            {/* Subtle grid */}
            <div
                className="fixed inset-0 pointer-events-none z-[1]"
                style={{
                    backgroundImage: "linear-gradient(rgba(200,168,75,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(200,168,75,0.025) 1px, transparent 1px)",
                    backgroundSize: "48px 48px",
                }}
            />

            {/* Horizontal scan line */}
            <div
                className="fixed left-0 right-0 h-px z-[2] pointer-events-none"
                style={{
                    background: "linear-gradient(90deg, transparent, rgba(200,168,75,0.25) 50%, transparent)",
                    animation: "ticker-scroll 10s linear infinite",
                    top: "35%",
                }}
            />

            {/* Card */}
            <div
                className="relative z-10 flex flex-col items-center gap-5 w-full max-w-sm mx-4 p-8 rounded-2xl"
                style={{
                    background: "linear-gradient(135deg, rgba(200,168,75,0.04) 0%, rgba(8,8,18,0.96) 50%, rgba(200,168,75,0.02) 100%)",
                    border: "1px solid rgba(200,168,75,0.15)",
                    boxShadow: "0 0 60px rgba(200,168,75,0.05), 0 32px 80px rgba(0,0,0,0.65), inset 0 1px 0 rgba(200,168,75,0.08)",
                    backdropFilter: "blur(24px)",
                }}
            >
                {/* FUI corners */}
                <Corner pos="tl" />
                <Corner pos="tr" />
                <Corner pos="bl" />
                <Corner pos="br" />

                {/* Header label */}
                <div className="w-full flex items-center justify-between">
                    <span className="text-[9px] font-bold uppercase tracking-[0.25em]" style={{ color: "rgba(200,168,75,0.4)" }}>
                        NEXUS SCAN
                    </span>
                    <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: "rgba(200,168,75,0.4)" }}>
                        <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#C8A84B", boxShadow: "0 0 6px rgba(200,168,75,0.8)" }} />
                        LIVE
                    </span>
                </div>

                {/* Scanning animation or queue overlay */}
                <div className="my-1">
                    {isQueued
                        ? <QueueOverlay position={queuePos} total={queueTotal} />
                        : <ScanHex percent={percent} />
                    }
                </div>

                {/* Progress message */}
                <div className="w-full text-center space-y-3">
                    <h2
                        className="text-sm font-bold uppercase tracking-[0.12em] leading-tight break-words"
                        style={{ color: "#FFD870", textShadow: "0 0 20px rgba(255,216,112,0.2)" }}
                    >
                        {isQueued ? "Waiting in Queue…" : progress.message}
                    </h2>

                    {/* Progress bar */}
                    {!isQueued && (
                        <div className="relative h-[3px] w-full rounded-full overflow-hidden" style={{ background: "rgba(200,168,75,0.1)" }}>
                            <div
                                className="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out"
                                style={{
                                    width: `${percent}%`,
                                    background: "linear-gradient(90deg, #C8A84B, #FFD870)",
                                    boxShadow: "0 0 8px rgba(255,216,112,0.5)",
                                }}
                            />
                            <div
                                className="absolute inset-y-0 left-0 rounded-full pointer-events-none overflow-hidden"
                                style={{ width: `${percent}%` }}
                            >
                                <div
                                    className="absolute inset-0"
                                    style={{
                                        background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.35) 50%, transparent 100%)",
                                        animation: "shimmer-sweep 2s linear infinite",
                                    }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Stats row */}
                    <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-[0.15em]" style={{ color: "rgba(200,168,75,0.4)" }}>
                        <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" style={{ color: "#C8A84B" }} />
                            {elapsed}
                        </span>
                        {serverLoad && (
                            <span className="flex items-center gap-1.5">
                                <span
                                    className={cn("w-1.5 h-1.5 rounded-full", serverLoad.active >= serverLoad.max ? "animate-pulse" : "")}
                                    style={{
                                        background: serverLoad.active >= serverLoad.max ? "#FFD870" : "#C8A84B",
                                        boxShadow: serverLoad.active >= serverLoad.max ? "0 0 6px rgba(255,216,112,0.8)" : "0 0 4px rgba(200,168,75,0.5)",
                                    }}
                                />
                                {serverLoad.active}/{serverLoad.max} SLOTS
                            </span>
                        )}
                    </div>
                </div>

                {/* Divider */}
                {!isQueued && <div className="w-full h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(200,168,75,0.18), transparent)" }} />}

                {/* Stage list */}
                {!isQueued && (
                    <div
                        ref={listRef}
                        className="w-full max-h-[280px] overflow-y-auto"
                        style={{ scrollbarWidth: "none" }}
                    >
                        {STAGES.map((stage, idx) => {
                            const isCompleted = idx < currentStageIndex;
                            const isCurrent   = idx === currentStageIndex;

                            let groupHeader: React.ReactNode = null;
                            if (stage.group !== lastSeenGroup) {
                                lastSeenGroup = stage.group;
                                groupHeader = (
                                    <div
                                        className="text-[8px] font-black uppercase tracking-[0.25em] pt-3 pb-1 select-none"
                                        style={{ color: idx <= currentStageIndex ? "rgba(200,168,75,0.4)" : "rgba(200,168,75,0.14)" }}
                                    >
                                        {GROUP_LABELS[stage.group]}
                                    </div>
                                );
                            }

                            return (
                                <div key={stage.id}>
                                    {groupHeader}
                                    <div
                                        className="flex items-center gap-3 py-1.5 px-2 rounded-lg text-[10px] font-bold uppercase tracking-[0.1em] transition-all duration-300"
                                        style={{
                                            transitionDelay: `${idx * 15}ms`,
                                            background: isCurrent ? "rgba(200,168,75,0.06)" : "transparent",
                                            color: isCurrent
                                                ? "#FFD870"
                                                : isCompleted
                                                ? "rgba(200,168,75,0.55)"
                                                : "rgba(255,255,255,0.1)",
                                        }}
                                    >
                                        {isCompleted ? (
                                            <CheckCircle2
                                                className="w-3.5 h-3.5 shrink-0"
                                                style={{ color: "#C8A84B", filter: "drop-shadow(0 0 4px rgba(200,168,75,0.4))" }}
                                            />
                                        ) : isCurrent ? (
                                            <Loader2
                                                className="w-3.5 h-3.5 shrink-0 animate-spin"
                                                style={{ color: "#FFD870" }}
                                            />
                                        ) : (
                                            <Circle className="w-3.5 h-3.5 shrink-0" style={{ color: "rgba(200,168,75,0.14)" }} />
                                        )}
                                        <span>{stage.label}</span>
                                        {isCurrent && (
                                            <span
                                                className="ml-auto text-[8px] animate-pulse"
                                                style={{ color: "rgba(255,216,112,0.45)" }}
                                            >
                                                PROCESSING
                                            </span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Footer */}
                <div className="w-full flex items-center justify-between pt-1">
                    <span className="text-[8px] font-bold uppercase tracking-[0.2em]" style={{ color: "rgba(200,168,75,0.2)" }}>NEXUSINSIGHT</span>
                    <span className="text-[8px] font-bold uppercase tracking-[0.2em]" style={{ color: "rgba(200,168,75,0.2)" }}>v2.0</span>
                </div>
            </div>
        </div>
    );
}
