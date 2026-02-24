"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  RotateCcw,
  Undo2,
  Shield,
  Swords,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Ban,
  Sparkles,
  AlertTriangle,
  Users,
  Crosshair,
  ArrowLeft,
} from "lucide-react";
import {
  type Champion,
  type Side,
  type DraftAnalysisResult,
  type PickSuggestion,
  type BanSuggestion,
  type RoleAssignment,
  DRAFT_SEQUENCE,
  TOTAL_STEPS,
  fetchChampions,
  analyzeDraft,
} from "@/lib/draftApi";

/* ── Constants ─────────────────────────────────────────────────────── */
const GOLD = "#C8A84B";
const GOLD_LIGHT = "#FFD870";
const BLUE = "#3B82F6";
const RED = "#EF4444";
const BG = "#030308";

const ROLE_LABELS: Record<string, string> = {
  TOP: "Top",
  JUNGLE: "Jng",
  MIDDLE: "Mid",
  BOTTOM: "Bot",
  SUPPORT: "Sup",
};

const ROLE_ICONS: Record<string, string> = {
  TOP: "⬆",
  JUNGLE: "🌿",
  MIDDLE: "◆",
  BOTTOM: "⬇",
  SUPPORT: "🛡",
};

const ALL_ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "SUPPORT"] as const;

/* ── Page ──────────────────────────────────────────────────────────── */
export default function DraftPage() {
  const router = useRouter();

  // ── Champions data ──
  const [champions, setChampions] = useState<Champion[]>([]);
  const [ddragonVersion, setDdragonVersion] = useState("14.24.1");
  const [loadingChamps, setLoadingChamps] = useState(true);

  // ── Draft state ──
  const [userSide, setUserSide] = useState<Side | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [selections, setSelections] = useState<(number | null)[]>(
    Array(TOTAL_STEPS).fill(null)
  );

  // ── Analysis state ──
  const [analysis, setAnalysis] = useState<DraftAnalysisResult | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  // ── Champion grid ──
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // ── Win probability history (for the chart) ──
  const [winHistory, setWinHistory] = useState<{ step: number; prob: number }[]>([]);

  // ── Load champions ──
  useEffect(() => {
    fetchChampions()
      .then((data) => {
        setChampions(data.champions);
        setDdragonVersion(data.ddragon_version);
      })
      .catch(console.error)
      .finally(() => setLoadingChamps(false));
  }, []);

  // ── Derived state ──
  const champById = useMemo(() => {
    const map: Record<number, Champion> = {};
    for (const c of champions) map[c.id] = c;
    return map;
  }, [champions]);

  const currentAction = currentStep < TOTAL_STEPS ? DRAFT_SEQUENCE[currentStep] : null;
  const phase = currentStep < 10 ? "BAN_PHASE" : currentStep < TOTAL_STEPS ? "PICK_PHASE" : "COMPLETE";

  const blueBans = useMemo(() => {
    const ids: number[] = [];
    for (let i = 0; i < Math.min(currentStep, TOTAL_STEPS); i++) {
      if (DRAFT_SEQUENCE[i].side === "blue" && DRAFT_SEQUENCE[i].type === "ban" && selections[i] != null)
        ids.push(selections[i]!);
    }
    return ids;
  }, [selections, currentStep]);

  const redBans = useMemo(() => {
    const ids: number[] = [];
    for (let i = 0; i < Math.min(currentStep, TOTAL_STEPS); i++) {
      if (DRAFT_SEQUENCE[i].side === "red" && DRAFT_SEQUENCE[i].type === "ban" && selections[i] != null)
        ids.push(selections[i]!);
    }
    return ids;
  }, [selections, currentStep]);

  const bluePicks = useMemo(() => {
    const ids: number[] = [];
    for (let i = 0; i < Math.min(currentStep, TOTAL_STEPS); i++) {
      if (DRAFT_SEQUENCE[i].side === "blue" && DRAFT_SEQUENCE[i].type === "pick" && selections[i] != null)
        ids.push(selections[i]!);
    }
    return ids;
  }, [selections, currentStep]);

  const redPicks = useMemo(() => {
    const ids: number[] = [];
    for (let i = 0; i < Math.min(currentStep, TOTAL_STEPS); i++) {
      if (DRAFT_SEQUENCE[i].side === "red" && DRAFT_SEQUENCE[i].type === "pick" && selections[i] != null)
        ids.push(selections[i]!);
    }
    return ids;
  }, [selections, currentStep]);

  const allBanned = useMemo(() => [...blueBans, ...redBans], [blueBans, redBans]);
  const allPicked = useMemo(() => [...bluePicks, ...redPicks], [bluePicks, redPicks]);
  const allTaken = useMemo(() => new Set([...allBanned, ...allPicked]), [allBanned, allPicked]);

  // ── Filtered champion grid ──
  const filteredChampions = useMemo(() => {
    let list = champions.filter((c) => !allTaken.has(c.id));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q));
    }
    if (roleFilter) {
      list = list.filter((c) =>
        c.viable_roles?.includes(roleFilter) || c.primary_role === roleFilter
      );
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [champions, allTaken, searchQuery, roleFilter]);

  // ── Run analysis whenever draft changes ──
  const runAnalysis = useCallback(async () => {
    if (!userSide || (bluePicks.length === 0 && redPicks.length === 0 && allBanned.length === 0)) {
      setAnalysis(null);
      return;
    }
    setAnalysisLoading(true);
    try {
      // Tell API whose turn it is so it generates picks/bans for the right side
      const pickingSide: Side | "ban" | undefined =
        currentAction?.type === "ban"
          ? currentAction.side   // banning — show bans for banning side
          : currentAction?.type === "pick"
          ? currentAction.side   // picking — show picks for picking side
          : undefined;           // draft complete

      const result = await analyzeDraft(bluePicks, redPicks, allBanned, userSide, pickingSide);
      setAnalysis(result);
      if (bluePicks.length > 0 || redPicks.length > 0) {
        setWinHistory((prev) => [
          ...prev,
          { step: currentStep, prob: result.win_probability },
        ]);
      }
    } catch (e) {
      console.error("Draft analysis error:", e);
    } finally {
      setAnalysisLoading(false);
    }
  }, [bluePicks, redPicks, allBanned, userSide, currentStep, currentAction]);

  useEffect(() => {
    if (userSide) {
      const timeout = setTimeout(runAnalysis, 200);
      return () => clearTimeout(timeout);
    }
  }, [runAnalysis, userSide]);

  // ── Handlers ──
  const handleSelectChampion = useCallback(
    (champId: number) => {
      if (currentStep >= TOTAL_STEPS) return;
      if (allTaken.has(champId)) return;
      const next = [...selections];
      next[currentStep] = champId;
      setSelections(next);
      setCurrentStep((s) => s + 1);
      setSearchQuery("");
    },
    [currentStep, selections, allTaken]
  );

  const handleUndo = useCallback(() => {
    if (currentStep <= 0) return;
    const prev = currentStep - 1;
    const next = [...selections];
    next[prev] = null;
    setSelections(next);
    setCurrentStep(prev);
    setWinHistory((h) => h.filter((p) => p.step < prev));
  }, [currentStep, selections]);

  const handleReset = useCallback(() => {
    setSelections(Array(TOTAL_STEPS).fill(null));
    setCurrentStep(0);
    setAnalysis(null);
    setWinHistory([]);
    setSearchQuery("");
    setRoleFilter(null);
  }, []);

  // ── Side selection screen ──
  if (userSide === null) {
    return (
      <main className="min-h-screen bg-[#030308] text-white font-sans flex flex-col">
        <Header onBack={() => router.push("/")} />
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="max-w-2xl w-full text-center">
            <SectionLabel text="Draft // Side Selection" />
            <h1 className="text-4xl md:text-6xl font-black uppercase tracking-tight mb-4 text-white/90">
              Choose Your{" "}
              <span className="text-[#C8A84B] drop-shadow-[0_0_30px_rgba(200,168,75,0.5)]">
                Side
              </span>
            </h1>
            <p className="text-slate-500 mb-12 text-sm">
              Select which side of the draft you are on in your live game.
            </p>
            <div className="grid grid-cols-2 gap-6">
              <SideButton side="blue" onClick={() => setUserSide("blue")} />
              <SideButton side="red" onClick={() => setUserSide("red")} />
            </div>
          </div>
        </div>
      </main>
    );
  }

  // ── Main draft UI ──
  return (
    <main className="min-h-screen bg-[#030308] text-white font-sans flex flex-col selection:bg-[#C8A84B]/20">
      <Header onBack={() => router.push("/")} />

      {/* ── Background effects ── */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-[#030308]/95 via-[#030308]/50 to-[#030308]" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[400px]"
          style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(200,168,75,0.04) 0%, transparent 70%)" }} />
        <div className="absolute inset-0 opacity-[0.015]"
          style={{ backgroundImage: "radial-gradient(circle, rgba(200,168,75,0.8) 1px, transparent 1px)", backgroundSize: "48px 48px" }} />
      </div>

      <div className="relative z-10 flex-1 flex flex-col">
        {/* ── Phase Header ── */}
        <div className="border-b border-white/[0.04] bg-[#050510]/80 backdrop-blur-sm">
          <div className="max-w-[1600px] mx-auto px-4 md:px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <PhaseIndicator phase={phase} currentStep={currentStep} />
              {currentAction && (
                <div className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full animate-pulse"
                    style={{ background: currentAction.side === "blue" ? BLUE : RED }}
                  />
                  <span className="text-xs font-mono uppercase tracking-widest text-white/50">
                    {currentAction.label}
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleUndo}
                disabled={currentStep === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest
                           border border-white/10 hover:border-[#C8A84B]/30 text-white/40 hover:text-[#C8A84B]
                           transition-all disabled:opacity-20 disabled:pointer-events-none"
              >
                <Undo2 className="w-3 h-3" /> Undo
              </button>
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest
                           border border-white/10 hover:border-red-500/30 text-white/40 hover:text-red-400
                           transition-all"
              >
                <RotateCcw className="w-3 h-3" /> Reset
              </button>
            </div>
          </div>
        </div>

        {/* ── Main content: 4-column layout ── */}
        <div className="flex-1 max-w-[1800px] mx-auto w-full px-4 md:px-6 py-6 grid grid-cols-1 lg:grid-cols-[minmax(180px,1fr)_minmax(360px,2.5fr)_minmax(180px,1fr)_minmax(220px,1.2fr)] gap-4 md:gap-5">

          {/* ── Col 1: Blue Side ── */}
          <div className="space-y-3">
            <TeamColumn
              side="blue"
              isUser={userSide === "blue"}
              bans={blueBans}
              picks={bluePicks}
              champById={champById}
              currentStep={currentStep}
              selections={selections}
              roleAssignments={
                // Blue column always shows blue's role assignments.
                // ally_roles from API reflects the picking side, so map correctly:
                currentAction?.side === "blue"
                  ? analysis?.ally_roles
                  : currentAction?.side === "red"
                  ? analysis?.enemy_roles
                  : userSide === "blue"
                  ? analysis?.ally_roles
                  : analysis?.enemy_roles
              }
            />
          </div>

          {/* ── Col 2: Win Prob + Champion Grid ── */}
          <div className="space-y-4">
            {/* Win probability bar */}
            <WinProbabilityBar
              winProb={analysis?.win_probability ?? 50}
              userSide={userSide}
              loading={analysisLoading}
            />

            {/* Champion search + role filter + grid */}
            <div className="relative">
              <div className="flex items-center gap-2 mb-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#C8A84B]/40" />
                  <input
                    ref={searchRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search champions..."
                    className="w-full pl-10 pr-4 py-2 bg-white/[0.03] border border-white/[0.06] text-sm text-white/80
                               placeholder:text-white/20 focus:outline-none focus:border-[#C8A84B]/30
                               font-mono tracking-wide transition-colors"
                  />
                </div>
                <div className="text-[9px] font-mono text-white/20 uppercase tracking-widest whitespace-nowrap">
                  {filteredChampions.length} available
                </div>
              </div>

              {/* Role filter buttons */}
              <div className="flex items-center gap-1 mb-3">
                <button
                  onClick={() => setRoleFilter(null)}
                  className={`px-2 py-1 text-[9px] font-mono uppercase tracking-widest border transition-all ${
                    roleFilter === null
                      ? "border-[#C8A84B]/40 text-[#C8A84B] bg-[#C8A84B]/10"
                      : "border-white/[0.06] text-white/25 hover:text-white/40 hover:border-white/10"
                  }`}
                >
                  All
                </button>
                {ALL_ROLES.map((role) => {
                  const isUnfilled = analysis?.unfilled_roles?.includes(role);
                  const isActive = roleFilter === role;
                  return (
                    <button
                      key={role}
                      onClick={() => setRoleFilter(isActive ? null : role)}
                      className={`px-2 py-1 text-[9px] font-mono uppercase tracking-widest border transition-all relative ${
                        isActive
                          ? "border-[#C8A84B]/40 text-[#C8A84B] bg-[#C8A84B]/10"
                          : isUnfilled
                          ? "border-green-500/30 text-green-400/60 hover:text-green-400 hover:border-green-500/40 bg-green-500/5"
                          : "border-white/[0.06] text-white/25 hover:text-white/40 hover:border-white/10"
                      }`}
                      title={isUnfilled ? `${ROLE_LABELS[role]} — unfilled` : ROLE_LABELS[role]}
                    >
                      {ROLE_LABELS[role]}
                      {isUnfilled && (
                        <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                      )}
                    </button>
                  );
                })}
              </div>

              {loadingChamps ? (
                <div className="flex items-center justify-center h-64">
                  <div className="text-sm text-white/30 font-mono animate-pulse">Loading champions...</div>
                </div>
              ) : phase === "COMPLETE" ? (
                <div className="flex items-center justify-center h-64 text-center">
                  <div>
                    <Sparkles className="w-10 h-10 text-[#C8A84B]/60 mx-auto mb-3" />
                    <div className="text-lg font-bold text-[#C8A84B]">Draft Complete</div>
                    <div className="text-xs text-white/30 mt-1 font-mono">All champions have been selected</div>
                  </div>
                </div>
              ) : (
                <div
                  className="grid gap-1 overflow-y-auto max-h-[420px] scrollbar-thin pr-1"
                  style={{ gridTemplateColumns: "repeat(auto-fill, minmax(56px, 1fr))" }}
                >
                  {filteredChampions.map((champ) => (
                    <ChampionIcon
                      key={champ.id}
                      champion={champ}
                      onClick={() => handleSelectChampion(champ.id)}
                      disabled={currentStep >= TOTAL_STEPS}
                      isHighlighted={false}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Win probability evolution */}
            {winHistory.length > 1 && (
              <WinHistoryMini history={winHistory} />
            )}
          </div>

          {/* ── Col 3: Red Side ── */}
          <div className="space-y-3">
            <TeamColumn
              side="red"
              isUser={userSide === "red"}
              bans={redBans}
              picks={redPicks}
              champById={champById}
              currentStep={currentStep}
              selections={selections}
              roleAssignments={
                // Red column always shows red's role assignments.
                currentAction?.side === "red"
                  ? analysis?.ally_roles
                  : currentAction?.side === "blue"
                  ? analysis?.enemy_roles
                  : userSide === "red"
                  ? analysis?.ally_roles
                  : analysis?.enemy_roles
              }
            />
          </div>

          {/* ── Col 4: Suggestions ── */}
          <div className="space-y-4">
            <SuggestionsPanel
              analysis={analysis}
              loading={analysisLoading}
              phase={phase}
              champById={champById}
              userSide={userSide}
              pickingSide={currentAction?.side ?? userSide}
            />
          </div>
        </div>
      </div>
    </main>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Sub-components
   ════════════════════════════════════════════════════════════════════ */

function Header({ onBack }: { onBack: () => void }) {
  return (
    <header className="relative z-50 w-full border-b border-white/[0.04] bg-[#030308]/70 backdrop-blur-xl">
      <div className="max-w-[1600px] mx-auto px-4 md:px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-white/40 hover:text-[#C8A84B] transition-colors mr-2"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-[10px] font-mono uppercase tracking-widest hidden sm:inline">Home</span>
          </button>
          <div className="w-px h-6 bg-white/10" />
          <div className="flex items-center gap-2 cursor-pointer" onClick={onBack}>
            <div className="w-7 h-7 flex items-center justify-center">
              <img src="/logo.png" alt="NexusInsight" className="w-full h-full object-contain" />
            </div>
            <h2 className="text-sm font-black tracking-[0.1em] uppercase">
              <span style={{ color: "rgba(255,255,255,0.7)" }}>NEXUS</span>
              <span className="text-[#C8A84B]">INSIGHT</span>
            </h2>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-1 rounded-full border border-[#C8A84B]/20 bg-[#C8A84B]/5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#C8A84B] animate-pulse" />
          <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#C8A84B]/60">
            DRAFT MODE
          </span>
        </div>
      </div>
    </header>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center gap-3 mb-6">
      <div className="h-px w-12 bg-gradient-to-l from-[#C8A84B]/50 to-transparent" />
      <span className="text-[9px] font-mono uppercase tracking-[0.3em] text-[#C8A84B]/50">
        {text}
      </span>
      <div className="h-px w-12 bg-gradient-to-r from-[#C8A84B]/50 to-transparent" />
    </div>
  );
}

function SideButton({ side, onClick }: { side: Side; onClick: () => void }) {
  const isBlue = side === "blue";
  const color = isBlue ? BLUE : RED;
  return (
    <button
      onClick={onClick}
      className="group relative flex flex-col items-center gap-4 p-8 border transition-all duration-300 hover:-translate-y-1"
      style={{
        borderColor: `${color}20`,
        background: `linear-gradient(180deg, ${color}08 0%, transparent 100%)`,
        clipPath: "polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 14px 100%, 0 calc(100% - 14px))",
      }}
    >
      <div
        className="absolute top-0 left-0 right-[14px] h-[2px]"
        style={{ background: `linear-gradient(90deg, ${color}60, ${color}15, transparent)` }}
      />
      <div
        className="w-16 h-16 flex items-center justify-center border"
        style={{
          borderColor: `${color}30`,
          background: `${color}15`,
          clipPath: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)",
        }}
      >
        {isBlue ? (
          <Shield className="w-7 h-7" style={{ color }} />
        ) : (
          <Swords className="w-7 h-7" style={{ color }} />
        )}
      </div>
      <div>
        <div className="text-lg font-black uppercase tracking-wider" style={{ color }}>
          {side} Side
        </div>
        <div className="text-[10px] text-white/30 font-mono uppercase tracking-widest mt-1">
          {isBlue ? "First pick" : "Counter pick"}
        </div>
      </div>
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{ background: `radial-gradient(ellipse at 50% 30%, ${color}10 0%, transparent 70%)` }}
      />
    </button>
  );
}

function PhaseIndicator({ phase, currentStep }: { phase: string; currentStep: number }) {
  const label =
    phase === "BAN_PHASE"
      ? "BAN PHASE"
      : phase === "PICK_PHASE"
      ? "PICK PHASE"
      : "COMPLETE";
  const progress = (currentStep / TOTAL_STEPS) * 100;

  return (
    <div className="flex items-center gap-3">
      <div className="text-xs font-mono font-bold uppercase tracking-[0.15em] text-[#C8A84B]">
        {label}
      </div>
      <div className="w-24 h-1 bg-white/[0.05] overflow-hidden">
        <div
          className="h-full transition-all duration-500"
          style={{
            width: `${progress}%`,
            background: `linear-gradient(90deg, ${GOLD}80, ${GOLD_LIGHT})`,
            boxShadow: `0 0 8px ${GOLD}60`,
          }}
        />
      </div>
      <span className="text-[10px] font-mono text-white/30">{currentStep}/{TOTAL_STEPS}</span>
    </div>
  );
}

/* ── Team Column ──────────────────────────────────────────────────── */

function TeamColumn({
  side,
  isUser,
  bans,
  picks,
  champById,
  currentStep,
  selections,
  roleAssignments,
}: {
  side: Side;
  isUser: boolean;
  bans: number[];
  picks: number[];
  champById: Record<number, Champion>;
  currentStep: number;
  selections: (number | null)[];
  roleAssignments?: RoleAssignment[];
}) {
  const color = side === "blue" ? BLUE : RED;
  const maxBans = 5;
  const maxPicks = 5;

  const currentAction = currentStep < TOTAL_STEPS ? DRAFT_SEQUENCE[currentStep] : null;

  // Build role lookup: champId → assigned role
  const roleMap: Record<number, string> = {};
  if (roleAssignments) {
    for (const ra of roleAssignments) {
      roleMap[ra.champion_id] = ra.assigned_role;
    }
  }

  return (
    <div
      className="relative border p-4 space-y-4"
      style={{
        borderColor: `${color}15`,
        background: `linear-gradient(180deg, ${color}06 0%, transparent 60%)`,
        clipPath: "polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px))",
      }}
    >
      {/* Top accent line */}
      <div
        className="absolute top-0 left-0 right-[10px] h-[2px]"
        style={{ background: `linear-gradient(90deg, ${color}60, ${color}15, transparent)` }}
      />

      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ background: color, boxShadow: `0 0 6px ${color}80` }}
          />
          <span className="text-xs font-black uppercase tracking-[0.15em]" style={{ color }}>
            {side} side
          </span>
        </div>
        {isUser && (
          <span className="text-[8px] font-mono uppercase tracking-[0.2em] px-2 py-0.5 border"
            style={{ color: GOLD, borderColor: `${GOLD}30`, background: `${GOLD}10` }}>
            YOU
          </span>
        )}
      </div>

      {/* Bans */}
      <div>
        <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/20 mb-2 flex items-center gap-1.5">
          <Ban className="w-3 h-3" /> Bans
        </div>
        <div className="flex gap-1.5">
          {Array.from({ length: maxBans }).map((_, i) => {
            const champId = bans[i];
            const champ = champId ? champById[champId] : null;
            const isActive =
              currentAction?.side === side &&
              currentAction?.type === "ban" &&
              i === bans.length;

            return (
              <div
                key={i}
                className={`relative w-10 h-10 border flex items-center justify-center overflow-hidden
                  transition-all duration-300 ${isActive ? "animate-pulse" : ""}`}
                style={{
                  borderColor: isActive ? `${color}60` : champ ? `${color}20` : "rgba(255,255,255,0.04)",
                  background: champ
                    ? `linear-gradient(135deg, ${color}20, ${color}08)`
                    : isActive
                    ? `${color}08`
                    : "rgba(255,255,255,0.01)",
                }}
              >
                {champ ? (
                  <>
                    <img
                      src={champ.icon_url}
                      alt={champ.name}
                      className="w-full h-full object-cover opacity-40 grayscale"
                    />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div
                        className="w-full h-[1px] rotate-45"
                        style={{ background: `${RED}80` }}
                      />
                    </div>
                  </>
                ) : isActive ? (
                  <span className="text-[10px]" style={{ color }}>?</span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* Picks */}
      <div>
        <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-white/20 mb-2 flex items-center gap-1.5">
          <Swords className="w-3 h-3" /> Picks
        </div>
        <div className="space-y-1.5">
          {Array.from({ length: maxPicks }).map((_, i) => {
            const champId = picks[i];
            const champ = champId ? champById[champId] : null;
            const isActive =
              currentAction?.side === side &&
              currentAction?.type === "pick" &&
              i === picks.length;

            return (
              <div
                key={i}
                className={`relative flex items-center gap-3 p-1.5 border transition-all duration-300
                  ${isActive ? "border-opacity-60" : ""}`}
                style={{
                  borderColor: isActive ? `${color}50` : champ ? `${color}15` : "rgba(255,255,255,0.03)",
                  background: champ
                    ? `linear-gradient(90deg, ${color}10, transparent)`
                    : isActive
                    ? `${color}05`
                    : "rgba(255,255,255,0.01)",
                  boxShadow: isActive ? `inset 0 0 20px ${color}10, 0 0 10px ${color}08` : undefined,
                }}
              >
                <div
                  className="w-10 h-10 flex-shrink-0 border overflow-hidden flex items-center justify-center"
                  style={{
                    borderColor: champ ? `${color}25` : "rgba(255,255,255,0.04)",
                    background: champ ? `${color}10` : "transparent",
                  }}
                >
                  {champ ? (
                    <img
                      src={champ.icon_url}
                      alt={champ.name}
                      className="w-full h-full object-cover"
                    />
                  ) : isActive ? (
                    <span className="text-xs animate-pulse" style={{ color }}>?</span>
                  ) : (
                    <span className="text-[10px] text-white/10">{i + 1}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  {champ ? (
                    <>
                      <div className="text-xs font-bold text-white/80 truncate">{champ.name}</div>
                      <div className="flex items-center gap-1.5">
                        {roleMap[champId!] && (
                          <span className="text-[8px] font-mono px-1 py-0.5 border border-white/10 bg-white/[0.03] text-white/40 uppercase tracking-wider">
                            {ROLE_LABELS[roleMap[champId!]] ?? roleMap[champId!]}
                          </span>
                        )}
                        <span className="text-[9px] font-mono text-white/25">{champ.win_rate}% WR</span>
                      </div>
                    </>
                  ) : isActive ? (
                    <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: `${color}80` }}>
                      Selecting...
                    </div>
                  ) : (
                    <div className="text-[10px] text-white/10 font-mono">Pick {i + 1}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Win Probability Bar ──────────────────────────────────────────── */

function WinProbabilityBar({
  winProb,
  userSide,
  loading,
}: {
  winProb: number;
  userSide: Side;
  loading: boolean;
}) {
  const blueProb = userSide === "blue" ? winProb : 100 - winProb;
  const redProb = 100 - blueProb;

  return (
    <div className="relative border border-white/[0.04] bg-white/[0.01] p-4"
      style={{ clipPath: "polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px))" }}>
      {/* Labels */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-black uppercase tracking-wider" style={{ color: BLUE }}>
            Blue
          </span>
          <span className="text-lg font-black tabular-nums" style={{ color: BLUE }}>
            {blueProb.toFixed(1)}%
          </span>
        </div>
        <div className="text-[9px] font-mono text-white/20 uppercase tracking-widest">
          {loading ? "Calculating..." : "Win Probability"}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-black tabular-nums" style={{ color: RED }}>
            {redProb.toFixed(1)}%
          </span>
          <span className="text-xs font-black uppercase tracking-wider" style={{ color: RED }}>
            Red
          </span>
        </div>
      </div>

      {/* Bar */}
      <div className="relative h-3 flex overflow-hidden" style={{ borderRadius: 2 }}>
        <div
          className="h-full transition-all duration-700 ease-out"
          style={{
            width: `${blueProb}%`,
            background: `linear-gradient(90deg, ${BLUE}90, ${BLUE})`,
            boxShadow: `0 0 10px ${BLUE}50`,
          }}
        />
        <div
          className="h-full transition-all duration-700 ease-out"
          style={{
            width: `${redProb}%`,
            background: `linear-gradient(90deg, ${RED}, ${RED}90)`,
            boxShadow: `0 0 10px ${RED}50`,
          }}
        />
        {/* Center marker */}
        <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-px bg-white/20" />
      </div>
    </div>
  );
}

/* ── Champion Icon ────────────────────────────────────────────────── */

function ChampionIcon({
  champion,
  onClick,
  disabled,
  isHighlighted,
}: {
  champion: Champion;
  onClick: () => void;
  disabled: boolean;
  isHighlighted: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`group relative flex flex-col items-center transition-all duration-200
        hover:-translate-y-0.5 active:scale-95 disabled:opacity-30 disabled:pointer-events-none`}
      title={`${champion.name} (${champion.win_rate}% WR)`}
    >
      <div
        className={`relative w-12 h-12 border overflow-hidden transition-all duration-200
          group-hover:border-[#C8A84B]/40 group-hover:shadow-[0_0_12px_rgba(200,168,75,0.2)]
          ${isHighlighted ? "border-[#C8A84B]/50 shadow-[0_0_12px_rgba(200,168,75,0.3)]" : "border-white/[0.06]"}`}
      >
        <img
          src={champion.icon_url}
          alt={champion.name}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <span className="text-[8px] text-white/30 group-hover:text-white/60 mt-0.5 font-mono truncate max-w-[56px] transition-colors">
        {champion.name}
      </span>
    </button>
  );
}

/* ── Suggestions Panel ────────────────────────────────────────────── */

function SuggestionsPanel({
  analysis,
  loading,
  phase,
  champById,
  userSide,
  pickingSide,
}: {
  analysis: DraftAnalysisResult | null;
  loading: boolean;
  phase: string;
  champById: Record<number, Champion>;
  userSide: Side;
  pickingSide: Side;
}) {
  const [activeTab, setActiveTab] = useState<"picks" | "bans" | "matchups">("picks");

  const isOwnTurn = pickingSide === userSide;
  const sideColor = pickingSide === "blue" ? BLUE : RED;
  const sideLabel = pickingSide === "blue" ? "Blue Side" : "Red Side";

  if (!analysis && !loading) {
    return (
      <div className="border border-white/[0.04] bg-white/[0.01] p-6 text-center"
        style={{ clipPath: "polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px))" }}>
        <Sparkles className="w-8 h-8 text-[#C8A84B]/30 mx-auto mb-3" />
        <div className="text-xs font-mono text-white/30 uppercase tracking-widest">
          Start drafting to see suggestions
        </div>
      </div>
    );
  }

  return (
    <div
      className="border bg-white/[0.01] overflow-hidden"
      style={{
        clipPath: "polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px))",
        borderColor: phase !== "COMPLETE" ? `${sideColor}25` : "rgba(255,255,255,0.04)",
      }}
    >
      {/* Whose suggestions these are */}
      {phase !== "COMPLETE" && (
        <div
          className="flex items-center justify-between px-3 py-1.5 border-b"
          style={{ borderColor: `${sideColor}15`, background: `${sideColor}08` }}
        >
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: sideColor }} />
            <span className="text-[9px] font-mono uppercase tracking-[0.2em]" style={{ color: sideColor }}>
              {sideLabel}
            </span>
          </div>
          {!isOwnTurn && (
            <span className="text-[8px] font-mono text-white/25 uppercase tracking-widest">enemy turn</span>
          )}
          {isOwnTurn && (
            <span className="text-[8px] font-mono uppercase tracking-widest" style={{ color: `${GOLD}80` }}>your turn</span>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-white/[0.04]">
        {(["picks", "bans", "matchups"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2.5 text-[10px] font-mono uppercase tracking-[0.15em] transition-all
              ${activeTab === tab
                ? "text-[#C8A84B] border-b-2 border-[#C8A84B] bg-[#C8A84B]/5"
                : "text-white/30 hover:text-white/50"
              }`}
          >
            {tab === "picks" && <span className="inline-flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Picks</span>}
            {tab === "bans" && <span className="inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Bans</span>}
            {tab === "matchups" && <span className="inline-flex items-center gap-1"><Crosshair className="w-3 h-3" /> Matchups</span>}
          </button>
        ))}
      </div>

      <div className="p-3 space-y-2 max-h-[500px] overflow-y-auto scrollbar-thin">
        {loading && !analysis ? (
          <div className="py-8 text-center">
            <div className="text-xs font-mono text-white/30 animate-pulse">Analyzing...</div>
          </div>
        ) : activeTab === "picks" ? (
          <PickSuggestions picks={analysis?.suggested_picks ?? []} />
        ) : activeTab === "bans" ? (
          <BanSuggestions bans={analysis?.suggested_bans ?? []} />
        ) : (
          <MatchupDetails
            synergies={analysis?.synergies ?? []}
            counters={analysis?.counters ?? []}
            champById={champById}
          />
        )}
      </div>
    </div>
  );
}

function PickSuggestions({ picks }: { picks: PickSuggestion[] }) {
  if (picks.length === 0) {
    return <div className="py-4 text-center text-xs text-white/20 font-mono">No suggestions available yet</div>;
  }

  return (
    <>
      <div className="text-[9px] font-mono text-white/20 uppercase tracking-widest mb-1">
        Recommended picks
      </div>
      {picks.map((p, i) => (
        <div
          key={p.id}
          className="flex items-center gap-3 p-2 border border-white/[0.03] hover:border-[#C8A84B]/15
                     bg-white/[0.01] hover:bg-[#C8A84B]/5 transition-all group"
        >
          <div className="text-[10px] font-mono text-white/15 w-4 text-center">{i + 1}</div>
          <div className="w-9 h-9 border border-white/[0.06] overflow-hidden flex-shrink-0">
            <img src={p.icon_url} alt={p.name} className="w-full h-full object-cover" loading="lazy" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white/80 truncate">{p.name}</span>
              {p.role && (
                <span className="text-[8px] font-mono px-1 py-0.5 border border-[#C8A84B]/20 bg-[#C8A84B]/5 text-[#C8A84B]/70 uppercase tracking-wider">
                  {ROLE_LABELS[p.role] ?? p.role}
                </span>
              )}
              {Math.abs(p.win_delta) >= 0.5 && (
                <span
                  className="text-[10px] font-mono font-bold"
                  style={{ color: p.win_delta > 0 ? "#4ade80" : p.win_delta < 0 ? RED : "white" }}
                >
                  {p.win_delta > 0 ? "+" : ""}{p.win_delta}%
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              {p.synergy_score > 0.01 && (
                <span className="text-[8px] font-mono px-1 py-0.5 bg-blue-500/10 text-blue-300/70 border border-blue-500/15">
                  SYN +{(p.synergy_score * 100).toFixed(1)}%
                </span>
              )}
              {p.counter_score > 0.01 && (
                <span className="text-[8px] font-mono px-1 py-0.5 bg-red-500/10 text-red-300/70 border border-red-500/15">
                  CTR +{(p.counter_score * 100).toFixed(1)}%
                </span>
              )}
              <span className="text-[8px] font-mono text-white/15">{p.base_win_rate}% WR</span>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function BanSuggestions({ bans }: { bans: BanSuggestion[] }) {
  if (bans.length === 0) {
    return <div className="py-4 text-center text-xs text-white/20 font-mono">No ban suggestions available</div>;
  }

  return (
    <>
      <div className="text-[9px] font-mono text-white/20 uppercase tracking-widest mb-1">
        High threat — ban these
      </div>
      {bans.map((b, i) => (
        <div
          key={b.id}
          className="flex items-center gap-3 p-2 border border-white/[0.03] hover:border-red-500/15
                     bg-white/[0.01] hover:bg-red-500/5 transition-all"
        >
          <div className="text-[10px] font-mono text-white/15 w-4 text-center">{i + 1}</div>
          <div className="w-9 h-9 border border-white/[0.06] overflow-hidden flex-shrink-0 relative">
            <img src={b.icon_url} alt={b.name} className="w-full h-full object-cover" loading="lazy" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Ban className="w-5 h-5 text-red-500/60" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white/80 truncate">{b.name}</span>
              {b.role && (
                <span className="text-[8px] font-mono px-1 py-0.5 border border-white/10 bg-white/[0.03] text-white/30 uppercase tracking-wider">
                  {ROLE_LABELS[b.role] ?? b.role}
                </span>
              )}
              <span className="text-[10px] font-mono font-bold text-red-400">
                {b.threat_score > 0 ? "-" : ""}{b.threat_score.toFixed(1)}%
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[8px] font-mono text-white/15">{b.base_win_rate}% WR</span>
              <span className="text-[8px] font-mono text-white/15">{b.pick_rate}% PR</span>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function MatchupDetails({
  synergies,
  counters,
  champById,
}: {
  synergies: { ally_id: number; ally_name: string; games: number; win_rate: number; delta: number }[];
  counters: { enemy_id: number; enemy_name: string; games: number; win_rate_vs: number }[];
  champById: Record<number, Champion>;
}) {
  if (synergies.length === 0 && counters.length === 0) {
    return (
      <div className="py-4 text-center text-xs text-white/20 font-mono">
        Pick champions to see matchup details
      </div>
    );
  }

  return (
    <>
      {synergies.length > 0 && (
        <div>
          <div className="text-[9px] font-mono text-white/20 uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <Users className="w-3 h-3" /> Team Synergies
          </div>
          <div className="space-y-1">
            {synergies.map((s, i) => (
              <div key={i} className="flex items-center justify-between p-1.5 bg-white/[0.01] border border-white/[0.03] text-xs">
                <span className="text-white/60">{s.ally_name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-mono text-white/20">{s.games} games</span>
                  <span
                    className="font-mono font-bold text-[10px]"
                    style={{ color: s.delta > 0 ? "#4ade80" : s.delta < 0 ? RED : "white" }}
                  >
                    {s.delta > 0 ? "+" : ""}{s.delta.toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {counters.length > 0 && (
        <div className="mt-3">
          <div className="text-[9px] font-mono text-white/20 uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <Crosshair className="w-3 h-3" /> Vs Enemy
          </div>
          <div className="space-y-1">
            {counters.map((c, i) => (
              <div key={i} className="flex items-center justify-between p-1.5 bg-white/[0.01] border border-white/[0.03] text-xs">
                <span className="text-white/60">{c.enemy_name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-mono text-white/20">{c.games} games</span>
                  <span
                    className="font-mono font-bold text-[10px]"
                    style={{ color: c.win_rate_vs > 52 ? "#4ade80" : c.win_rate_vs < 48 ? RED : "white" }}
                  >
                    {c.win_rate_vs.toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/* ── Mini Win History ─────────────────────────────────────────────── */

function WinHistoryMini({ history }: { history: { step: number; prob: number }[] }) {
  const maxProb = Math.max(...history.map((h) => h.prob), 55);
  const minProb = Math.min(...history.map((h) => h.prob), 45);
  const range = maxProb - minProb || 10;

  return (
    <div className="border border-white/[0.04] bg-white/[0.01] p-3"
      style={{ clipPath: "polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 6px 100%, 0 calc(100% - 6px))" }}>
      <div className="text-[9px] font-mono text-white/20 uppercase tracking-widest mb-2">
        Win % Evolution
      </div>
      <div className="relative h-16 flex items-end gap-0.5">
        {/* 50% line */}
        <div
          className="absolute left-0 right-0 h-px bg-white/10"
          style={{ bottom: `${((50 - minProb) / range) * 100}%` }}
        />
        {history.map((h, i) => {
          const height = ((h.prob - minProb) / range) * 100;
          const isAbove50 = h.prob >= 50;
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
              <div
                className="w-full min-h-[2px] transition-all duration-300"
                style={{
                  height: `${Math.max(height, 4)}%`,
                  background: isAbove50
                    ? "linear-gradient(180deg, #4ade8080, #4ade8030)"
                    : `linear-gradient(180deg, ${RED}80, ${RED}30)`,
                  borderTop: `1px solid ${isAbove50 ? "#4ade80" : RED}`,
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
