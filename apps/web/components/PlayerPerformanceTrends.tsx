"use client";

import { useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Trophy, TrendingUp, Eye, Target, Crosshair } from 'lucide-react';

interface PlayerPerformanceTrendsProps {
    data: any[]; // List of previous match stats
    loading?: boolean;
}

export function PlayerPerformanceTrends({ data, loading = false }: PlayerPerformanceTrendsProps) {
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
                <h2 className="text-2xl font-bold text-white mb-2">Performance Trends</h2>
                <p className="text-slate-400">Analysis of your win drivers over the last {data.length} matches.</p>
            </header>

            {/* Key Metrics Row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-[#0a0a0f] border border-white/10 p-5 rounded-2xl relative overflow-hidden group">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Win Rate</p>
                    <p className={`text-2xl font-black ${winRate >= 50 ? 'text-green-500' : 'text-red-500'}`}>
                        {Math.round(winRate)}%
                    </p>
                </div>
                <div className="bg-[#0a0a0f] border border-white/10 p-5 rounded-2xl relative overflow-hidden group">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Avg KDA</p>
                    <p className="text-2xl font-black text-white">{avgKda.toFixed(2)}</p>
                </div>
                <div className="bg-[#0a0a0f] border border-white/10 p-5 rounded-2xl relative overflow-hidden group">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Avg Aggression</p>
                    <p className="text-2xl font-black text-red-400">
                        {data.length ? (data.reduce((acc, curr) => acc + (curr.aggressionScore || 0), 0) / data.length).toFixed(0) : 0}
                    </p>
                </div>
                <div className="bg-[#0a0a0f] border border-white/10 p-5 rounded-2xl relative overflow-hidden group">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Trend</p>
                    <div className={`flex items-center gap-1 ${trendState === 'improving' ? 'text-green-500' : trendState === 'declining' ? 'text-red-500' : 'text-slate-400'}`}>
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
                    <h3 className="font-bold text-lg text-white">Win Driver Evolution</h3>

                    {/* Metric Toggles - Matching Match Momentum Style */}
                    <div className="flex gap-2 text-[10px] font-bold bg-white/5 p-1 rounded-lg">
                        <button
                            onClick={() => setActiveMetric('kda')}
                            className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-2 ${activeMetric === 'kda' ? 'bg-[#5842F4] text-white shadow-lg' : 'text-zinc-500 hover:text-white'}`}
                        >
                            <div className={`w-1.5 h-1.5 rounded-full ${activeMetric === 'kda' ? 'bg-white' : 'bg-[#5842F4]'}`}></div>
                            KDA
                        </button>
                        <button
                            onClick={() => setActiveMetric('aggression')}
                            className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-2 ${activeMetric === 'aggression' ? 'bg-red-500 text-white shadow-lg' : 'text-zinc-500 hover:text-white'}`}
                        >
                            <div className={`w-1.5 h-1.5 rounded-full ${activeMetric === 'aggression' ? 'bg-white' : 'bg-red-500'}`}></div>
                            AGGRESSION
                        </button>
                        <button
                            onClick={() => setActiveMetric('vision')}
                            className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-2 ${activeMetric === 'vision' ? 'bg-green-500 text-white shadow-lg' : 'text-zinc-500 hover:text-white'}`}
                        >
                            <div className={`w-1.5 h-1.5 rounded-full ${activeMetric === 'vision' ? 'bg-white' : 'bg-green-500'}`}></div>
                            VISION
                        </button>
                        <button
                            onClick={() => setActiveMetric('economy')}
                            className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-2 ${activeMetric === 'economy' ? 'bg-amber-500 text-white shadow-lg' : 'text-zinc-500 hover:text-white'}`}
                        >
                            <div className={`w-1.5 h-1.5 rounded-full ${activeMetric === 'economy' ? 'bg-white' : 'bg-amber-500'}`}></div>
                            ECONOMY
                        </button>
                    </div>
                </div>

                <div className="bg-[#0a0a0f] border border-white/10 p-6 rounded-2xl h-[350px] min-h-[350px] relative">
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
                                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} opacity={0.3} />
                                <XAxis dataKey="idx" stroke="#475569" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis stroke="#475569" fontSize={12} tickLine={false} axisLine={false} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#161618', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                                    itemStyle={{ fontSize: '12px', color: '#fff' }}
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
                        <div className="flex items-center justify-center h-full text-zinc-500">
                            No match history to analyze
                        </div>
                    )}
                </div>

                {/* Milestones / Insights */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-[#0a0a0f] border border-white/10 p-6 rounded-2xl hover:bg-white/[0.03] transition-all group relative overflow-hidden">
                        <div className="w-10 h-10 rounded-lg bg-[#5842F4]/20 flex items-center justify-center mb-4 text-[#5842F4] group-hover:scale-110 transition-transform">
                            <Eye className="w-5 h-5" />
                        </div>
                        <h4 className="font-bold text-white mb-1">Vision Dominance</h4>
                        {visionDeltaPct === undefined ? (
                            <p className="text-sm text-slate-400">Not enough match history yet to calculate a trend.</p>
                        ) : (
                            <p className="text-sm text-slate-400">
                                Your {visionKey === 'visionDominance' ? 'vision dominance' : 'vision score'} is trending{' '}
                                <span className={`${visionDeltaPct >= 0 ? 'text-green-500' : 'text-red-500'} font-bold`}>{visionDeltaPct >= 0 ? '+' : ''}{visionDeltaPct.toFixed(0)}%</span>
                                {' '}over the last 10 games.
                            </p>
                        )}
                    </div>

                    <div className="bg-[#0a0a0f] border border-white/10 p-6 rounded-2xl hover:bg-white/[0.03] transition-all group relative overflow-hidden">
                        <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center mb-4 text-red-500 group-hover:scale-110 transition-transform">
                            <Crosshair className="w-5 h-5" />
                        </div>
                        <h4 className="font-bold text-white mb-1">Aggression</h4>
                        {aggressionDeltaPct === undefined ? (
                            <p className="text-sm text-slate-400">Not enough match history yet to calculate a trend.</p>
                        ) : aggressionDeltaPct < -5 ? (
                            <p className="text-sm text-slate-400">Your aggression is down recently. Consider taking more calculated risks when you have tempo.</p>
                        ) : aggressionDeltaPct > 5 ? (
                            <p className="text-sm text-slate-400">Your aggression is up recently. Keep it disciplined so you don’t give back shutdown gold.</p>
                        ) : (
                            <p className="text-sm text-slate-400">Your aggression is stable. Look for small, repeatable advantages instead of forced fights.</p>
                        )}
                    </div>

                    <div className="bg-[#0a0a0f] border border-white/10 p-6 rounded-2xl hover:bg-white/[0.03] transition-all group relative overflow-hidden">
                        <div className="w-10 h-10 rounded-lg bg-[#00D1FF]/20 flex items-center justify-center mb-4 text-[#00D1FF] group-hover:scale-110 transition-transform">
                            <Target className="w-5 h-5" />
                        </div>
                        <h4 className="font-bold text-white mb-1">Consistency</h4>
                        {chartData.length ? (
                            <p className="text-sm text-slate-400">
                                {(() => {
                                    const recentConsistency = safeAvg(chartData.slice(-10), 'consistency');
                                    if (recentConsistency === undefined || !Number.isFinite(recentConsistency)) {
                                        return 'Not enough match history yet to calculate consistency.';
                                    }
                                    if (recentConsistency >= 80) return 'Your gold/min variance is low. You are playing a consistent tempo game.';
                                    if (recentConsistency >= 60) return 'Your tempo is somewhat swingy. Try to stabilize your first two resets.';
                                    return 'Your games are highly variable. Focus on repeatable early-game fundamentals.';
                                })()}
                            </p>
                        ) : (
                            <p className="text-sm text-slate-400">Not enough match history yet to calculate consistency.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
