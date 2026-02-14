export type AnalyzeProgressUpdate = { message: string; percent: number };

export type AnalysisUser = {
    game_name: string;
    tag_line: string;
    region: string;
    profile_icon_id: number;
    summoner_level: number;
    puuid: string;
};

export type HeatmapPosition = {
    x: number;
    y: number;
    timestamp: number;
    totalGold: number;
    goldDelta: number;
};

export type HeatmapParticipant = {
    participantId: number;
    championName: string;
    teamId: number;
    positions: HeatmapPosition[];
};

export type HeatmapKillEvent = {
    x: number;
    y: number;
    killerId: number;
    victimId: number;
    assistingParticipantIds: number[];
    timestamp: number;
};

export type HeatmapWardEvent = {
    x: number;
    y: number;
    wardType: string;
    creatorId: number;
    timestamp: number;
};

export type HeatmapData = {
    participants: HeatmapParticipant[];
    kill_events: HeatmapKillEvent[];
    ward_events: HeatmapWardEvent[];
};

export type AnalysisResult = {
    status: string;
    user: AnalysisUser;
    metrics: unknown;
    win_probability: number;
    win_rate: number;
    total_matches: number;
    player_moods: unknown[];
    weighted_averages: Record<string, unknown>;
    last_match_stats: Record<string, unknown>;
    enemy_stats: Record<string, unknown>;
    win_drivers: unknown[];
    skill_focus: unknown[];
    match_timeline_series: unknown;
    performance_trends: unknown[];
    territory_metrics: unknown;
    ranked_data: unknown;
    ddragon_version: string;
    heatmap_data: HeatmapData | null;
};

const toNum = (v: unknown, fallback: number) => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
};

export function normalizeAnalysisResult(raw: unknown): AnalysisResult {
    const data = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const user = (data.user && typeof data.user === 'object') ? (data.user as Record<string, unknown>) : {};

    return {
        status: typeof data.status === 'string' ? data.status : 'unknown',
        user: {
            game_name: typeof user.game_name === 'string' ? user.game_name : '',
            tag_line: typeof user.tag_line === 'string' ? user.tag_line : '',
            region: typeof user.region === 'string' ? user.region : '',
            profile_icon_id: toNum(user.profile_icon_id, 0),
            summoner_level: toNum(user.summoner_level, 0),
            puuid: typeof user.puuid === 'string' ? user.puuid : '',
        },
        metrics: data.metrics ?? {},
        win_probability: toNum(data.win_probability, 50),
        win_rate: toNum(data.win_rate, 0),
        total_matches: toNum(data.total_matches, 0),
        player_moods: Array.isArray(data.player_moods) ? data.player_moods : [],
        weighted_averages: (data.weighted_averages && typeof data.weighted_averages === 'object') ? (data.weighted_averages as Record<string, unknown>) : {},
        last_match_stats: (data.last_match_stats && typeof data.last_match_stats === 'object') ? (data.last_match_stats as Record<string, unknown>) : {},
        enemy_stats: (data.enemy_stats && typeof data.enemy_stats === 'object') ? (data.enemy_stats as Record<string, unknown>) : {},
        win_drivers: Array.isArray(data.win_drivers) ? data.win_drivers : [],
        skill_focus: Array.isArray(data.skill_focus) ? data.skill_focus : [],
        match_timeline_series: data.match_timeline_series ?? {},
        performance_trends: Array.isArray(data.performance_trends) ? data.performance_trends : [],
        territory_metrics: data.territory_metrics ?? {},
        ranked_data: data.ranked_data ?? null,
        ddragon_version: typeof data.ddragon_version === 'string' ? data.ddragon_version : '14.24.1',
        heatmap_data: (data.heatmap_data && typeof data.heatmap_data === 'object') ? (data.heatmap_data as HeatmapData) : null,
    };
}
