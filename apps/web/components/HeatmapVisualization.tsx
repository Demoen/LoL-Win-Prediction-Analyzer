"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Map, Skull, Eye, Coins, Users, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HeatmapData } from "@/lib/analysisContract";

const MAP_COORD_MAX = 15000;
const GRID_SIZE = 192; // Higher res for smoother heat

interface HeatmapVisualizationProps {
    heatmapData: HeatmapData | null;
    ddragonVersion: string;
}

// ── Gaussian blur (box-blur approximation, 2-pass separable) ──
function blurGrid(grid: Float32Array, w: number, h: number, passes: number) {
    const tmp = new Float32Array(w * h);
    for (let p = 0; p < passes; p++) {
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

// ── Color ramp: transparent → cyan → purple → white-hot ──
function heatColor(t: number): [number, number, number, number] {
    if (t < 0.02) return [0, 0, 0, 0];
    if (t < 0.25) {
        const f = (t - 0.02) / 0.23;
        return [0, Math.round(180 * f), Math.round(255 * f), Math.round(100 * f)];
    }
    if (t < 0.55) {
        const f = (t - 0.25) / 0.30;
        return [Math.round(88 * f), Math.round(180 + 29 * f), Math.round(255), Math.round(100 + 60 * f)];
    }
    if (t < 0.8) {
        const f = (t - 0.55) / 0.25;
        return [Math.round(88 + 80 * f), Math.round(209 - 143 * f), Math.round(255 - 11 * f), Math.round(160 + 30 * f)];
    }
    const f = (t - 0.8) / 0.2;
    return [Math.round(168 + 87 * f), Math.round(66 + 189 * f), Math.round(244 + 11 * f), Math.round(190 + 40 * f)];
}

function goldColor(t: number): [number, number, number, number] {
    if (t < 0.02) return [0, 0, 0, 0];
    const f = Math.min(1, t);
    return [255, Math.round(215 - 75 * f), 0, Math.round(60 + 100 * f)];
}

function championAssetKey(championName: string): string {
    const aliases: Record<string, string> = {
        "Wukong": "MonkeyKing",
        "Nunu": "Nunu",
        "Nunu & Willump": "Nunu",
        "Renata Glasc": "Renata",
        "Cho'Gath": "Chogath",
        "Kha'Zix": "Khazix",
        "Kai'Sa": "Kaisa",
        "Vel'Koz": "Velkoz",
        "LeBlanc": "Leblanc",
        "Kog'Maw": "KogMaw",
        "Rek'Sai": "RekSai",
        "Bel'Veth": "Belveth",
    };
    if (aliases[championName]) return aliases[championName];
    return championName
        .replace(/[^A-Za-z]/g, "")
        .replace(/^([a-z])/, (m) => m.toUpperCase());
}

// Render an offscreen grid as ImageData then scale to canvas with blur
function renderGridLayer(
    ctx: CanvasRenderingContext2D,
    grid: Float32Array,
    colorFn: (t: number) => [number, number, number, number],
    W: number, H: number,
    blurPx: number,
) {
    const imgData = new ImageData(GRID_SIZE, GRID_SIZE);
    for (let i = 0; i < grid.length; i++) {
        const [r, g, b, a] = colorFn(grid[i]);
        imgData.data[i * 4] = r;
        imgData.data[i * 4 + 1] = g;
        imgData.data[i * 4 + 2] = b;
        imgData.data[i * 4 + 3] = a;
    }
    const off = document.createElement("canvas");
    off.width = GRID_SIZE;
    off.height = GRID_SIZE;
    off.getContext("2d")!.putImageData(imgData, 0, 0);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.filter = `blur(${blurPx}px)`;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(off, 0, 0, W, H);
    ctx.restore();
}

export function HeatmapVisualization({ heatmapData, ddragonVersion }: HeatmapVisualizationProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const mapImgRef = useRef<HTMLImageElement | null>(null);
    const [mapLoaded, setMapLoaded] = useState(false);
    const [selectedParticipant, setSelectedParticipant] = useState<number | null>(null);
    const [layers, setLayers] = useState({ positions: true, kills: true, wards: true, goldZones: false });

    const clampMap = (v: number) => Math.max(0, Math.min(MAP_COORD_MAX, v));

    // Load map image
    useEffect(() => {
        setMapLoaded(false);
        const img = new Image();
        img.crossOrigin = "anonymous";
        const primary = `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/map/map11.png`;
        const fallback = "/map-dark.png";
        let usedFallback = false;
        img.onload = () => { mapImgRef.current = img; setMapLoaded(true); };
        img.onerror = () => { if (usedFallback) return; usedFallback = true; img.src = fallback; };
        img.src = primary;
        return () => { img.onload = null; img.onerror = null; };
    }, [ddragonVersion]);

    const blueTeam = useMemo(() => heatmapData?.participants.filter(p => p.teamId === 100) ?? [], [heatmapData]);
    const redTeam = useMemo(() => heatmapData?.participants.filter(p => p.teamId === 200) ?? [], [heatmapData]);

    // Participant lookup for champion names on kill markers
    const participantMap = useMemo(() => {
        const map = new Map<number, { championName: string; teamId: number }>();
        heatmapData?.participants.forEach(p => map.set(p.participantId, { championName: p.championName, teamId: p.teamId }));
        return map;
    }, [heatmapData]);

    // ── Density grids ──
    const positionGrid = useMemo(() => {
        if (!heatmapData) return null;
        const grid = new Float32Array(GRID_SIZE * GRID_SIZE);
        const parts = selectedParticipant
            ? heatmapData.participants.filter(p => p.participantId === selectedParticipant)
            : heatmapData.participants;
        for (const p of parts) {
            for (const pos of p.positions) {
                const gx = Math.floor((clampMap(pos.x) / MAP_COORD_MAX) * (GRID_SIZE - 1));
                const gy = Math.floor(((MAP_COORD_MAX - clampMap(pos.y)) / MAP_COORD_MAX) * (GRID_SIZE - 1));
                if (gx >= 0 && gx < GRID_SIZE && gy >= 0 && gy < GRID_SIZE) grid[gy * GRID_SIZE + gx] += 1;
            }
        }
        blurGrid(grid, GRID_SIZE, GRID_SIZE, 4);
        let max = 0;
        for (let i = 0; i < grid.length; i++) if (grid[i] > max) max = grid[i];
        if (max > 0) for (let i = 0; i < grid.length; i++) grid[i] = Math.sqrt(grid[i] / max); // sqrt compression
        return grid;
    }, [heatmapData, selectedParticipant]);

    const goldGrid = useMemo(() => {
        if (!heatmapData) return null;
        const grid = new Float32Array(GRID_SIZE * GRID_SIZE);
        const parts = selectedParticipant
            ? heatmapData.participants.filter(p => p.participantId === selectedParticipant)
            : heatmapData.participants;
        for (const p of parts) {
            for (const pos of p.positions) {
                if (pos.goldDelta <= 0) continue;
                const gx = Math.floor((clampMap(pos.x) / MAP_COORD_MAX) * (GRID_SIZE - 1));
                const gy = Math.floor(((MAP_COORD_MAX - clampMap(pos.y)) / MAP_COORD_MAX) * (GRID_SIZE - 1));
                if (gx >= 0 && gx < GRID_SIZE && gy >= 0 && gy < GRID_SIZE)
                    grid[gy * GRID_SIZE + gx] += Math.log1p(pos.goldDelta);
            }
        }
        blurGrid(grid, GRID_SIZE, GRID_SIZE, 4);
        let max = 0;
        for (let i = 0; i < grid.length; i++) if (grid[i] > max) max = grid[i];
        if (max > 0) for (let i = 0; i < grid.length; i++) grid[i] = Math.sqrt(grid[i] / max);
        return grid;
    }, [heatmapData, selectedParticipant]);

    // ── Draw ──
    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        const mapImg = mapImgRef.current;
        if (!canvas || !container || !mapImg || !mapLoaded) return;

        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) return;

        const rect = container.getBoundingClientRect();
        const size = Math.min(rect.width, rect.height);
        if (size <= 0) return;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.floor(size * dpr);
        canvas.height = Math.floor(size * dpr);
        canvas.style.width = `${size}px`;
        canvas.style.height = `${size}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const W = size;
        const H = size;

        // ── Map background ──
        ctx.fillStyle = "#05050f";
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 0.75;
        ctx.drawImage(mapImg, 0, 0, W, H);
        ctx.globalAlpha = 1;
        // Darken to match cyberpunk aesthetic
        ctx.fillStyle = "rgba(5,5,15,0.45)";
        ctx.fillRect(0, 0, W, H);

        const toCanvas = (mx: number, my: number) => ({
            x: (clampMap(mx) / MAP_COORD_MAX) * W,
            y: ((MAP_COORD_MAX - clampMap(my)) / MAP_COORD_MAX) * H,
        });

        // Scale factor for markers based on canvas size
        const s = W / 600;

        // ── Position Heat ──
        if (layers.positions && positionGrid) {
            renderGridLayer(ctx, positionGrid, heatColor, W, H, Math.max(4, 6 * s));
        }

        // ── Gold Zones ──
        if (layers.goldZones && goldGrid) {
            renderGridLayer(ctx, goldGrid, goldColor, W, H, Math.max(4, 8 * s));
        }

        // ── Kill Events ──
        if (layers.kills && heatmapData) {
            const kills = heatmapData.kill_events.filter(k => {
                if (!selectedParticipant) return true;
                return k.killerId === selectedParticipant || k.victimId === selectedParticipant;
            });
            for (const k of kills) {
                const { x, y } = toCanvas(k.x, k.y);
                const isKill = !selectedParticipant || k.killerId === selectedParticipant;
                const r = Math.max(5, 8 * s);

                // Outer glow
                ctx.save();
                ctx.shadowColor = isKill ? "rgba(34,197,94,0.6)" : "rgba(239,68,68,0.6)";
                ctx.shadowBlur = 16 * s;
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fillStyle = isKill ? "#22c55e" : "#ef4444";
                ctx.fill();
                ctx.restore();

                // White border
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.strokeStyle = "rgba(255,255,255,0.7)";
                ctx.lineWidth = Math.max(1, 1.5 * s);
                ctx.stroke();

                // Icon inside
                ctx.fillStyle = "white";
                ctx.font = `bold ${Math.max(8, 11 * s)}px sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(isKill ? "\u2694" : "\u2620", x, y + 0.5);

                // Champion name label
                const victim = participantMap.get(k.victimId);
                const killer = participantMap.get(k.killerId);
                const labelName = isKill ? (victim?.championName ?? "") : (killer?.championName ?? "");
                if (labelName) {
                    const fontSize = Math.max(7, 9 * s);
                    ctx.font = `bold ${fontSize}px sans-serif`;
                    const labelW = ctx.measureText(labelName).width + 6;
                    const lx = x - labelW / 2;
                    const ly = y + r + 3;
                    ctx.fillStyle = "rgba(0,0,0,0.7)";
                    ctx.beginPath();
                    ctx.roundRect(lx, ly, labelW, fontSize + 4, 3);
                    ctx.fill();
                    ctx.fillStyle = isKill ? "#86efac" : "#fca5a5";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "top";
                    ctx.fillText(labelName, x, ly + 2);
                }
            }
        }

        // ── Ward Events ──
        if (layers.wards && heatmapData) {
            const wards = heatmapData.ward_events.filter(w => {
                if (!selectedParticipant) return true;
                return w.creatorId === selectedParticipant;
            });
            for (const w of wards) {
                const { x, y } = toCanvas(w.x, w.y);
                let fillColor = "#FFD700";
                let label = "W";
                if (w.wardType === "CONTROL_WARD") { fillColor = "#FF69B4"; label = "C"; }
                else if (w.wardType === "BLUE_TRINKET") { fillColor = "#00D1FF"; label = "B"; }
                const r = Math.max(5, 7 * s);

                ctx.save();
                ctx.shadowColor = fillColor;
                ctx.shadowBlur = 10 * s;

                // Eye-shaped ward marker (two arcs)
                ctx.beginPath();
                ctx.ellipse(x, y, r * 1.3, r * 0.8, 0, 0, Math.PI * 2);
                ctx.fillStyle = fillColor;
                ctx.globalAlpha = 0.9;
                ctx.fill();
                ctx.strokeStyle = "rgba(255,255,255,0.5)";
                ctx.lineWidth = Math.max(1, 1 * s);
                ctx.stroke();
                ctx.restore();

                // Inner pupil dot
                ctx.beginPath();
                ctx.arc(x, y, r * 0.35, 0, Math.PI * 2);
                ctx.fillStyle = "rgba(0,0,0,0.6)";
                ctx.fill();
            }
        }

        // ── Vignette ──
        const vg = ctx.createRadialGradient(W / 2, H / 2, W * 0.35, W / 2, H / 2, W * 0.72);
        vg.addColorStop(0, "rgba(5,5,15,0)");
        vg.addColorStop(1, "rgba(5,5,15,0.45)");
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, W, H);

    }, [mapLoaded, heatmapData, selectedParticipant, layers, positionGrid, goldGrid, participantMap]);

    useEffect(() => { draw(); }, [draw]);

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

    const wardCount = heatmapData.ward_events.filter(w => !selectedParticipant || w.creatorId === selectedParticipant).length;
    const killCount = heatmapData.kill_events.filter(k => !selectedParticipant || k.killerId === selectedParticipant).length;
    const deathCount = heatmapData.kill_events.filter(k => !selectedParticipant || k.victimId === selectedParticipant).length;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <Map className="w-6 h-6 text-[#00D1FF]" />
                <h2 className="text-xl font-black uppercase italic tracking-tighter">Match Heatmap</h2>
                <span className="px-3 py-1 bg-[#00D1FF]/10 text-[#00D1FF] rounded text-[10px] font-bold uppercase tracking-widest">Last Match</span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6">
                {/* Left: Map Canvas */}
                <div className="space-y-4">
                    {/* Layer Toggles */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 mr-1">Layers</span>
                        {([
                            { key: "positions" as const, label: "Heat", color: "bg-[#00D1FF]", icon: Flame },
                            { key: "kills" as const, label: "Kills", color: "bg-red-500", icon: Skull },
                            { key: "wards" as const, label: "Wards", color: "bg-[#FFD700]", icon: Eye },
                            { key: "goldZones" as const, label: "Gold", color: "bg-amber-500", icon: Coins },
                        ]).map(({ key, label, color, icon: Icon }) => (
                            <button
                                key={key}
                                onClick={() => toggleLayer(key)}
                                className={cn(
                                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all",
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

                    {/* Canvas */}
                    <div className="glass rounded-2xl border border-white/5 p-2 overflow-hidden">
                        <div ref={containerRef} className="w-full aspect-square max-w-[800px] mx-auto">
                            <canvas ref={canvasRef} className="w-full h-full rounded-xl" />
                        </div>
                    </div>

                    {/* Legend */}
                    <div className="flex flex-wrap gap-5 text-[11px] text-zinc-400 px-1">
                        {layers.kills && (
                            <>
                                <div className="flex items-center gap-1.5">
                                    <div className="w-3 h-3 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]" />
                                    <span>Kill ({killCount})</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <div className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]" />
                                    <span>Death ({deathCount})</span>
                                </div>
                            </>
                        )}
                        {layers.wards && (
                            <>
                                <div className="flex items-center gap-1.5">
                                    <div className="w-4 h-2.5 rounded-full bg-[#FFD700]" />
                                    <span>Trinket</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <div className="w-4 h-2.5 rounded-full bg-[#FF69B4]" />
                                    <span>Control</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <div className="w-4 h-2.5 rounded-full bg-[#00D1FF]" />
                                    <span>Blue Trinket</span>
                                </div>
                                <span className="text-zinc-600">({wardCount} wards)</span>
                            </>
                        )}
                        {layers.positions && (
                            <div className="flex items-center gap-1.5">
                                <div className="w-10 h-2.5 rounded-sm" style={{ background: "linear-gradient(to right, transparent, #00D1FF, #5842F4, white)" }} />
                                <span>Density</span>
                            </div>
                        )}
                        {layers.goldZones && (
                            <div className="flex items-center gap-1.5">
                                <div className="w-10 h-2.5 rounded-sm" style={{ background: "linear-gradient(to right, transparent, #FFD700, #FF8C00)" }} />
                                <span>Gold</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right: Champion Selector */}
                <div className="glass rounded-2xl p-4 border border-white/5 lg:w-[180px] space-y-3 h-fit">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Champions</div>

                    {/* All Players */}
                    <button
                        onClick={() => setSelectedParticipant(null)}
                        className={cn(
                            "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all",
                            selectedParticipant === null
                                ? "bg-[#5842F4] text-white shadow-lg shadow-[#5842F4]/20"
                                : "bg-white/5 text-zinc-500 hover:text-white"
                        )}
                    >
                        <Users className="w-3.5 h-3.5" />
                        All Players
                    </button>

                    {/* Blue Team */}
                    <div className="space-y-1">
                        <div className="text-[9px] font-bold uppercase tracking-widest text-blue-400/60 px-1">Blue Team</div>
                        {blueTeam.map(p => (
                            <button
                                key={p.participantId}
                                onClick={() => setSelectedParticipant(selectedParticipant === p.participantId ? null : p.participantId)}
                                className={cn(
                                    "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg transition-all",
                                    selectedParticipant === p.participantId
                                        ? "bg-[#00D1FF]/15 border border-[#00D1FF]/40 shadow-[0_0_10px_rgba(0,209,255,0.15)]"
                                        : "hover:bg-white/5 border border-transparent"
                                )}
                            >
                                <img
                                    src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/champion/${championAssetKey(p.championName)}.png`}
                                    alt={p.championName}
                                    className={cn("w-7 h-7 rounded-md border", selectedParticipant === p.participantId ? "border-[#00D1FF]" : "border-blue-500/20")}
                                    onError={(e) => { const img = e.currentTarget; if (!img.dataset.fallback) { img.dataset.fallback = "1"; img.src = "/logo.png"; } }}
                                />
                                <span className={cn("text-[11px] font-semibold truncate", selectedParticipant === p.participantId ? "text-white" : "text-zinc-400")}>
                                    {p.championName}
                                </span>
                            </button>
                        ))}
                    </div>

                    {/* Red Team */}
                    <div className="space-y-1">
                        <div className="text-[9px] font-bold uppercase tracking-widest text-red-400/60 px-1">Red Team</div>
                        {redTeam.map(p => (
                            <button
                                key={p.participantId}
                                onClick={() => setSelectedParticipant(selectedParticipant === p.participantId ? null : p.participantId)}
                                className={cn(
                                    "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg transition-all",
                                    selectedParticipant === p.participantId
                                        ? "bg-[#00D1FF]/15 border border-[#00D1FF]/40 shadow-[0_0_10px_rgba(0,209,255,0.15)]"
                                        : "hover:bg-white/5 border border-transparent"
                                )}
                            >
                                <img
                                    src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/champion/${championAssetKey(p.championName)}.png`}
                                    alt={p.championName}
                                    className={cn("w-7 h-7 rounded-md border", selectedParticipant === p.participantId ? "border-[#00D1FF]" : "border-red-500/20")}
                                    onError={(e) => { const img = e.currentTarget; if (!img.dataset.fallback) { img.dataset.fallback = "1"; img.src = "/logo.png"; } }}
                                />
                                <span className={cn("text-[11px] font-semibold truncate", selectedParticipant === p.participantId ? "text-white" : "text-zinc-400")}>
                                    {p.championName}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
