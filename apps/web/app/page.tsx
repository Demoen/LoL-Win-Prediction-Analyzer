"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Zap, Trophy, Target, Eye, Activity, Github } from "lucide-react";

import { SearchBar } from "@/components/SearchBar";
import { SplineHero } from "@/components/SplineHero";

// ─── Animated Counter ─────────────────────────────────────────────────────────
function CountUp({ end, duration = 2000, suffix = "" }: { end: number; duration?: number; suffix?: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        const startTime = performance.now();
        const step = (now: number) => {
          const progress = Math.min((now - startTime) / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          setCount(Math.floor(eased * end));
          if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      },
      { threshold: 0.1 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [end, duration]);
  return <span ref={ref}>{count.toLocaleString()}{suffix}</span>;
}

// ─── Ticker Items ─────────────────────────────────────────────────────────────
const TICKER_ITEMS = [
  "AI WIN PREDICTION ENGINE",
  "10,380 GAMES ANALYZED",
  "68.3% ACCURACY",
  "147 CHAMPIONS TRACKED",
  "REAL-TIME RIOT API",
  "EUW / NA / KR / EUNE",
  "TIMELINE ANALYSIS",
  "GOLD EFFICIENCY METRICS",
  "VISION SCORE HEATMAPS",
  "OBJECTIVE PRESSURE INDEX",
];

// ─── Feature Cards ────────────────────────────────────────────────────────────
const ANALYTICS_FEATURES = [
  {
    id: "combat",
    title: "Combat",
    icon: Trophy,
    accent: "#C8A84B",
    glyph: "01",
    stat: "KDA & DMG",
    metric: 97.4,
    unit: "%",
    label: "Kill Participation",
    desc: "Kill pressure, fight timing, and lethality pattern recognition.",
  },
  {
    id: "economy",
    title: "Economy",
    icon: Target,
    accent: "#FFD870",
    glyph: "02",
    stat: "GOLD & CS",
    metric: 234,
    unit: "",
    label: "CS/min Peak",
    desc: "Income velocity, itemization tempo, and gold lead conversion.",
  },
  {
    id: "vision",
    title: "Vision",
    icon: Eye,
    accent: "#B8962B",
    glyph: "03",
    stat: "WARD CTRL",
    metric: 82,
    unit: "%",
    label: "Vision Denial",
    desc: "Map control, deep ward placement, and prediction accuracy.",
  },
  {
    id: "objectives",
    title: "Objectives",
    icon: Zap,
    accent: "#E8C060",
    glyph: "04",
    stat: "OBJ CTRL",
    metric: 73,
    unit: "%",
    label: "Dragon Priority",
    desc: "Soul priority, Baron windows, and tower pressure timing.",
  },
  {
    id: "teamplay",
    title: "Teamplay",
    icon: Activity,
    accent: "#A07820",
    glyph: "05",
    stat: "SYNERGY",
    metric: 91,
    unit: "%",
    label: "Roam Success",
    desc: "Roaming impact, skirmish coordination, and team fight value.",
  },
];

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function Home() {
  const router = useRouter();
  const [riotId, setRiotId] = useState("");
  const [region, setRegion] = useState("euw");

  const handleSearch = async (searchId: string, searchRegion: string) => {
    if (!searchId.includes("#")) { alert("Please use format Name#Tag"); return; }
    router.push(`/summoner/${searchRegion}/${encodeURIComponent(searchId)}`);
  };

  return (
    <main className="min-h-screen bg-[#030308] text-white font-sans overflow-x-hidden selection:bg-[#C8A84B]/20">

      {/* ════════════════════════════════════════════════════════════
          SECTION 1 — HERO
      ════════════════════════════════════════════════════════════ */}
      <section className="relative min-h-screen flex flex-col overflow-hidden">

        {/* ── Layer 0: Spline 3D scene (background) ── */}
        <SplineHero />

        {/* ── Layer 1: Multi-depth gradient overlays ── */}
        <div className="absolute inset-0 z-[1] bg-gradient-to-b from-[#030308]/95 via-[#030308]/50 to-[#030308]" />
        <div className="absolute inset-0 z-[1] bg-gradient-to-r from-[#030308]/90 via-transparent to-[#030308]/90" />
        {/* Ambient light bleeds */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] z-[1]"
          style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(200,168,75,0.06) 0%, transparent 70%)" }} />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[1200px] h-[400px] z-[1]"
          style={{ background: "radial-gradient(ellipse at 50% 100%, rgba(0,209,255,0.05) 0%, transparent 65%)" }} />

        {/* ── Layer 2: Hex grid ── */}
        <div className="absolute inset-0 z-[2] opacity-[0.025] pointer-events-none"
          style={{ backgroundImage: "radial-gradient(circle, rgba(200,168,75,0.8) 1px, transparent 1px)", backgroundSize: "52px 52px" }} />

        {/* ── Layer 3: Animated gold scan line ── */}
        <div className="absolute inset-x-0 z-[3] pointer-events-none animate-hextech-scan h-px"
          style={{ background: "linear-gradient(90deg, transparent 0%, rgba(200,168,75,0.35) 35%, rgba(0,209,255,0.5) 50%, rgba(200,168,75,0.35) 65%, transparent 100%)" }} />

        {/* ── Layer 4: Floating rune particles ── */}
        {[
          { x: "12%", y: "22%", s: "4px", d: "0s",   op: 0.4 },
          { x: "78%", y: "15%", s: "3px", d: "1.2s", op: 0.3 },
          { x: "62%", y: "70%", s: "5px", d: "2.4s", op: 0.5 },
          { x: "24%", y: "65%", s: "3px", d: "0.7s", op: 0.35 },
          { x: "88%", y: "55%", s: "4px", d: "3.1s", op: 0.3 },
          { x: "42%", y: "85%", s: "3px", d: "1.8s", op: 0.4 },
          { x: "5%",  y: "48%", s: "5px", d: "0.4s", op: 0.3 },
          { x: "95%", y: "32%", s: "3px", d: "2.6s", op: 0.35 },
        ].map((p, i) => (
          <div key={i} className="absolute z-[4] rounded-full pointer-events-none animate-particle-float"
            style={{ left: p.x, top: p.y, width: p.s, height: p.s, animationDelay: p.d,
              background: `radial-gradient(circle, rgba(200,168,75,${p.op}) 0%, transparent 70%)`,
              boxShadow: `0 0 8px rgba(200,168,75,${p.op * 0.8})`, filter: "blur(0.5px)" }} />
        ))}

        {/* ── Layer 5: FUI corner labels ── */}
        <div className="absolute top-20 left-6 z-[6] pointer-events-none hidden lg:block">
          <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#C8A84B]/30 leading-relaxed">
            <div>NEXUS.INSIGHT v2.5</div>
            <div>REGION // EUW_LIVE</div>
          </div>
        </div>
        <div className="absolute top-20 right-6 z-[6] pointer-events-none text-right hidden lg:block">
          <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#C8A84B]/25 leading-relaxed">
            <div>SAT 21 FEB 2026</div>
            <div>SESSION // INITIALIZED</div>
          </div>
        </div>
        <div className="absolute bottom-20 left-6 z-[6] pointer-events-none hidden lg:block">
          <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#C8A84B]/25 leading-relaxed">
            <div>SUMMONER&apos;S RIFT</div>
            <div>SECTOR_01 // ACTIVE</div>
          </div>
        </div>
        <div className="absolute bottom-20 right-6 z-[6] pointer-events-none text-right hidden lg:block">
          <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#C8A84B]/25 leading-relaxed">
            <div>AI ENGINE</div>
            <div>STATUS // NOMINAL</div>
          </div>
        </div>

        {/* ── Layer 5: Decorative targeting reticle ── */}
        <div className="absolute inset-0 z-[5] flex items-center justify-center pointer-events-none">
          <div className="relative w-[600px] h-[600px] opacity-[0.07]">
            <div className="absolute inset-0 rounded-full border border-[#C8A84B]/60 animate-spin-xl" />
            <div className="absolute inset-[20px] rounded-full border border-dashed border-[#C8A84B]/40 animate-spin-xl-rev" />
            <div className="absolute inset-[60px] rounded-full border border-[#C8A84B]/40 animate-spin-slow" />
            <div className="absolute inset-[120px] rounded-full border border-[#C8A84B]/40 animate-spin-xl" />
            <div className="absolute top-1/2 left-8 right-8 h-px bg-gradient-to-r from-transparent via-[#C8A84B]/50 to-transparent -translate-y-1/2" />
            <div className="absolute left-1/2 top-8 bottom-8 w-px bg-gradient-to-b from-transparent via-[#C8A84B]/50 to-transparent -translate-x-1/2" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-[#C8A84B]/60 animate-energy-pulse" />
          </div>
        </div>

        {/* ── Layer 6: Header ── */}
        <header className="relative z-50 w-full border-b border-white/[0.04] bg-[#030308]/70 backdrop-blur-xl">
          <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3 cursor-pointer group" onClick={() => router.push("/")}>
              <div className="w-9 h-9 flex items-center justify-center">
                <img src="/logo.png" alt="NexusInsight" className="w-full h-full object-contain" />
              </div>
              <h2 className="text-lg font-black tracking-[0.12em] uppercase">
                <span className="text-white/80">NEXUS</span>
                <span className="text-[#C8A84B]">INSIGHT</span>
              </h2>
            </div>
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#C8A84B]/20 bg-[#C8A84B]/5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#C8A84B] animate-pulse" />
              <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#C8A84B]/60">AI ONLINE</span>
            </div>
          </div>
        </header>

        {/* ── Layer 7: Hero content ── */}
        <div className="relative z-20 flex-1 flex flex-col items-center justify-center px-6 pt-8 pb-32">

          {/* Intelligence badge */}
          <div className="flex items-center gap-3 mb-8 animate-fade-in-up" style={{ animationDelay: "0.1s" }}>
            <div className="w-8 h-px bg-gradient-to-l from-[#C8A84B]/60 to-transparent" />
            <span className="text-[10px] font-mono uppercase tracking-[0.3em] text-[#C8A84B]/70">
              Intelligence Engine // Active
            </span>
            <div className="w-8 h-px bg-gradient-to-r from-[#C8A84B]/60 to-transparent" />
          </div>

          {/* ── Main Title ── */}
          <h1 className="text-center mb-6 animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
            <span className="block text-[clamp(3.5rem,10vw,8rem)] font-black leading-[0.9] tracking-[-0.02em] text-white/90 uppercase">
              Find Your
            </span>
            <span className="block relative text-[clamp(5rem,15vw,13rem)] font-black leading-[0.85] tracking-[-0.03em] uppercase">
              <span className="absolute inset-0 text-[#C8A84B] blur-[40px] opacity-40 select-none" aria-hidden="true">EDGE</span>
              <span className="absolute inset-0 text-[#FFD870] blur-[15px] opacity-30 select-none" aria-hidden="true">EDGE</span>
              <span className="relative text-[#C8A84B] drop-shadow-[0_0_60px_rgba(200,168,75,0.5)]">EDGE</span>
              <span className="absolute left-[-0.12em] top-1/2 -translate-y-[55%] text-[0.4em] font-light text-[#C8A84B]/40 hidden md:inline">[</span>
              <span className="absolute right-[-0.12em] top-1/2 -translate-y-[55%] text-[0.4em] font-light text-[#C8A84B]/40 hidden md:inline">]</span>
            </span>
          </h1>

          {/* Subtitle */}
          <p className="text-center text-slate-400 text-base md:text-lg max-w-lg leading-relaxed mb-10 animate-fade-in-up" style={{ animationDelay: "0.35s" }}>
            Deep match analysis powered by AI.{" "}
            <span className="text-white/60">Win probability. Every advantage quantified.</span>
          </p>

          {/* ── Search Bar with targeting brackets ── */}
          <div className="w-full max-w-2xl relative animate-fade-in-up" style={{ animationDelay: "0.45s" }}>
            <div className="absolute -inset-3 rounded-sm opacity-20"
              style={{ background: "radial-gradient(ellipse at 50% 50%, rgba(200,168,75,0.4) 0%, transparent 70%)", filter: "blur(16px)" }} />
            <div className="absolute -top-1 -left-1 w-4 h-4 border-l border-t border-[#C8A84B]/50 z-10" />
            <div className="absolute -top-1 -right-1 w-4 h-4 border-r border-t border-[#C8A84B]/50 z-10" />
            <div className="absolute -bottom-1 -left-1 w-4 h-4 border-l border-b border-[#C8A84B]/50 z-10" />
            <div className="absolute -bottom-1 -right-1 w-4 h-4 border-r border-b border-[#C8A84B]/50 z-10" />
            <SearchBar onSearch={handleSearch} initialRiotId={riotId} initialRegion={region} />
          </div>

          {/* Quick links */}
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 mt-6 text-xs animate-fade-in-up" style={{ animationDelay: "0.55s" }}>
            <span className="text-slate-700 font-mono uppercase tracking-widest">TRY:</span>
            {[
              { id: "Zeniv#heart", r: "euw" },
              { id: "Sasaki#sit", r: "euw" },
              { id: "momo#owo7", r: "euw" },
            ].map((s) => (
              <button
                key={s.id}
                onClick={() => { setRiotId(s.id); setRegion(s.r); }}
                className="text-slate-500 hover:text-[#C8A84B] transition-all duration-200 font-medium hover:drop-shadow-[0_0_8px_rgba(200,168,75,0.6)]"
              >
                {s.id}
              </button>
            ))}
          </div>
        </div>

        {/* ── Layer 8: Stats ticker ── */}
        <div className="absolute bottom-0 left-0 right-0 z-20">
          <div className="h-px w-full bg-gradient-to-r from-transparent via-[#C8A84B]/25 to-transparent" />
          <div className="relative overflow-hidden bg-[#0a0806]/60 backdrop-blur-sm border-t border-[#C8A84B]/10 h-9">
            <div className="flex items-center h-full animate-ticker whitespace-nowrap">
              {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
                <span key={i} className="inline-flex items-center gap-3 px-4 text-[10px] font-mono uppercase tracking-[0.2em] text-[#C8A84B]/40">
                  <span className="w-1 h-1 rounded-full bg-[#C8A84B]/30 flex-shrink-0" />
                  {item}
                </span>
              ))}
            </div>
          </div>
        </div>

      </section>

      {/* ════════════════════════════════════════════════════════════
          LIVE METRICS STRIP
      ════════════════════════════════════════════════════════════ */}
      <div className="relative z-10 border-y border-white/[0.04] bg-[#050510]">
        <div className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-0 md:divide-x md:divide-white/[0.04]">
          {[
            { label: "Games Analyzed",      value: 10380, suffix: "+", color: "#C8A84B" },
            { label: "Prediction Accuracy", value: 68,    suffix: "%", color: "#FFD870" },
            { label: "Champions Tracked",   value: 147,   suffix: "",  color: "#C8A84B" },
            { label: "Data Points/Game",    value: 3400,  suffix: "+", color: "#FFD870" },
          ].map((m) => (
            <div key={m.label} className="flex flex-col items-center text-center px-4">
              <div className="text-3xl md:text-4xl font-black tracking-tight mb-1"
                style={{ color: m.color, textShadow: `0 0 30px ${m.color}40` }}>
                <CountUp end={m.value} suffix={m.suffix} duration={2200} />
              </div>
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-slate-600">{m.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════
          SECTION 2 — ANALYTICS ENGINE
      ════════════════════════════════════════════════════════════ */}
      <section className="relative z-10 bg-[#030308] py-24 px-6 overflow-hidden">

        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[200px] pointer-events-none"
          style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(200,168,75,0.04) 0%, transparent 70%)" }} />

        <div className="max-w-7xl mx-auto">

          {/* Section header */}
          <div className="mb-16 flex flex-col items-center text-center">
            <div className="flex items-center gap-4 mb-4">
              <div className="h-px w-16 bg-gradient-to-r from-transparent to-[#C8A84B]/50" />
              <span className="text-[10px] font-mono uppercase tracking-[0.3em] text-[#C8A84B]/50">
                Section_02 // Analytics Pillars
              </span>
              <div className="h-px w-16 bg-gradient-to-l from-transparent to-[#C8A84B]/50" />
            </div>
            <h2 className="text-4xl md:text-5xl font-black uppercase tracking-[-0.02em] text-white/90 mb-3">
              Nexus Analytics{" "}
              <span className="text-[#FFD870] drop-shadow-[0_0_30px_rgba(255,216,112,0.4)]">Engine</span>
            </h2>
            <p className="text-slate-500 max-w-md text-sm leading-relaxed">
              Five intelligence vectors. Every performance dimension decoded.
            </p>
          </div>

          {/* Feature cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {ANALYTICS_FEATURES.map((feat) => (
              <div key={feat.id} className="group relative cursor-pointer">
                {/* Outer hover glow */}
                <div
                  className="absolute -inset-px opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none"
                  style={{ background: `radial-gradient(ellipse at 50% 0%, ${feat.accent}22 0%, transparent 70%)` }}
                />

                <div
                  className="relative h-full flex flex-col bg-[#0a0907] border border-[#C8A84B]/10 transition-all duration-500 group-hover:border-[#C8A84B]/30 group-hover:-translate-y-1.5 overflow-hidden"
                  style={{ clipPath: "polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 16px 100%, 0 calc(100% - 16px))" }}
                >
                  {/* Top accent bar */}
                  <div
                    className="absolute top-0 left-0 right-[16px] h-[2px]"
                    style={{ background: `linear-gradient(90deg, ${feat.accent}90, ${feat.accent}20, transparent)` }}
                  />

                  {/* Corner notch fill */}
                  <div
                    className="absolute top-0 right-0 w-[16px] h-[16px]"
                    style={{ background: `linear-gradient(135deg, ${feat.accent}40 0%, transparent 60%)` }}
                  />
                  <div
                    className="absolute bottom-0 left-0 w-[16px] h-[16px]"
                    style={{ background: `linear-gradient(-45deg, ${feat.accent}15 0%, transparent 60%)` }}
                  />

                  {/* Glyph number */}
                  <div
                    className="absolute bottom-4 right-4 text-[3rem] font-black leading-none select-none pointer-events-none transition-all duration-500 group-hover:opacity-[0.07]"
                    style={{ color: feat.accent, opacity: 0.035 }}
                  >
                    {feat.glyph}
                  </div>

                  {/* Radial glow behind icon */}
                  <div
                    className="absolute top-0 left-0 right-0 h-32 opacity-40 group-hover:opacity-70 transition-opacity duration-500 pointer-events-none"
                    style={{ background: `radial-gradient(ellipse at 30% 0%, ${feat.accent}18 0%, transparent 65%)` }}
                  />

                  {/* Content */}
                  <div className="relative flex flex-col h-full p-5 pt-6">

                    {/* Icon */}
                    <div className="relative mb-5 self-start">
                      {/* Icon glow blob */}
                      <div
                        className="absolute inset-0 scale-150 blur-xl opacity-30 group-hover:opacity-60 transition-opacity duration-500"
                        style={{ background: feat.accent }}
                      />
                      <div
                        className="relative w-12 h-12 flex items-center justify-center border transition-all duration-300 group-hover:scale-105"
                        style={{
                          borderColor: `${feat.accent}30`,
                          background: `linear-gradient(135deg, ${feat.accent}18 0%, ${feat.accent}06 100%)`,
                          clipPath: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)",
                        }}
                      >
                        <feat.icon className="w-5 h-5" style={{ color: feat.accent }} />
                      </div>
                    </div>

                    {/* Title + badge row */}
                    <div className="flex items-start justify-between gap-2 mb-4">
                      <div>
                        <h4 className="font-black text-sm text-white uppercase tracking-[0.1em] mb-1.5">{feat.title}</h4>
                        <div
                          className="inline-flex items-center text-[8px] font-bold uppercase tracking-[0.18em] px-2 py-0.5 font-mono"
                          style={{ color: feat.accent, background: `${feat.accent}12`, border: `1px solid ${feat.accent}25` }}
                        >
                          {feat.stat}
                        </div>
                      </div>
                    </div>

                    {/* Big metric */}
                    <div className="mb-4">
                      <div
                        className="text-4xl font-black tracking-tight leading-none mb-0.5 transition-all duration-300"
                        style={{ color: feat.accent, textShadow: `0 0 40px ${feat.accent}60` }}
                      >
                        {feat.metric}{feat.unit}
                      </div>
                      <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-white/25">{feat.label}</div>
                    </div>

                    {/* Progress bar */}
                    <div className="mb-5">
                      <div className="h-[3px] bg-white/[0.05] relative overflow-hidden" style={{ borderRadius: 2 }}>
                        <div
                          className="absolute top-0 left-0 h-full"
                          style={{
                            width: `${feat.unit === "%" ? feat.metric : Math.min((feat.metric / 300) * 100, 100)}%`,
                            background: `linear-gradient(90deg, ${feat.accent}50, ${feat.accent})`,
                            boxShadow: `0 0 8px ${feat.accent}80`,
                            borderRadius: 2,
                          }}
                        />
                        {/* Shimmer sweep */}
                        <div
                          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                          style={{
                            background: `linear-gradient(90deg, transparent 0%, ${feat.accent}60 50%, transparent 100%)`,
                            animation: "shimmer-sweep 1.8s ease-in-out infinite",
                          }}
                        />
                      </div>
                    </div>

                    {/* Description */}
                    <p className="text-[11px] text-white/30 leading-relaxed mt-auto group-hover:text-white/45 transition-colors duration-300">
                      {feat.desc}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="mt-16 flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="group relative px-8 py-3.5 font-bold text-sm uppercase tracking-[0.2em] text-[#030308] bg-[#C8A84B] transition-all duration-300 hover:bg-[#FFD870] hover:shadow-[0_0_40px_-8px_rgba(200,168,75,0.7)] active:scale-[0.97]"
              style={{ clipPath: "polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 10px 100%, 0 calc(100% - 10px))" }}
            >
              Begin Analysis
            </button>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-slate-700">
              Free · No Sign-up · Real-time Results
            </div>
          </div>

        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          FOOTER
      ════════════════════════════════════════════════════════════ */}
      <footer className="relative z-10 border-t border-white/[0.04] bg-[#020206] px-6 py-8">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-slate-700">
              NEXUS<span className="text-[#C8A84B]/50">INSIGHT</span>
            </span>
            <span className="text-slate-800 text-[10px]">•</span>
            <span className="text-[10px] font-mono tracking-wider text-slate-800">Not affiliated with Riot Games</span>
          </div>
          <a
            href="https://github.com/Demoen/riotskillissue"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-2 text-slate-700 hover:text-[#C8A84B] transition-colors duration-300"
          >
            <Github className="w-3.5 h-3.5" />
            <span className="text-[9px] font-mono uppercase tracking-[0.15em]">
              Powered by <span className="group-hover:text-[#FFD870] transition-colors duration-300">riotskillissue</span>
            </span>
          </a>
        </div>
      </footer>

    </main>
  );
}
