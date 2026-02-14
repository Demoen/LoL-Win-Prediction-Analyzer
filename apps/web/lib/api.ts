import type { AnalyzeProgressUpdate, AnalysisResult } from "./analysisContract";
import { normalizeAnalysisResult } from "./analysisContract";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

type AnalyzeStreamEvent =
    | { type: "progress"; message: string; percent: number }
    | { type: "result"; data: unknown }
    | { type: "error"; message: string };

function parseAnalyzeEvent(line: string): AnalyzeStreamEvent | undefined {
    try {
        const event = JSON.parse(line);
        if (!event || typeof event !== 'object') return undefined;
        if (typeof event.type !== 'string') return undefined;
        return event as AnalyzeStreamEvent;
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
                    onProgress({ message: event.message, percent: event.percent });
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
