"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Zap, Trophy, Target, Eye, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

import { SearchBar } from "@/components/SearchBar";
import { ElectricMap } from "@/components/ElectricMap";

export default function Home() {
  const router = useRouter();
  // Lifted state to pass to SearchBar and control from Popular Profiles
  const [riotId, setRiotId] = useState("");
  const [region, setRegion] = useState("euw");

  const handleSearch = async (searchId: string, searchRegion: string) => {
    if (!searchId.includes("#")) {
      alert("Please use format Name#Tag");
      return;
    }
    const encodedId = encodeURIComponent(searchId);
    router.push(`/summoner/${searchRegion}/${encodedId}`);
  };

  return (
    <main className="min-h-screen bg-[#05050f] text-white flex flex-col font-sans selection:bg-[#5842F4]/30 relative overflow-hidden">

      {/* ========== CSS Background System ========== */}
      <div className="fixed inset-0 z-0 pointer-events-none bg-gradient-to-br from-[#0a0a18] via-[#05050f] to-[#080812]"></div>

      {/* Animated lane glows */}
      <div className="fixed z-0 pointer-events-none animate-lane-glow" style={{ top: '5%', left: '5%', width: '45%', height: '3px', background: 'linear-gradient(90deg, rgba(88, 66, 244, 0.3), transparent)', transform: 'rotate(25deg)', transformOrigin: 'left center', filter: 'blur(8px)' }}></div>
      <div className="fixed z-0 pointer-events-none animate-lane-glow" style={{ top: '50%', left: '50%', width: '70%', height: '2px', background: 'linear-gradient(90deg, rgba(0, 209, 255, 0.15), rgba(88, 66, 244, 0.15))', transform: 'translate(-50%, -50%) rotate(-45deg)', filter: 'blur(12px)', animationDelay: '1s' }}></div>
      <div className="fixed z-0 pointer-events-none animate-lane-glow" style={{ bottom: '10%', right: '5%', width: '40%', height: '3px', background: 'linear-gradient(270deg, rgba(0, 255, 213, 0.2), transparent)', transform: 'rotate(25deg)', transformOrigin: 'right center', filter: 'blur(8px)', animationDelay: '2s' }}></div>

      {/* Objective glows */}
      <div className="fixed z-0 pointer-events-none animate-energy-pulse" style={{ bottom: '25%', right: '30%', width: '120px', height: '120px', background: 'radial-gradient(circle, rgba(239, 68, 68, 0.15) 0%, transparent 70%)', borderRadius: '50%', filter: 'blur(20px)' }}></div>
      <div className="fixed z-0 pointer-events-none animate-energy-pulse" style={{ top: '20%', left: '25%', width: '100px', height: '100px', background: 'radial-gradient(circle, rgba(168, 85, 247, 0.12) 0%, transparent 70%)', borderRadius: '50%', filter: 'blur(20px)', animationDelay: '1.5s' }}></div>

      {/* Hextech scan line */}
      <div className="fixed z-0 pointer-events-none animate-hextech-scan" style={{ left: 0, right: 0, height: '1px', background: 'linear-gradient(90deg, transparent, rgba(0, 209, 255, 0.3), transparent)' }}></div>

      {/* Grid overlay */}
      <div className="fixed inset-0 z-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: "radial-gradient(#5842F4 1px, transparent 1px)", backgroundSize: "60px 60px" }}></div>

      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-white/5 bg-[#05050f]/90 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5 group cursor-pointer" onClick={() => router.push('/')}>
            <div className="w-10 h-10 flex items-center justify-center transition-transform group-hover:scale-105">
              <img src="/logo.png" alt="NexusInsight" className="w-full h-full object-contain" />
            </div>
            <h2 className="text-xl font-bold tracking-tight uppercase">
              <span className="text-white/90">NEXUS</span>
              <span className="text-[#00D1FF]">INSIGHT</span>
            </h2>
          </div>
        </div>
      </header>

      <div className="relative z-10 flex flex-col items-center px-6 py-8">

        {/* Hero Section - Two Column Layout */}
        <div className="w-full max-w-6xl mx-auto mb-8">

          {/* Top Row: Hero Text (Left) + Electric Map (Right) */}
          <div className="flex flex-col lg:flex-row gap-8 lg:gap-16 items-center justify-center mb-10">

            {/* Left: Text Content */}
            <div className="flex flex-col justify-center">
              {/* Subtle label */}
              <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-slate-500 mb-3">
                <span>Performance Analytics</span>
                <div className="w-6 h-px bg-gradient-to-l from-transparent to-[#00D1FF]/50"></div>
              </div>

              {/* Main Title */}
              <h1 className="text-3xl md:text-4xl lg:text-5xl font-black tracking-tight mb-3 leading-[1.1]">
                <span className="text-white/90">Find your </span>
                <span className="relative inline-block">
                  <span className="text-[#00D1FF] relative z-10">EDGE</span>
                  <span className="absolute -left-2.5 top-1/2 -translate-y-1/2 text-[#00D1FF]/30 text-2xl font-light">[</span>
                  <span className="absolute -right-2.5 top-1/2 -translate-y-1/2 text-[#00D1FF]/30 text-2xl font-light">]</span>
                </span>
              </h1>

              <p className="text-slate-400 text-sm lg:text-base max-w-sm leading-relaxed">
                Deep match analysis powered by data. See exactly where you stand against the competition.
              </p>
            </div>

            {/* Right: Electric Map */}
            <div className="w-full lg:w-[320px] shrink-0">
              <div className="relative w-full aspect-square rounded-lg overflow-hidden border border-white/[0.06]">
                {/* Frame corners */}
                <div className="absolute top-0 left-0 w-6 h-6 border-l-2 border-t-2 border-[#00D1FF]/40 z-10"></div>
                <div className="absolute top-0 right-0 w-6 h-6 border-r-2 border-t-2 border-[#00D1FF]/40 z-10"></div>
                <div className="absolute bottom-0 left-0 w-6 h-6 border-l-2 border-b-2 border-[#5842F4]/40 z-10"></div>
                <div className="absolute bottom-0 right-0 w-6 h-6 border-r-2 border-b-2 border-[#5842F4]/40 z-10"></div>

                {/* Map container - no clip-path, full display */}
                <div className="w-full h-full">
                  <ElectricMap />
                </div>

                {/* Label */}
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[9px] uppercase tracking-[0.3em] text-slate-600 bg-[#05050f]/80 px-2 py-0.5 rounded">
                  Summoner&apos;s Rift
                </div>
              </div>
            </div>
          </div>

          {/* Centered Search Bar */}
          <div className="w-full max-w-2xl mx-auto mb-4">
            <SearchBar
              onSearch={handleSearch}
              initialRiotId={riotId}
              initialRegion={region}
            />
          </div>

          {/* Quick Links */}
          <div className="flex items-center justify-center gap-3 text-xs">
            <span className="text-slate-600 uppercase tracking-wider">Try:</span>
            <button onClick={() => { setRiotId("Zeniv#heart"); setRegion("euw"); }} className="text-slate-500 hover:text-[#00D1FF] transition-colors font-medium">Zeniv#heart</button>
            <span className="text-slate-700">•</span>
            <button onClick={() => { setRiotId("Sasaki#sit"); setRegion("euw"); }} className="text-slate-500 hover:text-[#00D1FF] transition-colors font-medium">Sasaki#sit</button>
            <span className="text-slate-700">•</span>
            <button onClick={() => { setRiotId("momo#owo7"); setRegion("euw"); }} className="text-slate-500 hover:text-[#00D1FF] transition-colors font-medium">momo#owo7</button>
          </div>
        </div>

        {/* Stat Categories */}
        <div className="w-full max-w-6xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              { title: "Combat", icon: Trophy, accent: "#ef4444", stat: "KDA & Damage", desc: "Kill pressure, fight timing, and lethality patterns" },
              { title: "Economy", icon: Target, accent: "#00ffd5", stat: "Gold & CS", desc: "Income efficiency and itemization tempo" },
              { title: "Vision", icon: Eye, accent: "#5842F4", stat: "Ward Score", desc: "Map control, denial, and prediction accuracy" },
              { title: "Objectives", icon: Zap, accent: "#00D1FF", stat: "Obj. Control", desc: "Dragon soul priority and tower pressure" },
              { title: "Teamplay", icon: Activity, accent: "#22c55e", stat: "Synergy", desc: "Roaming impact and team coordination" }
            ].map((item, i) => (
              <div
                key={i}
                className="group relative overflow-hidden transition-all duration-300"
              >
                {/* Card background with angular clip */}
                <div
                  className="relative p-5 bg-[#0d0d15] border border-white/[0.04] transition-all duration-300 group-hover:border-white/[0.08]"
                  style={{ clipPath: "polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px))" }}
                >
                  {/* Top corner accent */}
                  <div
                    className="absolute top-0 right-0 w-3 h-3 transition-all duration-300 group-hover:scale-150 group-hover:opacity-80"
                    style={{
                      background: `linear-gradient(135deg, ${item.accent}40 0%, transparent 50%)`,
                    }}
                  ></div>

                  {/* Bottom corner accent */}
                  <div
                    className="absolute bottom-0 left-0 w-3 h-3 transition-all duration-300"
                    style={{
                      background: `linear-gradient(-45deg, ${item.accent}20 0%, transparent 50%)`,
                    }}
                  ></div>

                  {/* Hover glow line at top */}
                  <div
                    className="absolute top-0 left-0 right-3 h-px opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                    style={{ background: `linear-gradient(90deg, ${item.accent}00, ${item.accent}60, ${item.accent}00)` }}
                  ></div>

                  {/* Icon with hex-inspired background */}
                  <div className="relative mb-4">
                    <div
                      className="w-10 h-10 flex items-center justify-center transition-all duration-300 group-hover:scale-105"
                      style={{
                        background: `linear-gradient(135deg, ${item.accent}15 0%, transparent 60%)`,
                        clipPath: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)"
                      }}
                    >
                      <item.icon className="w-5 h-5 transition-colors duration-300" style={{ color: item.accent }} />
                    </div>
                  </div>

                  {/* Title */}
                  <h4 className="font-bold text-sm text-white/90 uppercase tracking-wide mb-1">{item.title}</h4>

                  {/* Stat tag */}
                  <div
                    className="inline-block text-[9px] font-semibold uppercase tracking-wider px-2 py-0.5 mb-3 transition-colors duration-300"
                    style={{
                      color: item.accent,
                      background: `${item.accent}15`,
                    }}
                  >
                    {item.stat}
                  </div>

                  {/* Description */}
                  <p className="text-xs text-slate-500 leading-relaxed">{item.desc}</p>

                  {/* Scanline effect on hover */}
                  <div
                    className="absolute inset-0 opacity-0 group-hover:opacity-[0.03] pointer-events-none transition-opacity duration-300"
                    style={{
                      backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, white 2px, white 3px)",
                    }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

    </main>
  );
}
