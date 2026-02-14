"use client";

import { useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Zap, Target, Eye, Activity, TrendingUp, AlertTriangle, CheckCircle, Swords, Coins, Shield, Crown, Skull } from 'lucide-react';

interface StatComparisonRowProps {
    label: string;
    userValue: number;
    enemyValue: number;
    unit?: string;
    decimal?: number;
    inverse?: boolean; // If true, lower is better (e.g. deaths)
}

const StatComparisonRow = ({ label, userValue, enemyValue, unit = '', decimal = 1, inverse = false }: StatComparisonRowProps) => {
    let diff = userValue - enemyValue;
    if (inverse) diff = -diff; // Invert logic for negative stats

    // Threshold for equality
    const isEven = Math.abs(diff) < 0.05;
    const isWinning = diff > 0;

    const format = (val: number) => {
        if (typeof val !== 'number') return val;
        return val % 1 === 0 ? val.toFixed(0) : val.toFixed(decimal);
    }

    return (
        <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0 hover:bg-white/5 px-2 -mx-2 rounded transition-colors">
            <span className="text-xs font-bold text-slate-400">{label}</span>
            <div className="flex items-center gap-3">
                <div className={`text-xs font-mono font-bold ${isWinning ? 'text-green-400' : isEven ? 'text-slate-400' : 'text-slate-500'}`}>
                    {format(userValue)}{unit}
                </div>
                <div className="text-[10px] text-slate-600 font-mono">vs</div>
                <div className={`text-xs font-mono font-bold ${!isWinning && !isEven ? 'text-red-400' : 'text-[#5842F4]/70'}`}>
                    {format(enemyValue)}{unit}
                </div>
            </div>
        </div>
    );
}

export function DetailedMatchAnalysis({
    lastMatchStats,
    winDrivers,
    skillFocus,
    timelineSeries,
    winProbability,
    enemyStats
}: {
    lastMatchStats: any,
    winDrivers: any[],
    skillFocus: any[],
    timelineSeries: any,
    winProbability: number,
    enemyStats: any
}) {
    const [activeMetric, setActiveMetric] = useState<'gold' | 'vision' | 'aggression'>('gold');

    // Destructure not needed anymore since they are passed as props
    // const { win_drivers: winDrivers, skill_focus: skillFocus, match_timeline_series: timelineSeries, last_match_stats: lastMatchStats, enemy_stats: enemyStats } = analysis;


    const timelineData = useMemo(() => {
        if (!timelineSeries?.timeline) return [];

        const maxTime = timelineSeries.timeline.length;
        const finalVision = typeof lastMatchStats?.visionScore === 'number' ? lastMatchStats.visionScore : 0;
        const finalEnemyVision = typeof enemyStats?.visionScore === 'number' ? enemyStats.visionScore : 0;

        return timelineSeries.timeline.map((point: any, i: number) => {
            const progress = i / maxTime;

            // Vision
            const userVision = (finalVision * progress);
            const enemyVision = (finalEnemyVision * progress);

            // Aggression (User)
            const prevGold = i > 0 ? timelineSeries.timeline[i - 1].myGold : 0;
            const income = i === 0 ? 500 : (point.myGold - prevGold);
            let userAggression = Math.max(0, (income - 300) / 7);
            userAggression = Math.min(100, userAggression);

            // Aggression (Enemy)
            const prevEnemyGold = i > 0 ? timelineSeries.timeline[i - 1].enemyGold || 0 : 0;
            const enemyGold = point.enemyGold || 0;
            const enemyIncome = i === 0 ? 500 : (enemyGold - prevEnemyGold);
            let enemyAggression = Math.max(0, (enemyIncome - 300) / 7);
            enemyAggression = Math.min(100, enemyAggression);

            // Gold
            const userGold = point.myGold || 0;
            const enemyGoldVal = point.enemyGold || 0;

            return {
                ...point,
                userVision,
                enemyVision,
                userAggression,
                enemyAggression,
                userGold,
                enemyGold: enemyGoldVal
            };
        });
    }, [timelineSeries, lastMatchStats, enemyStats]);

    const toBarPct = (value: unknown, maxValue: number) => {
        const n = Number(value);
        if (!Number.isFinite(n) || !Number.isFinite(maxValue) || maxValue <= 0) return 0;
        return Math.min(100, Math.max(0, (n / maxValue) * 100));
    };

    const drivers = winDrivers || [];
    const focusAreas = skillFocus || [];
    const enemy = enemyStats || {};

    if (!lastMatchStats) return null;

    // Helper: Map features to icons
    const getIconForFeature = (feature: string) => {
        const lower = feature.toLowerCase();
        if (lower.includes('gold') || lower.includes('cs') || lower.includes('minion')) return Coins;
        if (lower.includes('damage') || lower.includes('kill')) return Swords;
        if (lower.includes('vision') || lower.includes('ward')) return Eye;
        if (lower.includes('plate') || lower.includes('turret')) return Shield;
        return Activity;
    }

    return (
        <div className="space-y-8">
            {/* Lane Matchup Section */}
            <section className="bg-gradient-to-br from-[#5842F4]/5 to-transparent border border-white/5 p-8 rounded-3xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-32 bg-[#5842F4]/10 blur-3xl rounded-full pointer-events-none -translate-y-1/2 translate-x-1/2"></div>

                <div className="flex flex-col md:flex-row items-center justify-between mb-8 relative z-10 gap-6">
                    <div className="flex items-center gap-4">
                        <div className="bg-[#0a0a0f] p-3 rounded-xl border border-white/10 shadow-xl">
                            <Swords className="w-8 h-8 text-[#00D1FF]" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black uppercase text-white italic tracking-tighter">Lane Matchup</h2>
                            <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest">Head-to-Head Comparison</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-8 bg-black/20 p-4 rounded-2xl border border-white/5">
                        <div className="text-right">
                            <div className="text-green-400 font-black text-xl tracking-tighter">YOU</div>
                            <div className="text-white/50 text-[10px] font-bold uppercase tracking-widest truncate max-w-[100px]">{lastMatchStats.championName || "Hero"}</div>
                        </div>
                        <div className="h-8 w-px bg-white/10"></div>
                        <div className="text-left">
                            <div className="text-[#5842F4] font-black text-xl tracking-tighter">ENEMY</div>
                            <div className="text-white/50 text-[10px] font-bold uppercase tracking-widest truncate max-w-[100px]">{enemy.championName || "Opponent"}</div>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative z-10">
                    {/* Combat Stats */}
                    <div className="bg-[#0a0a0f]/60 backdrop-blur-sm p-5 rounded-2xl border border-white/5 hover:border-[#F44336]/30 transition-colors group">
                        <div className="flex items-center gap-2 mb-4 pb-4 border-b border-white/5">
                            <div className="p-1.5 rounded-lg bg-[#F44336]/10 text-[#F44336] group-hover:bg-[#F44336]/20 transition-colors">
                                <Swords className="w-4 h-4" />
                            </div>
                            <h3 className="font-bold text-white text-sm uppercase tracking-wider">Combat</h3>
                        </div>
                        <div className="space-y-1">
                            <StatComparisonRow label="KDA" userValue={lastMatchStats.kda || 0} enemyValue={enemy.kda || 0} decimal={2} />
                            <StatComparisonRow label="Damage/Min" userValue={lastMatchStats.damagePerMinute || 0} enemyValue={enemy.damagePerMinute || 0} decimal={0} />
                            <StatComparisonRow label="Solo Kills" userValue={lastMatchStats.soloKills || 0} enemyValue={enemy.soloKills || 0} />
                            <StatComparisonRow label="Participation" userValue={(lastMatchStats.killParticipation || 0) * 100} enemyValue={(enemy.killParticipation || 0) * 100} unit="%" decimal={0} />
                            <StatComparisonRow label="Skillshot Hit" userValue={lastMatchStats.skillshotHitRate || 0} enemyValue={enemy.skillshotHitRate || 0} unit="%" decimal={1} />
                        </div>
                    </div>

                    {/* Economy Stats */}
                    <div className="bg-[#0a0a0f]/60 backdrop-blur-sm p-5 rounded-2xl border border-white/5 hover:border-[#FFD700]/30 transition-colors group">
                        <div className="flex items-center gap-2 mb-4 pb-4 border-b border-white/5">
                            <div className="p-1.5 rounded-lg bg-[#FFD700]/10 text-[#FFD700] group-hover:bg-[#FFD700]/20 transition-colors">
                                <Coins className="w-4 h-4" />
                            </div>
                            <h3 className="font-bold text-white text-sm uppercase tracking-wider">Economy</h3>
                        </div>
                        <div className="space-y-1">
                            <StatComparisonRow label="Gold/Min" userValue={lastMatchStats.goldPerMinute || 0} enemyValue={enemy.goldPerMinute || 0} decimal={0} />
                            <StatComparisonRow label="CS/Min" userValue={(lastMatchStats.totalMinionsKilled || 0) / (lastMatchStats.gameDuration / 60 || 1)} enemyValue={(enemy.totalMinionsKilled || 0) / (lastMatchStats.gameDuration / 60 || 1)} decimal={1} />
                            <StatComparisonRow label="Total CS" userValue={lastMatchStats.totalMinionsKilled || 0} enemyValue={enemy.totalMinionsKilled || 0} />
                            <StatComparisonRow label="XP/Min" userValue={(lastMatchStats.champExperience || 0) / (lastMatchStats.gameDuration / 60 || 1)} enemyValue={enemy.xpPerMinute || 0} decimal={0} />
                            <StatComparisonRow label="Turret Plates" userValue={lastMatchStats.turretPlatesTaken || 0} enemyValue={enemy.turretPlatesTaken || 0} />
                        </div>
                    </div>

                    {/* Vision & Macro */}
                    <div className="bg-[#0a0a0f]/60 backdrop-blur-sm p-5 rounded-2xl border border-white/5 hover:border-[#22c55e]/30 transition-colors group">
                        <div className="flex items-center gap-2 mb-4 pb-4 border-b border-white/5">
                            <div className="p-1.5 rounded-lg bg-[#22c55e]/10 text-[#22c55e] group-hover:bg-[#22c55e]/20 transition-colors">
                                <Eye className="w-4 h-4" />
                            </div>
                            <h3 className="font-bold text-white text-sm uppercase tracking-wider">Vision</h3>
                        </div>
                        <div className="space-y-1">
                            <StatComparisonRow label="Vision Score" userValue={lastMatchStats.visionScore || 0} enemyValue={enemy.visionScore || 0} decimal={0} />
                            <StatComparisonRow label="Wards Placed" userValue={lastMatchStats.wardsPlaced || 0} enemyValue={enemy.wardsPlaced || 0} />
                            <StatComparisonRow label="Control Wards" userValue={lastMatchStats.controlWardsPlaced || 0} enemyValue={enemy.controlWardsPlaced || 0} />
                            <StatComparisonRow label="Obj Damage" userValue={lastMatchStats.damageDealtToObjectives || 0} enemyValue={enemy.towerDamageDealt || 0} decimal={0} />
                            <StatComparisonRow label="Lane CS@10" userValue={lastMatchStats.laneMinionsFirst10Minutes || 0} enemyValue={enemy.laneMinionsFirst10Minutes || 0} />
                        </div>
                    </div>
                </div>
            </section>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                {/* Main Logic Section (Drivers + Momentum) */}
                <div className="lg:col-span-2 space-y-8">

                    {/* Top Drivers Redesigned */}
                    <section>
                        <div className="flex items-center gap-3 mb-6">
                            <Crown className="w-6 h-6 text-yellow-400" />
                            <h2 className="text-xl font-bold text-white">Winning Factors</h2>
                        </div>
                        <div className="bg-[#0a0a0f] border border-white/10 rounded-2xl overflow-hidden divide-y divide-white/5">
                            <div className="grid grid-cols-12 bg-white/5 p-4 text-xs font-bold text-slate-400 uppercase tracking-widest text-center">
                                <div className="col-span-5 text-left">Factor</div>
                                <div className="col-span-3">You</div>
                                <div className="col-span-3">Enemy</div>
                                <div className="col-span-1">Diff</div>
                            </div>
                            {drivers.length > 0 ? drivers.map((driver: any, idx) => {
                                const Icon = getIconForFeature(driver.feature);
                                return (
                                    <div key={idx} className="grid grid-cols-12 p-4 items-center gap-2 hover:bg-white/5 transition-colors group">
                                        <div className="col-span-5 text-left flex items-center gap-3">
                                            <div className="p-2 rounded-lg bg-[#5842F4]/10 text-[#5842F4] group-hover:scale-110 transition-transform">
                                                <Icon className="w-4 h-4" />
                                            </div>
                                            <div>
                                                <div className="font-bold text-white text-sm">{driver.name}</div>
                                                <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{driver.impact} Impact</div>
                                            </div>
                                        </div>

                                        <div className="col-span-3 text-center">
                                            <span className="text-green-400 font-bold font-mono text-lg">
                                                {typeof driver.value === 'number' && driver.value % 1 !== 0 ? driver.value.toFixed(1) : driver.value}
                                            </span>
                                        </div>

                                        <div className="col-span-3 text-center flex items-center justify-center gap-2">
                                            <span className="text-red-400/80 font-bold font-mono text-sm opacity-50 group-hover:opacity-100 transition-opacity">
                                                {typeof driver.baseline === 'number' && driver.baseline % 1 !== 0 ? driver.baseline.toFixed(1) : driver.baseline}
                                            </span>
                                        </div>

                                        <div className="col-span-1 text-center">
                                            <span className="bg-green-500/20 text-green-400 text-xs font-bold px-2 py-1 rounded-full">
                                                +{Math.round(Math.abs(driver.diff_pct) * 100)}%
                                            </span>
                                        </div>
                                    </div>
                                )
                            }) : (
                                <div className="p-8 text-center text-slate-500 italic">No clear winning factors found.</div>
                            )}
                        </div>
                    </section>

                    {/* Momentum Chart */}
                    <section>
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <TrendingUp className="text-[#5842F4] w-5 h-5" />
                                <h2 className="text-xl font-bold text-white">Match Momentum</h2>
                            </div>
                            <div className="flex gap-2 text-xs font-bold bg-white/5 p-1 rounded-lg">
                                <button
                                    onClick={() => setActiveMetric('gold')}
                                    className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-2 ${activeMetric === 'gold' ? 'bg-[#5842F4] text-white shadow-lg' : 'text-zinc-500 hover:text-white'}`}
                                >
                                    <div className={`w-2 h-2 rounded-full ${activeMetric === 'gold' ? 'bg-white' : 'bg-[#5842F4]'}`}></div>
                                    Gold
                                </button>
                                <button
                                    onClick={() => setActiveMetric('vision')}
                                    className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-2 ${activeMetric === 'vision' ? 'bg-green-500 text-white shadow-lg' : 'text-zinc-500 hover:text-white'}`}
                                >
                                    <div className={`w-2 h-2 rounded-full ${activeMetric === 'vision' ? 'bg-white' : 'bg-green-500'}`}></div>
                                    Vision
                                </button>
                                <button
                                    onClick={() => setActiveMetric('aggression')}
                                    className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-2 ${activeMetric === 'aggression' ? 'bg-red-500 text-white shadow-lg' : 'text-zinc-500 hover:text-white'}`}
                                >
                                    <div className={`w-2 h-2 rounded-full ${activeMetric === 'aggression' ? 'bg-white' : 'bg-red-500'}`}></div>
                                    Aggression
                                </button>
                            </div>
                        </div>

                        <div className="bg-[#0a0a0f] border border-white/10 p-6 rounded-2xl h-[350px] min-h-[350px] relative">
                            {timelineData.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%" minHeight={300}>
                                    <AreaChart data={timelineData}>
                                        <XAxis dataKey="minute" stroke="#475569" fontSize={12} tickLine={false} axisLine={false} />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#161618', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                                            itemStyle={{ color: '#fff' }}
                                            labelFormatter={(label) => `${label} min`}
                                        />
                                        <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" />

                                        {/* Vision */}
                                        {activeMetric === 'vision' && (
                                            <>
                                                <Area type="monotone" dataKey="userVision" stroke="#22c55e" fill="#22c55e" fillOpacity={0.1} strokeWidth={3} name="You" animationDuration={500} />
                                                <Area type="monotone" dataKey="enemyVision" stroke="#ef4444" fill="#ef4444" fillOpacity={0.1} strokeWidth={3} name="Enemy" animationDuration={500} />
                                            </>
                                        )}

                                        {/* Aggression */}
                                        {activeMetric === 'aggression' && (
                                            <>
                                                <Area type="monotone" dataKey="userAggression" stroke="#22c55e" fill="#22c55e" fillOpacity={0.1} strokeWidth={3} name="You" animationDuration={500} />
                                                <Area type="monotone" dataKey="enemyAggression" stroke="#ef4444" fill="#ef4444" fillOpacity={0.1} strokeWidth={3} name="Enemy" animationDuration={500} />
                                            </>
                                        )}

                                        {/* Gold */}
                                        {activeMetric === 'gold' && (
                                            <>
                                                <Area type="monotone" dataKey="userGold" stroke="#5842F4" fill="#5842F4" fillOpacity={0.1} strokeWidth={3} name="You" animationDuration={500} />
                                                <Area type="monotone" dataKey="enemyGold" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.1} strokeWidth={3} name="Enemy" animationDuration={500} />
                                            </>
                                        )}
                                    </AreaChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="flex items-center justify-center h-full text-slate-500">
                                    No timeline data available
                                </div>
                            )}
                        </div>
                    </section>
                </div>

                {/* Sidebar - Skill Focus (Redesigned) */}
                <div className="space-y-6">
                    <section className="bg-[#0a0a0f] border border-white/10 rounded-2xl overflow-hidden p-6 relative">
                        <div className="absolute top-0 right-0 p-32 bg-red-500/5 blur-3xl rounded-full pointer-events-none -translate-y-1/2 translate-x-1/2"></div>

                        <div className="flex items-center gap-2 mb-6 relative z-10">
                            <Target className="text-red-500 w-5 h-5" />
                            <h2 className="text-xl font-bold text-white">Skill Focus</h2>
                        </div>

                        <div className="space-y-4 relative z-10">
                            {focusAreas.length > 0 ? focusAreas.map((area: any, idx: number) => {
                                const Icon = getIconForFeature(area.feature);
                                return (
                                    <div key={idx} className="bg-white/5 p-4 rounded-xl border border-white/5 hover:border-red-500/30 transition-colors">
                                        <div className="flex items-start justify-between mb-3">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 rounded-lg bg-red-500/10 text-red-500">
                                                    <Icon className="w-4 h-4" />
                                                </div>
                                                <div>
                                                    <h4 className="font-bold text-white text-sm">{area.title}</h4>
                                                    <div className="text-[10px] text-slate-500 uppercase tracking-wider">Gap Found</div>
                                                </div>
                                            </div>
                                            <span className="text-xs font-bold text-red-400 bg-red-500/10 px-2 py-1 rounded flex items-center gap-1">
                                                <AlertTriangle className="w-3 h-3" />
                                                {Math.round(Math.abs(area.diff * 100))}% Gap
                                            </span>
                                        </div>

                                        {/* Comparison Bar */}
                                        <div className="space-y-2 mt-4">
                                            {/* You */}
                                            <div>
                                                <div className="flex justify-between text-xs mb-1">
                                                    <span className="text-slate-400 font-bold">You</span>
                                                    <span className="text-white font-mono">{typeof area.current === 'number' ? area.current.toFixed(1) : area.current}</span>
                                                </div>
                                                <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                                                    {(() => {
                                                        const maxVal = Math.max(Number(area.current) || 0, Number(area.target) || 0, 1);
                                                        const pct = toBarPct(area.current, maxVal);
                                                        return <div className="h-full bg-slate-500" style={{ width: `${pct}%` }}></div>;
                                                    })()}
                                                </div>
                                            </div>

                                            {/* Enemy */}
                                            <div>
                                                <div className="flex justify-between text-xs mb-1">
                                                    <span className="text-red-400 font-bold">Enemy Laner</span>
                                                    <span className="text-red-400 font-mono font-bold">{typeof area.target === 'number' ? area.target.toFixed(1) : area.target}</span>
                                                </div>
                                                <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                                                    {(() => {
                                                        const maxVal = Math.max(Number(area.current) || 0, Number(area.target) || 0, 1);
                                                        const pct = toBarPct(area.target, maxVal);
                                                        return <div className="h-full bg-red-500" style={{ width: `${pct}%` }}></div>;
                                                    })()}
                                                </div>
                                            </div>
                                        </div>

                                        <p className="text-xs text-slate-400 mt-3 border-t border-white/5 pt-2 italic">
                                            "{area.description}"
                                        </p>
                                    </div>
                                )
                            }) : (
                                <div className="text-center py-6">
                                    <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3 opacity-50" />
                                    <p className="text-sm text-slate-400">No major weaknesses detected vs Enemy.</p>
                                </div>
                            )}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}
