"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Map, Skull, Eye, Coins, Users, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HeatmapData, HeatmapParticipant } from "@/lib/analysisContract";

const MAP_MAX_FALLBACK = 15000;
const GRID_SIZE = 128;

interface HeatmapVisualizationProps {
    heatmapData: HeatmapData | null;
    ddragonVersion: string;
}

// ── Gaussian blur on a flat Float32Array grid ──
function blurGrid(grid: Float32Array, w: number, h: number, passes: number) {
    const tmp = new Float32Array(w * h);
    for (let p = 0; p < passes; p++) {
        // horizontal
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let sum = 0, count = 0;
                for (let dx = -2; dx <= 2; dx++) {
                    const nx = x + dx;
                    if (nx >= 0 && nx < w) { sum += grid[y * w + nx]; count++; }
                }
                tmp[y * w + x] = sum / count;
            }
        }
        // vertical
        for (let x = 0; x < w; x++) {
            for (let y = 0; y < h; y++) {
                let sum = 0, count = 0;
                for (let dy = -2; dy <= 2; dy++) {
                    const ny = y + dy;
                    if (ny >= 0 && ny < h) { sum += tmp[ny * w + x]; count++; }
                }
                grid[y * w + x] = sum / count;
            }
        }
    }
}

// ── Color mapping for position heat ──
function heatColor(t: number): [number, number, number, number] {
    if (t < 0.01) return [0, 0, 0, 0];
    if (t < 0.3) {
        const f = t / 0.3;
        return [0, Math.round(209 * f), Math.round(255 * f), Math.round(120 * f)];
    }
    if (t < 0.7) {
        const f = (t - 0.3) / 0.4;
        return [Math.round(88 * f), Math.round(209 - 143 * f), Math.round(255 - 11 * f), Math.round(120 + 50 * f)];
    }
    const f = (t - 0.7) / 0.3;
    return [Math.round(88 + 167 * f), Math.round(66 + 189 * f), Math.round(244 + 11 * f), Math.round(170 + 40 * f)];
}

// ── Color mapping for gold zones ──
function goldColor(t: number): [number, number, number, number] {
    if (t < 0.01) return [0, 0, 0, 0];
    const f = Math.min(1, t);
    return [255, Math.round(215 - 75 * f), 0, Math.round(80 + 80 * f)];
}

export function HeatmapVisualization({ heatmapData, ddragonVersion }: HeatmapVisualizationProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const mapImgRef = useRef<HTMLImageElement | null>(null);
    const [mapLoaded, setMapLoaded] = useState(false);
    const [selectedParticipant, setSelectedParticipant] = useState<number | null>(null);
    const [layers, setLayers] = useState({ positions: true, kills: true, wards: false, goldZones: false });

    const mapMax = useMemo(() => {
        if (!heatmapData) return MAP_MAX_FALLBACK;

        let max = MAP_MAX_FALLBACK;

        for (const p of heatmapData.participants || []) {
            for (const pos of p.positions || []) {
                if (typeof pos?.x === 'number' && pos.x > max) max = pos.x;
                if (typeof pos?.y === 'number' && pos.y > max) max = pos.y;
            }
        }

        for (const k of heatmapData.kill_events || []) {
            if (typeof k?.x === 'number' && k.x > max) max = k.x;
            if (typeof k?.y === 'number' && k.y > max) max = k.y;
        }

        for (const w of heatmapData.ward_events || []) {
            if (typeof w?.x === 'number' && w.x > max) max = w.x;
            if (typeof w?.y === 'number' && w.y > max) max = w.y;
        }

        return max;
    }, [heatmapData]);

    // Load map image once
    useEffect(() => {
        setMapLoaded(false);
        const img = new Image();
        img.crossOrigin = "anonymous";

        const primary = "/map-dark.png";
        const fallback = `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/map/map11.png`;
        let usedFallback = false;

        img.onload = () => {
            mapImgRef.current = img;
            setMapLoaded(true);
        };
        img.onerror = () => {
            if (usedFallback) return;
            usedFallback = true;
            img.src = fallback;
        };

        img.src = primary;

        return () => {
            img.onload = null;
            img.onerror = null;
        };
    }, [ddragonVersion]);

    // Separate participants by team
    const blueTeam = useMemo(() => heatmapData?.participants.filter(p => p.teamId === 100) ?? [], [heatmapData]);
    const redTeam = useMemo(() => heatmapData?.participants.filter(p => p.teamId === 200) ?? [], [heatmapData]);

    // ── Compute density grids (memoized) ──
    const positionGrid = useMemo(() => {
        if (!heatmapData) return null;
        const grid = new Float32Array(GRID_SIZE * GRID_SIZE);
        const participants = selectedParticipant
            ? heatmapData.participants.filter(p => p.participantId === selectedParticipant)
            : heatmapData.participants;

        for (const p of participants) {
            for (const pos of p.positions) {
                const gx = Math.floor((pos.x / mapMax) * (GRID_SIZE - 1));
                const gy = Math.floor(((mapMax - pos.y) / mapMax) * (GRID_SIZE - 1)); // flip Y
                if (gx >= 0 && gx < GRID_SIZE && gy >= 0 && gy < GRID_SIZE) {
                    grid[gy * GRID_SIZE + gx] += 1;
                }
            }
        }
        blurGrid(grid, GRID_SIZE, GRID_SIZE, 3);
        // normalize
        let max = 0;
        for (let i = 0; i < grid.length; i++) if (grid[i] > max) max = grid[i];
        if (max > 0) for (let i = 0; i < grid.length; i++) grid[i] /= max;
        return grid;
    }, [heatmapData, selectedParticipant, mapMax]);

    const goldGrid = useMemo(() => {
        if (!heatmapData) return null;
        const grid = new Float32Array(GRID_SIZE * GRID_SIZE);
        const participants = selectedParticipant
            ? heatmapData.participants.filter(p => p.participantId === selectedParticipant)
            : heatmapData.participants;

        for (const p of participants) {
            for (const pos of p.positions) {
                if (pos.goldDelta <= 0) continue;
                const gx = Math.floor((pos.x / mapMax) * (GRID_SIZE - 1));
                const gy = Math.floor(((mapMax - pos.y) / mapMax) * (GRID_SIZE - 1));
                if (gx >= 0 && gx < GRID_SIZE && gy >= 0 && gy < GRID_SIZE) {
                    grid[gy * GRID_SIZE + gx] += pos.goldDelta;
                }
            }
        }
        blurGrid(grid, GRID_SIZE, GRID_SIZE, 3);
        let max = 0;
        for (let i = 0; i < grid.length; i++) if (grid[i] > max) max = grid[i];
        if (max > 0) for (let i = 0; i < grid.length; i++) grid[i] /= max;
        return grid;
    }, [heatmapData, selectedParticipant, mapMax]);

    // ── Canvas rendering ──
    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        const mapImg = mapImgRef.current;
        if (!canvas || !container || !mapImg || !mapLoaded) return;

        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) return;

        const rect = container.getBoundingClientRect();
        const size = Math.min(rect.width, rect.height);
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.floor(size * dpr);
        canvas.height = Math.floor(size * dpr);
        canvas.style.width = `${size}px`;
        canvas.style.height = `${size}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const W = size;
        const H = size;

        // Draw map background
        ctx.fillStyle = "#05050f";
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 0.7;
        ctx.drawImage(mapImg, 0, 0, W, H);
        ctx.globalAlpha = 1;

        // Helper: map coords → canvas coords
        const toCanvas = (mx: number, my: number) => ({
            x: (mx / mapMax) * W,
            y: ((mapMax - my) / mapMax) * H,
        });

        // ── Position Heat Layer ──
        if (layers.positions && positionGrid) {
            const cellW = W / GRID_SIZE;
            const cellH = H / GRID_SIZE;
            const imgData = ctx.createImageData(GRID_SIZE, GRID_SIZE);
            for (let i = 0; i < positionGrid.length; i++) {
                const [r, g, b, a] = heatColor(positionGrid[i]);
                imgData.data[i * 4] = r;
                imgData.data[i * 4 + 1] = g;
                imgData.data[i * 4 + 2] = b;
                imgData.data[i * 4 + 3] = a;
            }
            // Draw to offscreen then scale up
            const off = document.createElement("canvas");
            off.width = GRID_SIZE;
            off.height = GRID_SIZE;
            off.getContext("2d")!.putImageData(imgData, 0, 0);
            ctx.globalCompositeOperation = "lighter";
            ctx.drawImage(off, 0, 0, W, H);
            ctx.globalCompositeOperation = "source-over";
        }

        // ── Gold Zones Layer ──
        if (layers.goldZones && goldGrid) {
            const imgData = ctx.createImageData(GRID_SIZE, GRID_SIZE);
            for (let i = 0; i < goldGrid.length; i++) {
                const [r, g, b, a] = goldColor(goldGrid[i]);
                imgData.data[i * 4] = r;
                imgData.data[i * 4 + 1] = g;
                imgData.data[i * 4 + 2] = b;
                imgData.data[i * 4 + 3] = a;
            }
            const off = document.createElement("canvas");
            off.width = GRID_SIZE;
            off.height = GRID_SIZE;
            off.getContext("2d")!.putImageData(imgData, 0, 0);
            ctx.globalCompositeOperation = "lighter";
            ctx.drawImage(off, 0, 0, W, H);
            ctx.globalCompositeOperation = "source-over";
        }

        // ── Kill Events Layer ──
        if (layers.kills && heatmapData) {
            const kills = heatmapData.kill_events.filter(k => {
                if (!selectedParticipant) return true;
                return k.killerId === selectedParticipant || k.victimId === selectedParticipant;
            });
            for (const k of kills) {
                const { x, y } = toCanvas(k.x, k.y);
                const isKill = !selectedParticipant || k.killerId === selectedParticipant;
                const color = isKill ? "#22c55e" : "#ef4444";
                const glowColor = isKill ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)";

                ctx.save();
                ctx.shadowColor = glowColor;
                ctx.shadowBlur = 12;
                ctx.beginPath();
                ctx.arc(x, y, 6, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();
                ctx.strokeStyle = "rgba(255,255,255,0.5)";
                ctx.lineWidth = 1.5;
                ctx.stroke();
                ctx.restore();

                // Small skull for kills
                if (isKill) {
                    ctx.fillStyle = "white";
                    ctx.font = "bold 9px sans-serif";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText("\u2620", x, y);
                }
            }
        }

        // ── Ward Events Layer ──
        if (layers.wards && heatmapData) {
            const wards = heatmapData.ward_events.filter(w => {
                if (!selectedParticipant) return true;
                return w.creatorId === selectedParticipant;
            });
            for (const w of wards) {
                const { x, y } = toCanvas(w.x, w.y);
                let color = "#FFD700"; // default yellow
                if (w.wardType === "CONTROL_WARD") color = "#FF69B4";
                else if (w.wardType === "BLUE_TRINKET") color = "#00D1FF";

                ctx.save();
                ctx.shadowColor = color;
                ctx.shadowBlur = 8;

                // Diamond shape
                ctx.beginPath();
                ctx.moveTo(x, y - 5);
                ctx.lineTo(x + 4, y);
                ctx.lineTo(x, y + 5);
                ctx.lineTo(x - 4, y);
                ctx.closePath();
                ctx.fillStyle = color;
                ctx.globalAlpha = 0.85;
                ctx.fill();
                ctx.strokeStyle = "rgba(255,255,255,0.4)";
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.restore();
                ctx.globalAlpha = 1;
            }
        }

        // ── Vignette ──
        const vg = ctx.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, W * 0.7);
        vg.addColorStop(0, "rgba(5,5,15,0)");
        vg.addColorStop(1, "rgba(5,5,15,0.5)");
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, W, H);

    }, [mapLoaded, heatmapData, selectedParticipant, layers, positionGrid, goldGrid, mapMax]);

    // Redraw on any state change
    useEffect(() => { draw(); }, [draw]);

    // Redraw on resize
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const ro = new ResizeObserver(() => draw());
        ro.observe(container);
        return () => ro.disconnect();
    }, [draw]);

    const toggleLayer = (key: keyof typeof layers) => {
        setLayers(prev => ({ ...prev, [key]: !prev[key] }));
    };

    // ── Empty state ──
    if (!heatmapData || !heatmapData.participants?.length) {
        return (
            <div className="glass rounded-3xl border border-white/5 flex items-center justify-center h-[500px]">
                <div className="text-center">
                    <Map className="w-12 h-12 mx-auto mb-3 text-zinc-600" />
                    <p className="text-sm text-zinc-500">No heatmap data available for the last match.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <Map className="w-6 h-6 text-[#00D1FF]" />
                <h2 className="text-xl font-black uppercase italic tracking-tighter">Match Heatmap</h2>
                <span className="px-3 py-1 bg-[#00D1FF]/10 text-[#00D1FF] rounded text-[10px] font-bold uppercase tracking-widest">Last Match</span>
            </div>

            {/* Champion Selector */}
            <div className="glass rounded-2xl p-5 border border-white/5 space-y-4">
                <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Select Champion</div>

                {/* Blue Team */}
                <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-blue-400 w-16 shrink-0">Blue</span>
                    {blueTeam.map(p => (
                        <button
                            key={p.participantId}
                            onClick={() => setSelectedParticipant(selectedParticipant === p.participantId ? null : p.participantId)}
                            className={cn(
                                "relative w-10 h-10 rounded-lg overflow-hidden border-2 transition-all hover:scale-110",
                                selectedParticipant === p.participantId
                                    ? "border-[#00D1FF] shadow-[0_0_12px_rgba(0,209,255,0.4)] scale-110"
                                    : "border-blue-500/30 opacity-70 hover:opacity-100"
                            )}
                            title={p.championName}
                        >
                            <img
                                src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/champion/${p.championName}.png`}
                                alt={p.championName}
                                className="w-full h-full object-cover"
                            />
                        </button>
                    ))}
                </div>

                {/* Red Team */}
                <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-red-400 w-16 shrink-0">Red</span>
                    {redTeam.map(p => (
                        <button
                            key={p.participantId}
                            onClick={() => setSelectedParticipant(selectedParticipant === p.participantId ? null : p.participantId)}
                            className={cn(
                                "relative w-10 h-10 rounded-lg overflow-hidden border-2 transition-all hover:scale-110",
                                selectedParticipant === p.participantId
                                    ? "border-[#00D1FF] shadow-[0_0_12px_rgba(0,209,255,0.4)] scale-110"
                                    : "border-red-500/30 opacity-70 hover:opacity-100"
                            )}
                            title={p.championName}
                        >
                            <img
                                src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/champion/${p.championName}.png`}
                                alt={p.championName}
                                className="w-full h-full object-cover"
                            />
                        </button>
                    ))}
                </div>

                {/* All Players button */}
                <button
                    onClick={() => setSelectedParticipant(null)}
                    className={cn(
                        "flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all",
                        selectedParticipant === null
                            ? "bg-[#5842F4] text-white shadow-lg"
                            : "bg-white/5 text-zinc-500 hover:text-white"
                    )}
                >
                    <Users className="w-3.5 h-3.5" />
                    All Players
                </button>
            </div>

            {/* Layer Toggles */}
            <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mr-2">Layers</span>
                {([
                    { key: "positions" as const, label: "Position Heat", color: "bg-[#00D1FF]", icon: Flame },
                    { key: "kills" as const, label: "Kills", color: "bg-red-500", icon: Skull },
                    { key: "wards" as const, label: "Wards", color: "bg-[#FFD700]", icon: Eye },
                    { key: "goldZones" as const, label: "Gold Zones", color: "bg-amber-500", icon: Coins },
                ]).map(({ key, label, color, icon: Icon }) => (
                    <button
                        key={key}
                        onClick={() => toggleLayer(key)}
                        className={cn(
                            "flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all",
                            layers[key]
                                ? `${color} text-white shadow-lg`
                                : "bg-white/5 text-zinc-500 hover:text-white"
                        )}
                    >
                        <Icon className="w-3.5 h-3.5" />
                        {label}
                    </button>
                ))}
            </div>

            {/* Map Canvas */}
            <div className="glass rounded-2xl border border-white/5 p-3 overflow-hidden">
                <div ref={containerRef} className="w-full aspect-square max-w-[800px] mx-auto">
                    <canvas ref={canvasRef} className="w-full h-full rounded-xl" />
                </div>
            </div>

            {/* Legend */}
            <div className="glass rounded-2xl p-5 border border-white/5">
                <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-3">Legend</div>
                <div className="flex flex-wrap gap-6 text-xs text-zinc-400">
                    {layers.kills && (
                        <>
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full bg-green-500" />
                                <span>Kill</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full bg-red-500" />
                                <span>Death</span>
                            </div>
                        </>
                    )}
                    {layers.wards && (
                        <>
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rotate-45 bg-[#FFD700]" />
                                <span>Trinket Ward</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rotate-45 bg-[#FF69B4]" />
                                <span>Control Ward</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rotate-45 bg-[#00D1FF]" />
                                <span>Blue Trinket</span>
                            </div>
                        </>
                    )}
                    {layers.positions && (
                        <div className="flex items-center gap-2">
                            <div className="w-12 h-3 rounded-sm" style={{ background: "linear-gradient(to right, #00D1FF, #5842F4, white)" }} />
                            <span>Position Density</span>
                        </div>
                    )}
                    {layers.goldZones && (
                        <div className="flex items-center gap-2">
                            <div className="w-12 h-3 rounded-sm" style={{ background: "linear-gradient(to right, rgba(255,215,0,0.3), #FFD700)" }} />
                            <span>Gold Earned</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
