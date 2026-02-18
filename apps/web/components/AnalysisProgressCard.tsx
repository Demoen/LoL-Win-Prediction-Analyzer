"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, Loader2, Clock, Users } from "lucide-react";
import type { AnalyzeProgressUpdate } from "@/lib/analysisContract";
import { cn } from "@/lib/utils";
import { LogoGlb } from "@/components/LogoGlb";

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
    setup: "Setup",
    data: "Data Collection",
    analysis: "Deep Analysis",
    finalize: "Finalize",
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
/*  Queue waiting overlay                                              */
/* ------------------------------------------------------------------ */
function QueueOverlay({ position, total }: { position: number; total: number }) {
    return (
        <div className="w-full flex flex-col items-center gap-5 py-4 animate-in fade-in duration-500">
            {/* Pulsing ring */}
            <div className="relative flex items-center justify-center w-28 h-28">
                <span className="absolute inset-0 rounded-full border-2 border-[#5842F4]/40 animate-ping" />
                <span className="absolute inset-2 rounded-full border border-[#00D1FF]/30 animate-pulse" />
                <div className="flex flex-col items-center z-10">
                    <span className="text-4xl font-black text-white tabular-nums">{position}</span>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">in queue</span>
                </div>
            </div>

            <div className="text-center space-y-1">
                <p className="text-sm text-zinc-400">
                    <Users className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />
                    {total} {total === 1 ? "person" : "people"} ahead of you
                </p>
                <p className="text-xs text-zinc-600">Analysis will start automatically when a slot opens</p>
            </div>
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

    // Auto-scroll to current stage
    useEffect(() => {
        if (listRef.current && currentStageIndex >= 0) {
            const el = listRef.current.children[currentStageIndex] as HTMLElement | undefined;
            el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
    }, [currentStageIndex]);

    // Queue info
    const queuePos = progress.queuePosition ?? 0;
    const queueTotal = progress.queue?.queued ?? queuePos;

    // Server load bar
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

    /* Which group are we in? */
    let lastSeenGroup: string | null = null;

    return (
        <div className="min-h-screen bg-[#05050f] text-white flex items-center justify-center relative overflow-hidden font-sans">
            <div className="fixed inset-0 z-0 opacity-40 pointer-events-none bg-mesh" />

            <div className="z-10 flex flex-col items-center gap-6 w-full max-w-md p-8 glass rounded-3xl border border-white/5 shadow-2xl shadow-black/40">
                {/* Logo */}
                <div className="relative w-28 h-28">
                    <div className="absolute inset-0 flex items-center justify-center">
                        <LogoGlb className="w-24 h-24" />
                    </div>
                </div>

                {/* Header message */}
                <div className="w-full text-center space-y-3">
                    <h2 className="text-lg font-black uppercase italic tracking-tighter leading-tight break-words">
                        {isQueued ? "Waiting in Queue..." : progress.message}
                    </h2>

                    {/* Progress bar — hidden while queued */}
                    {!isQueued && (
                        <div className="relative h-2 w-full bg-white/5 rounded-full overflow-hidden">
                            <div
                                className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#5842F4] to-[#00D1FF] rounded-full transition-all duration-700 ease-out"
                                style={{ width: `${percent}%` }}
                            />
                            {/* Shimmer */}
                            <div
                                className="absolute inset-y-0 left-0 bg-gradient-to-r from-transparent via-white/20 to-transparent rounded-full animate-shimmer"
                                style={{ width: `${percent}%` }}
                            />
                        </div>
                    )}

                    {/* Stats row */}
                    <div className="flex items-center justify-between text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
                        <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {elapsed}
                        </span>
                        {!isQueued && <span>{percent}%</span>}
                        {serverLoad && (
                            <span className="flex items-center gap-1.5">
                                <span
                                    className={cn(
                                        "w-1.5 h-1.5 rounded-full",
                                        serverLoad.active >= serverLoad.max ? "bg-amber-400 animate-pulse" : "bg-emerald-400",
                                    )}
                                />
                                {serverLoad.active}/{serverLoad.max} slots
                            </span>
                        )}
                    </div>
                </div>

                {/* Queue card */}
                {isQueued && queuePos > 0 && <QueueOverlay position={queuePos} total={queueTotal} />}

                {/* Stage list */}
                {!isQueued && (
                    <div ref={listRef} className="w-full space-y-0.5 max-h-[380px] overflow-y-auto pr-1 scrollbar-thin">
                        {STAGES.map((stage, idx) => {
                            const isCompleted = idx < currentStageIndex;
                            const isCurrent = idx === currentStageIndex;
                            const isPending = idx > currentStageIndex;

                            // Group separator
                            let groupHeader: React.ReactNode = null;
                            if (stage.group !== lastSeenGroup) {
                                lastSeenGroup = stage.group;
                                groupHeader = (
                                    <div
                                        className={cn(
                                            "text-[9px] font-black uppercase tracking-[0.2em] pt-3 pb-1 select-none",
                                            idx <= currentStageIndex ? "text-zinc-500" : "text-zinc-700/60",
                                        )}
                                    >
                                        {GROUP_LABELS[stage.group]}
                                    </div>
                                );
                            }

                            return (
                                <div key={stage.id}>
                                    {groupHeader}
                                    <div
                                        className={cn(
                                            "flex items-center gap-3 py-1.5 px-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all duration-300",
                                            isCurrent && "bg-white/[0.04] text-white",
                                            isCompleted && "text-[#5842F4]",
                                            isPending && "text-zinc-700",
                                        )}
                                        style={{
                                            transitionDelay: `${idx * 20}ms`,
                                        }}
                                    >
                                        {isCompleted ? (
                                            <CheckCircle2 className="w-4 h-4 shrink-0 drop-shadow-[0_0_4px_rgba(88,66,244,0.5)]" />
                                        ) : isCurrent ? (
                                            <Loader2 className="w-4 h-4 shrink-0 animate-spin text-[#00D1FF]" />
                                        ) : (
                                            <Circle className="w-4 h-4 shrink-0 opacity-40" />
                                        )}
                                        <span className={cn(isCurrent && "text-shadow-glow")}>{stage.label}</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
