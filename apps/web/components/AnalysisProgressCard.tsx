"use client";

import { Activity, CheckCircle2, Circle, Loader2 } from "lucide-react";
import type { AnalyzeProgressUpdate } from "@/lib/analysisContract";
import { cn } from "@/lib/utils";

type StageDef = {
    id: string;
    label: string;
    stage: string;
    minPercent: number;
};

const STAGES: StageDef[] = [
    { id: "find", label: "Finding Account", stage: "FIND_ACCOUNT", minPercent: 0 },
    { id: "rank", label: "Fetching Ranked Info", stage: "FETCH_RANKED", minPercent: 8 },
    { id: "history", label: "Loading Match History", stage: "MATCH_HISTORY", minPercent: 10 },
    { id: "load", label: "Loading Match Data", stage: "LOAD_MATCH_DATA", minPercent: 72 },
    { id: "train", label: "Training AI Model", stage: "TRAIN_MODEL", minPercent: 75 },
    { id: "perf", label: "Analyzing Performance", stage: "PERFORMANCE_METRICS", minPercent: 78 },
    { id: "lane", label: "Computing Lane Leads", stage: "LANE_LEADS", minPercent: 79 },
    { id: "mood", label: "Analyzing Player Mood", stage: "MOOD", minPercent: 80 },
    { id: "terr", label: "Analyzing Territorial Control", stage: "TERRITORIAL", minPercent: 83 },
    { id: "win", label: "Calculating Win Probability", stage: "WIN_PROB", minPercent: 88 },
    { id: "opp", label: "Comparing Opponent", stage: "OPPONENT_COMPARE", minPercent: 90 },
    { id: "factors", label: "Analyzing Win Factors", stage: "WIN_FACTORS", minPercent: 92 },
    { id: "timeline", label: "Fetching Timeline Data", stage: "FETCH_TIMELINE", minPercent: 95 },
    { id: "final", label: "Finalizing Results", stage: "PREPARE_RESULTS", minPercent: 98 },
];

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

export function AnalysisProgressCard({ progress }: { progress: AnalyzeProgressUpdate }) {
    const percent = clampPercent(progress.percent);

    const stageIndexFromStage =
        typeof progress.stage === "string" ? STAGES.findIndex((s) => s.stage === progress.stage) : -1;

    const currentStageIndex = stageIndexFromStage >= 0 ? stageIndexFromStage : stageIndexFromPercent(percent);

    const limitsText = (() => {
        if (!progress.limits) return `${percent}%`;
        const { inFlight, maxConcurrent, queued } = progress.limits;
        const active = `${inFlight}/${maxConcurrent} active`;
        const queuedText = queued > 0 ? ` • ${queued} queued` : "";
        return active + queuedText;
    })();

    return (
        <div className="min-h-screen bg-[#05050f] text-white flex items-center justify-center relative overflow-hidden font-sans">
            <div className="fixed inset-0 z-0 opacity-40 pointer-events-none bg-mesh" />
            <div className="z-10 flex flex-col items-center gap-8 w-full max-w-md p-8 glass rounded-3xl border border-white/5">
                <div className="relative w-24 h-24">
                    <div className="absolute inset-0 bg-[#5842F4]/20 rounded-full blur-xl animate-pulse" />
                    <div className="absolute inset-0 border-4 border-[#5842F4]/20 border-t-[#5842F4] rounded-full animate-spin" />
                    <div
                        className="absolute inset-3 border-4 border-[#00D1FF]/20 border-b-[#00D1FF] rounded-full animate-spin"
                        style={{ animationDirection: "reverse", animationDuration: "2s" }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Activity className="w-8 h-8 text-white/50" />
                    </div>
                </div>

                <div className="w-full text-center space-y-2">
                    <h2 className="text-xl font-black uppercase italic tracking-tighter leading-tight break-words">
                        {progress.message}
                    </h2>

                    <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-[#5842F4] to-[#00D1FF] transition-all duration-500 ease-out"
                            style={{ width: `${percent}%` }}
                        />
                    </div>

                    <div className="flex justify-between text-xs text-zinc-500 font-bold uppercase tracking-widest mt-2">
                        <span>System Limit</span>
                        <span>{limitsText}</span>
                    </div>
                </div>

                <div className="w-full space-y-2">
                    {STAGES.map((stage, idx) => {
                        const isCompleted = idx < currentStageIndex;
                        const isCurrent = idx === currentStageIndex;
                        return (
                            <div
                                key={stage.id}
                                className={cn(
                                    "flex items-center gap-3 text-xs font-bold uppercase tracking-widest transition-all",
                                    isCurrent
                                        ? "text-white scale-105 pl-2"
                                        : isCompleted
                                            ? "text-[#5842F4]"
                                            : "text-zinc-700"
                                )}
                            >
                                {isCompleted ? (
                                    <CheckCircle2 className="w-4 h-4" />
                                ) : isCurrent ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Circle className="w-4 h-4" />
                                )}
                                {stage.label}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
