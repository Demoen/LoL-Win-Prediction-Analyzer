import type { AnalyzeProgressUpdate, AnalysisResult, RiotApiLimits, QueueStats } from "./analysisContract";
import { normalizeAnalysisResult } from "./analysisContract";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

type AnalyzeStreamEvent =
    | { type: "progress"; message: string; percent: number; stage?: string; limits?: RiotApiLimits; queue?: QueueStats; queuePosition?: number }
    | { type: "result"; data: unknown }
    | { type: "error"; message: string };

function clampPercent(value: unknown): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
}

function parseLimits(limits: unknown): RiotApiLimits | undefined {
    if (!limits || typeof limits !== 'object') return undefined;
    const obj = limits as Record<string, unknown>;
    const maxConcurrent = typeof obj.maxConcurrent === 'number' ? obj.maxConcurrent : Number(obj.maxConcurrent);
    const inFlight = typeof obj.inFlight === 'number' ? obj.inFlight : Number(obj.inFlight);
    const queued = typeof obj.queued === 'number' ? obj.queued : Number(obj.queued);

    if (!Number.isFinite(maxConcurrent) || !Number.isFinite(inFlight) || !Number.isFinite(queued)) return undefined;
    return {
        maxConcurrent: Math.max(1, Math.floor(maxConcurrent)),
        inFlight: Math.max(0, Math.floor(inFlight)),
        queued: Math.max(0, Math.floor(queued)),
    };
}

function parseQueueStats(q: unknown): QueueStats | undefined {
    if (!q || typeof q !== 'object') return undefined;
    const obj = q as Record<string, unknown>;
    const maxConcurrent = typeof obj.maxConcurrent === 'number' ? obj.maxConcurrent : Number(obj.maxConcurrent);
    const active = typeof obj.active === 'number' ? obj.active : Number(obj.active);
    const queued = typeof obj.queued === 'number' ? obj.queued : Number(obj.queued);
    if (!Number.isFinite(maxConcurrent) || !Number.isFinite(active) || !Number.isFinite(queued)) return undefined;
    return {
        maxConcurrent: Math.max(1, Math.floor(maxConcurrent)),
        active: Math.max(0, Math.floor(active)),
        queued: Math.max(0, Math.floor(queued)),
    };
}

function parseAnalyzeEvent(line: string): AnalyzeStreamEvent | undefined {
    try {
        const event = JSON.parse(line);
        if (!event || typeof event !== 'object') return undefined;
        if (typeof event.type !== 'string') return undefined;

        if (event.type === 'progress') {
            if (typeof event.message !== 'string') return undefined;
            const percent = clampPercent(event.percent);
            const stage = typeof event.stage === 'string' ? event.stage : undefined;
            const limits = parseLimits(event.limits);
            const queue = parseQueueStats(event.queue);
            const queuePosition = typeof event.queuePosition === 'number' ? Math.max(0, Math.floor(event.queuePosition)) : undefined;
            return { type: 'progress', message: event.message, percent, stage, limits, queue, queuePosition };
        }

        if (event.type === 'error') {
            if (typeof event.message !== 'string') return undefined;
            return { type: 'error', message: event.message };
        }

        if (event.type === 'result') {
            return { type: 'result', data: event.data };
        }

        return undefined;
    } catch {
        return undefined;
    }
}

export async function analyzeStats(
    riotId: string,
    region: string,
    onProgress?: (progress: AnalyzeProgressUpdate) => void
): Promise<AnalysisResult> {

    try {
        const response = await fetch(`${API_URL}/analyze`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            cache: "no-store",
            body: JSON.stringify({ riot_id: riotId, region }),
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || "Failed to analyze stats");
        }

        if (!response.body) throw new Error("No response body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            
            if (value) {
                buffer += decoder.decode(value, { stream: !done });
            }
            
            // Process complete lines (newline-delimited JSON)
            let newlineIndex;
            while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
                const line = buffer.slice(0, newlineIndex).trim();
                buffer = buffer.slice(newlineIndex + 1);
                
                if (!line) continue;

                const event = parseAnalyzeEvent(line);
                if (!event) continue;

                if (event.type === "progress" && onProgress) {
                    onProgress({
                        message: event.message,
                        percent: event.percent,
                        stage: event.stage,
                        limits: event.limits,
                        queue: event.queue,
                        queuePosition: event.queuePosition,
                    });
                } else if (event.type === "result") {
                    return normalizeAnalysisResult(event.data);
                } else if (event.type === "error") {
                    throw new Error(event.message);
                }
            }
            
            if (done) break;
        }
        
        // Handle any remaining buffer content after stream ends
        if (buffer.trim()) {
            const event = parseAnalyzeEvent(buffer.trim());
            if (event?.type === "result") return normalizeAnalysisResult(event.data);
            if (event?.type === "error") throw new Error(event.message);
        }
        
        // If we reach here without returning, the stream ended without a result
        throw new Error("Stream ended without receiving analysis result");

    } catch (error: unknown) {
        console.error("Analysis error:", error);
        throw error;
    }
}
