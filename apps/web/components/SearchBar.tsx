"use client";

import { useState, useRef, useEffect } from "react";
import { Search, ChevronDown, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const REGIONS = [
    { id: "euw", label: "EUW", name: "Europe West" },
    { id: "eune", label: "EUNE", name: "Europe Nordic & East" },
    { id: "na", label: "NA", name: "North America" },
    { id: "kr", label: "KR", name: "Korea" },
    { id: "br", label: "BR", name: "Brazil" },
    { id: "lan", label: "LAN", name: "Latin America North" },
    { id: "las", label: "LAS", name: "Latin America South" },
    { id: "oce", label: "OCE", name: "Oceania" },
    { id: "tr", label: "TR", name: "Turkey" },
    { id: "ru", label: "RU", name: "Russia" },
    { id: "jp", label: "JP", name: "Japan" },
] as const;

interface SearchBarProps {
    onSearch: (riotId: string, region: string) => Promise<void> | void;
    initialRiotId?: string;
    initialRegion?: string;
    className?: string;
}

export function SearchBar({
    onSearch,
    initialRiotId = "",
    initialRegion = "euw",
    className
}: SearchBarProps) {
    const [riotId, setRiotId] = useState(initialRiotId);
    const [region, setRegion] = useState(initialRegion);
    const [loading, setLoading] = useState(false);
    const [isRegionOpen, setIsRegionOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (initialRiotId) setRiotId(initialRiotId);
        if (initialRegion) setRegion(initialRegion);
    }, [initialRiotId, initialRegion]);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsRegionOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!riotId.trim()) return;

        setLoading(true);
        try {
            await onSearch(riotId, region);
        } finally {
            setLoading(false);
        }
    };

    const selectedRegion = REGIONS.find(r => r.id === region) || REGIONS[0];

    return (
        <div className={cn("w-full relative z-20", className)}>
            <form
                onSubmit={handleSubmit}
                className="relative flex items-center"
            >
                {/* Main search container wrapper */}
                <div className="flex-1 relative group">
                    {/* Background with angular clip - absolute positioned */}
                    <div
                        className="absolute inset-0 bg-[#08060a]/85 border border-[#C8A84B]/20 backdrop-blur-sm transition-all duration-300 group-hover:border-[#C8A84B]/40 group-focus-within:border-[#C8A84B]/60 group-focus-within:shadow-[0_0_25px_-5px_rgba(200,168,75,0.25)]"
                        style={{ clipPath: "polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px))" }}
                    ></div>

                    {/* Content container - no clip path, allows dropdown overflow */}
                    <div className="relative flex items-center px-4 h-14 z-10">
                        {/* Search Icon */}
                        <Search className="w-5 h-5 text-[#C8A84B]/60 mr-3 flex-shrink-0" />

                        {/* Input */}
                        <input
                            type="text"
                            value={riotId}
                            onChange={(e) => setRiotId(e.target.value)}
                            placeholder="Summoner#TAG"
                            className="flex-1 bg-transparent border-none outline-none text-white text-base font-medium placeholder:text-slate-600 min-w-0"
                        />

                        {/* Divider */}
                        <div className="w-px h-6 bg-[#C8A84B]/20 mx-3 flex-shrink-0"></div>

                        {/* Region Selector */}
                        <div className="relative flex-shrink-0" ref={dropdownRef}>
                            <button
                                type="button"
                                onClick={() => setIsRegionOpen(!isRegionOpen)}
                                className="flex items-center gap-1.5 px-2 py-1.5 text-slate-400 hover:text-[#C8A84B] transition-colors font-semibold text-sm uppercase tracking-wide"
                            >
                                <span>{selectedRegion.label}</span>
                                <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-200", isRegionOpen ? "rotate-180" : "")} />
                            </button>

                            {/* Dropdown Menu */}
                            {isRegionOpen && (
                                <div
                                    className="absolute right-0 top-full mt-2 w-56 bg-[#08060a] border border-[#C8A84B]/20 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.9)] py-1 z-[100]"
                                    style={{ clipPath: "polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px))" }}
                                >
                                    <div className="max-h-64 overflow-y-auto custom-scrollbar">
                                        {REGIONS.map((r) => (
                                            <button
                                                key={r.id}
                                                type="button"
                                                onClick={() => {
                                                    setRegion(r.id);
                                                    setIsRegionOpen(false);
                                                }}
                                                className="w-full text-left px-3 py-2 hover:bg-[#C8A84B]/10 flex items-center justify-between group/item transition-all"
                                            >
                                                <div className="flex flex-col">
                                                    <span className={cn("font-semibold text-sm transition-colors", region === r.id ? "text-[#C8A84B]" : "text-slate-400 group-hover/item:text-white")}>
                                                        {r.label}
                                                    </span>
                                                    <span className="text-[10px] text-slate-600 uppercase tracking-wider">
                                                        {r.name}
                                                    </span>
                                                </div>
                                                {region === r.id && <Check className="w-3.5 h-3.5 text-[#C8A84B]" />}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Analyze Button - Separated with angular design */}
                <button
                    type="submit"
                    disabled={loading || !riotId.trim()}
                    className="ml-2 bg-[#C8A84B] text-[#030308] hover:bg-[#FFD870] hover:shadow-[0_0_30px_-6px_rgba(200,168,75,0.8)] disabled:opacity-30 disabled:cursor-not-allowed px-6 h-14 font-black text-sm uppercase tracking-[0.15em] transition-all duration-300 flex items-center gap-2 active:scale-[0.97]"
                    style={{ clipPath: "polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)" }}
                >
                    {loading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                        <>
                            <Search className="w-4 h-4" />
                            <span className="hidden sm:inline">Analyze</span>
                        </>
                    )}
                </button>
            </form>
        </div>
    );
}
