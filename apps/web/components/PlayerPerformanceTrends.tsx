"use client";

import { useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { TrendingUp, Eye, Target, Crosshair } from 'lucide-react';

interface PlayerPerformanceTrendsProps {
    data: any[]; // List of previous match stats
    loading?: boolean;
    winDrivers?: any[]; // Key win drivers from ML analysis
}

export function PlayerPerformanceTrends({ data, loading = false, winDrivers = [] }: PlayerPerformanceTrendsProps) {
    const [activeMetric, setActiveMetric] = useState<'kda' | 'aggression' | 'vision' | 'economy'>('kda');

    const safeAvg = (rows: any[], key: string) => {
        const vals = rows
            .map((r) => Number(r?.[key]))
            .filter((v) => Number.isFinite(v));
        if (!vals.length) return undefined;
        return vals.reduce((a, b) => a + b, 0) / vals.length;
    };

    const safeWinRate = (rows: any[]) => {
        const wins = rows.filter((r) => !!r?.win).length;
        return rows.length ? (wins / rows.length) * 100 : undefined;
    };

    const pctChange = (recentAvg: number | undefined, prevAvg: number | undefined) => {
        if (recentAvg === undefined || prevAvg === undefined) return undefined;
        if (!Number.isFinite(recentAvg) || !Number.isFinite(prevAvg) || prevAvg === 0) return undefined;
        return ((recentAvg - prevAvg) / prevAvg) * 100;
    };

    // Format data for the chart (reverse so timeline goes left to right)
    const chartData = useMemo(() => {
        if (!data || data.length === 0) return [];

        // Create a reversed copy for the chart (oldest -> newest)
        const reversed = [...data].reverse();

        return reversed.map((match, idx) => {
            // Calculate local consistency (rolling std dev of last 5 games including this one)
            const window = reversed.slice(Math.max(0, idx - 4), idx + 1);
            const windowGold = window.map(m => Number(m.goldPerMinute) || 0);
            const mean = windowGold.reduce((a, b) => a + b, 0) / windowGold.length;
            const variance = windowGold.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / windowGold.length;
            const stdDev = Math.sqrt(variance);
            // Consistency score: 100 - (CV * scaling), clamped
            const cv = mean > 0 ? stdDev / mean : 0;
            // Increased sensitivity: even small deviations should drop score from 100
            const consistency = Math.max(0, 100 - (cv * 1000));

            return {
                ...match,
                idx: idx + 1,
                kda: typeof match.kda === 'number' ? match.kda : 0,
                visionScore: typeof match.visionScore === 'number' ? match.visionScore : 0,
                // Use backend calculated composite scores if available, else fallback
                aggression: match.aggressionScore || ((match.damagePerMinute || 0) / 10),
                visionDom: match.visionDominance || (match.visionScore || 0),
                consistency,
                kp: typeof match.killParticipation === 'number' ? match.killParticipation * 100 : 0,
            };
        });
    }, [data]);

    const latest = data && data.length > 0 ? data[0] : null;
    const avgKda = data.length ? (data.reduce((acc, curr) => acc + (curr.kda || 0), 0) / data.length) : 0;
    const winRate = data.length ? (data.filter(g => g.win).length / data.length * 100) : 0;

    const recent10 = data?.slice(0, 10) || [];
    const prev10 = data?.slice(10, 20) || [];
    const recent5 = data?.slice(0, 5) || [];
    const prev5 = data?.slice(5, 10) || [];

    const visionKey = data?.some((d) => Number.isFinite(Number(d?.visionDominance))) ? 'visionDominance' : 'visionScore';
    const aggressionKey = data?.some((d) => Number.isFinite(Number(d?.aggressionScore))) ? 'aggressionScore' : 'damagePerMinute';

    const visionDeltaPct = pctChange(safeAvg(recent10, visionKey), safeAvg(prev10, visionKey));
    const aggressionDeltaPct = pctChange(safeAvg(recent10, aggressionKey), safeAvg(prev10, aggressionKey));
    const winTrendDelta = (() => {
        const r = safeWinRate(recent5);
        const p = safeWinRate(prev5);
        if (r === undefined || p === undefined) return undefined;
        return r - p;
    })();

    const trendState: 'improving' | 'declining' | 'stable' =
        winTrendDelta === undefined ? 'stable' :
            winTrendDelta > 4 ? 'improving' :
                winTrendDelta < -4 ? 'declining' :
                    'stable';

    const trendLabel = winTrendDelta === undefined
        ? 'N/A'
        : trendState === 'improving'
            ? 'Improving'
            : trendState === 'declining'
                ? 'Declining'
                : 'Stable';

    const trendDeltaText = winTrendDelta === undefined
        ? undefined
        : `${winTrendDelta >= 0 ? '+' : ''}${winTrendDelta.toFixed(0)}pp`;

    return (
        <div className="space-y-8">
            <header className="mb-6">
                <h2 className="text-2xl font-black uppercase italic tracking-tighter" style={{ color: "#FFD870" }}>Performance Trends</h2>
                <p className="text-sm mt-1" style={{ color: "rgba(200,168,75,0.45)" }}>Analysis of your win drivers over the last {data.length} matches.</p>
            </header>

            {/* Key Metrics Row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-5 rounded-2xl relative overflow-hidden group" style={{ background: "rgba(200,168,75,0.03)", border: "1px solid rgba(200,168,75,0.1)" }}>
                    <p className="text-[10px] font-bold uppercase tracking-[0.15em] mb-1" style={{ color: "rgba(200,168,75,0.5)" }}>Win Rate</p>
                    <p className={`text-2xl font-black ${winRate >= 50 ? 'text-green-500' : 'text-red-500'}`}>
                        {Math.round(winRate)}%
                    </p>
                </div>
                <div className="p-5 rounded-2xl relative overflow-hidden group" style={{ background: "rgba(200,168,75,0.03)", border: "1px solid rgba(200,168,75,0.1)" }}>
                    <p className="text-[10px] font-bold uppercase tracking-[0.15em] mb-1" style={{ color: "rgba(200,168,75,0.5)" }}>Avg KDA</p>
                    <p className="text-2xl font-black text-[#C8A84B]">{avgKda.toFixed(2)}</p>
                </div>
                <div className="p-5 rounded-2xl relative overflow-hidden group" style={{ background: "rgba(200,168,75,0.03)", border: "1px solid rgba(200,168,75,0.1)" }}>
                    <p className="text-[10px] font-bold uppercase tracking-[0.15em] mb-1" style={{ color: "rgba(200,168,75,0.5)" }}>Avg Aggression</p>
                    <p className="text-2xl font-black text-red-400">
                        {data.length ? (data.reduce((acc, curr) => acc + (curr.aggressionScore || 0), 0) / data.length).toFixed(0) : 0}
                    </p>
                </div>
                <div className="p-5 rounded-2xl relative overflow-hidden group" style={{ background: "rgba(200,168,75,0.03)", border: "1px solid rgba(200,168,75,0.1)" }}>
                    <p className="text-[10px] font-bold uppercase tracking-[0.15em] mb-1" style={{ color: "rgba(200,168,75,0.5)" }}>Trend</p>
                    <div className={`flex items-center gap-1 ${trendState === 'improving' ? 'text-green-500' : trendState === 'declining' ? 'text-red-500' : ''}`}
                        style={trendState === 'stable' ? { color: 'rgba(200,168,75,0.6)' } : {}}>
                        <TrendingUp className={`w-4 h-4 ${trendState === 'declining' ? 'rotate-180' : ''}`} />
                        <span className="font-bold">{trendLabel}</span>
                        {trendDeltaText ? (
                            <span className="text-[10px] font-mono font-bold opacity-80">{trendDeltaText}</span>
                        ) : null}
                    </div>
                </div>
            </div>

            {/* Main Chart Section */}
            <div className="space-y-4">
                <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                    <h3 className="text-xl font-black uppercase italic tracking-tighter" style={{ color: "#FFD870" }}>Win Driver Evolution</h3>

                    {/* Metric Toggles */}
                    <div className="flex gap-2 text-[10px] font-bold p-1 rounded-lg" style={{ background: "rgba(200,168,75,0.05)", border: "1px solid rgba(200,168,75,0.1)" }}>
                        <button
                            onClick={() => setActiveMetric('kda')}
                            className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-2 ${activeMetric === 'kda' ? 'bg-[#5842F4] text-white shadow-lg' : 'hover:text-white'}`}
                            style={activeMetric !== 'kda' ? { color: "rgba(200,168,75,0.4)" } : {}}
                        >
                            <div className={`w-1.5 h-1.5 rounded-full ${activeMetric === 'kda' ? 'bg-white' : 'bg-[#5842F4]'}`}></div>
                            KDA
                        </button>
                        <button
                            onClick={() => setActiveMetric('aggression')}
                            className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-2 ${activeMetric === 'aggression' ? 'bg-red-500 text-white shadow-lg' : 'hover:text-white'}`}
                            style={activeMetric !== 'aggression' ? { color: "rgba(200,168,75,0.4)" } : {}}
                        >
                            <div className={`w-1.5 h-1.5 rounded-full ${activeMetric === 'aggression' ? 'bg-white' : 'bg-red-500'}`}></div>
                            AGGRESSION
                        </button>
                        <button
                            onClick={() => setActiveMetric('vision')}
                            className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-2 ${activeMetric === 'vision' ? 'bg-green-500 text-white shadow-lg' : 'hover:text-white'}`}
                            style={activeMetric !== 'vision' ? { color: "rgba(200,168,75,0.4)" } : {}}
                        >
                            <div className={`w-1.5 h-1.5 rounded-full ${activeMetric === 'vision' ? 'bg-white' : 'bg-green-500'}`}></div>
                            VISION
                        </button>
                        <button
                            onClick={() => setActiveMetric('economy')}
                            className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-2 ${activeMetric === 'economy' ? 'bg-amber-500 text-white shadow-lg' : 'hover:text-white'}`}
                            style={activeMetric !== 'economy' ? { color: "rgba(200,168,75,0.4)" } : {}}
                        >
                            <div className={`w-1.5 h-1.5 rounded-full ${activeMetric === 'economy' ? 'bg-white' : 'bg-amber-500'}`}></div>
                            ECONOMY
                        </button>
                    </div>
                </div>

                <div className="p-6 rounded-2xl h-[350px] min-h-[350px] relative" style={{ background: "rgba(200,168,75,0.025)", border: "1px solid rgba(200,168,75,0.1)" }}>
                    {chartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%" minHeight={300}>
                            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorKda" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#5842F4" stopOpacity={0.1} />
                                        <stop offset="95%" stopColor="#5842F4" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorAggression" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.1} />
                                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorVision" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#22c55e" stopOpacity={0.1} />
                                        <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorEconomy" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.1} />
                                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(200,168,75,0.12)" vertical={false} opacity={0.6} />
                                <XAxis dataKey="idx" stroke="rgba(200,168,75,0.3)" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis stroke="rgba(200,168,75,0.3)" fontSize={12} tickLine={false} axisLine={false} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#080810', border: '1px solid rgba(200,168,75,0.2)', borderRadius: '8px' }}
                                    itemStyle={{ fontSize: '12px', color: '#FFD870' }}
                                    labelFormatter={(idx) => `Match ${idx}`}
                                />

                                {activeMetric === 'kda' && (
                                    <Area type="monotone" dataKey="kda" stroke="#5842F4" strokeWidth={3} fill="url(#colorKda)" name="KDA" animationDuration={500} />
                                )}
                                {activeMetric === 'aggression' && (
                                    <Area type="monotone" dataKey="aggression" stroke="#ef4444" strokeWidth={3} fill="url(#colorAggression)" name="Aggression" animationDuration={500} />
                                )}
                                {activeMetric === 'vision' && (
                                    <Area type="monotone" dataKey="visionScore" stroke="#22c55e" strokeWidth={3} fill="url(#colorVision)" name="Vision" animationDuration={500} />
                                )}
                                {activeMetric === 'economy' && (
                                    <Area type="monotone" dataKey="goldPerMinute" stroke="#f59e0b" strokeWidth={3} fill="url(#colorEconomy)" name="Economy" animationDuration={500} />
                                )}

                            </AreaChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="flex items-center justify-center h-full" style={{ color: "rgba(200,168,75,0.4)" }}>
                            No match history to analyze
                        </div>
                    )}
                </div>

                {/* Milestones / Insights */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="p-6 rounded-2xl transition-all group relative overflow-hidden" style={{ background: "rgba(200,168,75,0.025)", border: "1px solid rgba(200,168,75,0.1)" }} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(200,168,75,0.05)"; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(200,168,75,0.025)"; }}>
                        <div className="w-10 h-10 rounded-lg bg-[#5842F4]/20 flex items-center justify-center mb-4 text-[#5842F4] group-hover:scale-110 transition-transform">
                            <Eye className="w-5 h-5" />
                        </div>
                        <h4 className="font-bold text-[#FFD870] mb-1">Vision Dominance</h4>
                        {visionDeltaPct === undefined ? (
                            <p className="text-sm" style={{ color: "rgba(200,168,75,0.45)" }}>Not enough match history yet to calculate a trend.</p>
                        ) : (
                            <p className="text-sm" style={{ color: "rgba(200,168,75,0.45)" }}>
                                Your {visionKey === 'visionDominance' ? 'vision dominance' : 'vision score'} is trending{' '}
                                <span className={`${visionDeltaPct >= 0 ? 'text-green-500' : 'text-red-500'} font-bold`}>{visionDeltaPct >= 0 ? '+' : ''}{visionDeltaPct.toFixed(0)}%</span>
                                {' '}over the last 10 games.
                            </p>
                        )}
                    </div>

                    <div className="p-6 rounded-2xl transition-all group relative overflow-hidden" style={{ background: "rgba(200,168,75,0.025)", border: "1px solid rgba(200,168,75,0.1)" }} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(200,168,75,0.05)"; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(200,168,75,0.025)"; }}>
                        <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center mb-4 text-red-500 group-hover:scale-110 transition-transform">
                            <Crosshair className="w-5 h-5" />
                        </div>
                        <h4 className="font-bold text-[#FFD870] mb-1">Aggression</h4>
                        {aggressionDeltaPct === undefined ? (
                            <p className="text-sm" style={{ color: "rgba(200,168,75,0.45)" }}>Not enough match history yet to calculate a trend.</p>
                        ) : aggressionDeltaPct < -5 ? (
                            <p className="text-sm" style={{ color: "rgba(200,168,75,0.45)" }}>Your aggression is down recently. Consider taking more calculated risks when you have tempo.</p>
                        ) : aggressionDeltaPct > 5 ? (
                            <p className="text-sm" style={{ color: "rgba(200,168,75,0.45)" }}>Your aggression is up recently. Keep it disciplined so you don’t give back shutdown gold.</p>
                        ) : (
                            <p className="text-sm" style={{ color: "rgba(200,168,75,0.45)" }}>Your aggression is stable. Look for small, repeatable advantages instead of forced fights.</p>
                        )}
                    </div>

                    <div className="p-6 rounded-2xl transition-all group relative overflow-hidden" style={{ background: "rgba(200,168,75,0.025)", border: "1px solid rgba(200,168,75,0.1)" }} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(200,168,75,0.05)"; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(200,168,75,0.025)"; }}>
                        <div className="w-10 h-10 rounded-lg bg-[#00D1FF]/20 flex items-center justify-center mb-4 text-[#00D1FF] group-hover:scale-110 transition-transform">
                            <Target className="w-5 h-5" />
                        </div>
                        <h4 className="font-bold text-[#FFD870] mb-1">Consistency</h4>
                        {chartData.length ? (
                            <p className="text-sm" style={{ color: "rgba(200,168,75,0.45)" }}>
                                {(() => {
                                    const recentConsistency = safeAvg(chartData.slice(-10), 'consistency');
                                    if (recentConsistency === undefined || !Number.isFinite(recentConsistency)) {
                                        return 'Not enough match history yet to calculate consistency.';
                                    }
                                    const score = Math.round(recentConsistency);
                                    if (recentConsistency >= 80) return <span>Your consistency score is{' '}<span className="text-green-500 font-bold">{score}</span>. You are playing a consistent tempo game.</span>;
                                    if (recentConsistency >= 60) return <span>Your consistency score is{' '}<span className="font-bold" style={{ color: 'rgba(200,168,75,0.8)' }}>{score}</span>. Tempo is somewhat swingy — stabilize your first two resets.</span>;
                                    return <span>Your consistency score is{' '}<span className="text-red-500 font-bold">{score}</span>. Focus on repeatable early-game fundamentals.</span>;
                                })()}
                            </p>
                        ) : (
                            <p className="text-sm" style={{ color: "rgba(200,168,75,0.45)" }}>Not enough match history yet to calculate consistency.</p>
                        )}
                    </div>
                </div>
            </div>

            {/* Key Win Drivers */}
            {winDrivers && winDrivers.length > 0 && (() => {
                const sorted = [...winDrivers].sort((a, b) => Math.abs(b.diff_pct ?? 0) - Math.abs(a.diff_pct ?? 0));
                const maxAbsDiff = Math.max(...sorted.map(d => Math.abs(d.diff_pct ?? 0)), 1);

                const impactColor = (impact: string) => {
                    switch ((impact ?? '').toLowerCase()) {
                        case 'critical': return { bar: '#ef4444', badge: 'text-red-400 bg-red-400/10 border-red-400/20' };
                        case 'high':     return { bar: '#f97316', badge: 'text-orange-400 bg-orange-400/10 border-orange-400/20' };
                        case 'medium':   return { bar: '#C8A84B', badge: 'text-[#FFD870] bg-[#FFD870]/10 border-[#FFD870]/20' };
                        default:         return { bar: 'rgba(200,168,75,0.4)', badge: 'text-zinc-400 bg-zinc-400/10 border-zinc-400/20' };
                    }
                };

                const fmtVal = (v: any) => {
                    if (v === undefined || v === null) return '—';
                    const n = Number(v);
                    if (!Number.isFinite(n)) return String(v);
                    return n % 1 === 0 ? n.toFixed(0) : n.toFixed(2);
                };

                return (
                    <div className="rounded-2xl p-8" style={{ background: "rgba(200,168,75,0.02)", border: "1px solid rgba(200,168,75,0.1)" }}>
                        <div className="flex items-center gap-3 mb-2">
                            <Crosshair className="w-6 h-6" style={{ color: "#C8A84B" }} />
                            <h3 className="text-xl font-black uppercase italic tracking-tighter" style={{ color: "#FFD870" }}>Key Win Drivers</h3>
                            <span className="px-3 py-1 rounded text-[10px] font-bold uppercase tracking-widest" style={{ background: "rgba(200,168,75,0.06)", color: "rgba(200,168,75,0.5)", border: "1px solid rgba(200,168,75,0.12)" }}>
                                Based on {data.length} matches
                            </span>
                        </div>
                        <p className="text-xs mb-6" style={{ color: "rgba(200,168,75,0.4)" }}>
                            Metrics that most differentiate your wins — bar width shows relative importance across all drivers.
                        </p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {sorted.map((driver: any, idx: number) => {
                                const colors = impactColor(driver.impact);
                                const barWidth = Math.round((Math.abs(driver.diff_pct ?? 0) / maxAbsDiff) * 100);
                                const positive = (driver.diff_pct ?? 0) >= 0;

                                return (
                                    <div
                                        key={idx}
                                        className="p-5 rounded-xl group transition-all relative overflow-hidden"
                                        style={{ background: "rgba(200,168,75,0.025)", border: "1px solid rgba(200,168,75,0.1)" }}
                                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(200,168,75,0.05)"; }}
                                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(200,168,75,0.025)"; }}
                                    >
                                        {/* Rank badge */}
                                        <div className="absolute top-4 right-4 text-[10px] font-black uppercase tracking-widest opacity-20 text-2xl leading-none">
                                            #{idx + 1}
                                        </div>

                                        {/* Header */}
                                        <div className="flex items-start gap-3 mb-3">
                                            <div className="flex-1">
                                                <div className="font-bold text-white text-sm leading-tight mb-1">{driver.name}</div>
                                                <span className={`inline-block px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest border ${colors.badge}`}>
                                                    {driver.impact ?? 'Low'} Impact
                                                </span>
                                            </div>
                                        </div>

                                        {/* Impact bar */}
                                        <div className="mb-3">
                                            <div className="h-[4px] w-full rounded-full overflow-hidden" style={{ background: "rgba(200,168,75,0.08)" }}>
                                                <div
                                                    className="h-full rounded-full transition-all duration-700"
                                                    style={{ width: `${barWidth}%`, background: colors.bar, boxShadow: `0 0 6px ${colors.bar}40` }}
                                                />
                                            </div>
                                        </div>

                                        {/* Value comparison */}
                                        {(driver.value !== undefined || driver.baseline !== undefined) && (
                                            <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.1em]">
                                                {driver.value !== undefined && (
                                                    <div className="flex flex-col">
                                                        <span style={{ color: "rgba(200,168,75,0.4)" }}>Your Wins</span>
                                                        <span className={positive ? 'text-green-400' : 'text-red-400'}>{fmtVal(driver.value)}</span>
                                                    </div>
                                                )}
                                                {driver.value !== undefined && driver.baseline !== undefined && (
                                                    <div className="h-8 w-px" style={{ background: "rgba(200,168,75,0.15)" }} />
                                                )}
                                                {driver.baseline !== undefined && (
                                                    <div className="flex flex-col">
                                                        <span style={{ color: "rgba(200,168,75,0.4)" }}>Avg</span>
                                                        <span style={{ color: "rgba(255,255,255,0.5)" }}>{fmtVal(driver.baseline)}</span>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
