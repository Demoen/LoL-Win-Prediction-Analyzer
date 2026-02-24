/* ── Draft Analysis types & API client ─────────────────────────────────── */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Champion = {
    id: number;
    name: string;
    win_rate: number;
    pick_rate: number;
    games: number;
    icon_url: string;
    primary_role: string;
    viable_roles: string[];
};

export type PickSuggestion = {
    id: number;
    name: string;
    icon_url: string;
    win_probability: number;
    win_delta: number;
    synergy_score: number;
    counter_score: number;
    base_win_rate: number;
    games_in_dataset: number;
    role: string | null;
    viable_roles: string[];
    reason: string;
};

export type BanSuggestion = {
    id: number;
    name: string;
    icon_url: string;
    threat_score: number;
    base_win_rate: number;
    pick_rate: number;
    games_in_dataset: number;
    role: string;
    reason: string;
};

export type SynergyDetail = {
    ally_id: number;
    ally_name: string;
    games: number;
    win_rate: number;
    delta: number;
};

export type CounterDetail = {
    enemy_id: number;
    enemy_name: string;
    games: number;
    win_rate_vs: number;
};

export type RoleAssignment = {
    champion_id: number;
    champion_name: string;
    assigned_role: string;
};

export type DraftAnalysisResult = {
    win_probability: number;
    suggested_picks: PickSuggestion[];
    suggested_bans: BanSuggestion[];
    synergies: SynergyDetail[];
    counters: CounterDetail[];
    ally_roles: RoleAssignment[];
    enemy_roles: RoleAssignment[];
    unfilled_roles: string[];
    ddragon_version: string;
};

export type ChampionListResponse = {
    champions: Champion[];
    ddragon_version: string;
};

// ---------------------------------------------------------------------------
// Draft state types (frontend-only)
// ---------------------------------------------------------------------------

export type Side = "blue" | "red";

export type DraftSlotType = "ban" | "pick";

export type DraftSlot = {
    side: Side;
    type: DraftSlotType;
    index: number;        // 0-based within the phase-side group
    championId: number | null;
};

/**
 * SoloQ draft order (20 actions total):
 *   Ban Phase 1:  B B B R R R        (indices 0-5)
 *   Pick Phase 1: B R R B B R        (indices 6-11)
 *   Ban Phase 2:  R R R B B B        (indices 12-17) -- Note: actually R R B B R B in some patches
 *   Pick Phase 2: R R B B R          (indices 18-19 ... wait)
 *
 * Correct modern SoloQ draft (since 2024):
 *   Ban Phase 1:  B R B R B R        (6 bans, alternating)
 *   Pick Phase 1: B R R B B R        (6 picks)
 *   Ban Phase 2:  R B R B R B        (4 bans, alternating) -- Actually no second ban phase in soloq
 *
 * Actually the correct SoloQ draft order (Fearless/Standard):
 *   Ban Phase:    B1 R1 B2 R2 B3 R3 B4 R4 B5 R5  (10 bans, alternating)
 *   Pick Phase:   B1 R1R2 B2B3 R3R4 B4B5 R5       (10 picks, snake)
 *
 * Let's use the standard ranked solo/duo draft:
 *   10 bans (alternating B R B R B R B R B R)
 *   then picks: B - R R - B B - R R - B B - R
 */

export type DraftPhase =
    | "BAN_PHASE"
    | "PICK_PHASE"
    | "COMPLETE";

export interface DraftAction {
    side: Side;
    type: DraftSlotType;
    label: string;
}

/** The 20-step SoloQ draft sequence */
export const DRAFT_SEQUENCE: DraftAction[] = [
    // Ban phase (10 bans, alternating)
    { side: "blue", type: "ban",  label: "Blue Ban 1" },
    { side: "red",  type: "ban",  label: "Red Ban 1" },
    { side: "blue", type: "ban",  label: "Blue Ban 2" },
    { side: "red",  type: "ban",  label: "Red Ban 2" },
    { side: "blue", type: "ban",  label: "Blue Ban 3" },
    { side: "red",  type: "ban",  label: "Red Ban 3" },
    { side: "blue", type: "ban",  label: "Blue Ban 4" },
    { side: "red",  type: "ban",  label: "Red Ban 4" },
    { side: "blue", type: "ban",  label: "Blue Ban 5" },
    { side: "red",  type: "ban",  label: "Red Ban 5" },
    // Pick phase (snake draft)
    { side: "blue", type: "pick", label: "Blue Pick 1" },
    { side: "red",  type: "pick", label: "Red Pick 1" },
    { side: "red",  type: "pick", label: "Red Pick 2" },
    { side: "blue", type: "pick", label: "Blue Pick 2" },
    { side: "blue", type: "pick", label: "Blue Pick 3" },
    { side: "red",  type: "pick", label: "Red Pick 3" },
    { side: "red",  type: "pick", label: "Red Pick 4" },
    { side: "blue", type: "pick", label: "Blue Pick 4" },
    { side: "blue", type: "pick", label: "Blue Pick 5" },
    { side: "red",  type: "pick", label: "Red Pick 5" },
];

export const TOTAL_STEPS = DRAFT_SEQUENCE.length;

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

let _championsCache: ChampionListResponse | null = null;

export async function fetchChampions(): Promise<ChampionListResponse> {
    if (_championsCache) return _championsCache;

    const res = await fetch(`${API_URL}/draft/champions`);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as Record<string, string>)?.detail || `Failed to fetch champions (${res.status})`);
    }
    const data: ChampionListResponse = await res.json();
    _championsCache = data;
    return data;
}

export async function analyzeDraft(
    blueChampions: number[],
    redChampions: number[],
    bannedChampions: number[],
    userSide: Side,
    pickingSide?: Side | "ban",
): Promise<DraftAnalysisResult> {
    const res = await fetch(`${API_URL}/draft/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            blue_champions: blueChampions,
            red_champions: redChampions,
            banned_champions: bannedChampions,
            user_side: userSide,
            picking_side: pickingSide ?? userSide,
        }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as Record<string, string>)?.detail || `Draft analysis failed (${res.status})`);
    }
    return res.json();
}
