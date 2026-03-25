/**
 * @file client/src/components/EditionSelector.tsx
 * @author Paul Fleury <hello@paulfleury.com>
 * @version 3.2.9
 *
 * Cup of News — Edition Selector Dropdown
 *
 * Displays the current edition as a flag in the header.
 * Clicking opens a dropdown listing all 9 language editions.
 * Selection is persisted in localStorage under key "cup_edition_v3".
 *
 * v3.1.0: Turkish (🇹🇷) and Italian (🇮🇹) editions added — 9 total.
 *
 * Design decisions:
 *   - The dropdown opens downward, right-aligned to the trigger button.
 *   - Clicking outside closes the dropdown (useEffect + mousedown listener).
 *   - The flag emoji is universally supported on modern iOS/Android/desktop.
 *   - Flat list (no grouping) — 9 editions remain scannable in a single column.
 */

import { useState, useRef, useEffect } from "react";
import { EDITIONS } from "@shared/editions";
import type { Edition } from "@shared/editions";
import { ChevronDown } from "lucide-react";

interface Props {
  current: Edition;
  onChange: (edition: Edition) => void;
}

// 9 editions — flat list (no grouping needed)

export function EditionSelector({ current, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <div ref={ref} className="relative flex-shrink-0">
      {/* Trigger button */}
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-accent rounded transition-colors text-sm font-bold font-ui"
        aria-label="Select edition"
        aria-expanded={open}
      >
        <span className="text-base leading-none">{current.flag}</span>
        <span className="hidden sm:block text-xs text-muted-foreground">{current.name}</span>
        <ChevronDown
          size={12}
          className={`text-muted-foreground transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 bg-card border border-border shadow-2xl w-64 overflow-hidden"
          style={{ boxShadow: "0 8px 40px rgba(0,0,0,0.4)" }}
        >
          {/* Header */}
          <div className="px-4 py-2.5 border-b border-border bg-muted/40">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#E3120B] font-ui">
              Edition
            </p>
          </div>

          {/* 9 editions — flat list */}
          {EDITIONS.map(edition => (
            <button
              key={edition.id}
              onClick={() => { onChange(edition); setOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/60 ${
                edition.id === current.id
                  ? "bg-[#E3120B]/10 border-l-2 border-[#E3120B]"
                  : "border-l-2 border-transparent"
              }`}
            >
              <span className="text-2xl leading-none flex-shrink-0">{edition.flag}</span>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-bold font-display leading-tight ${
                  edition.id === current.id ? "text-[#E3120B]" : ""
                }`}>
                  {edition.name}
                </p>
                <p className="text-[11px] text-muted-foreground font-ui mt-0.5">
                  {edition.description}
                </p>
              </div>
              {edition.id === current.id && (
                <span className="text-[#E3120B] font-bold flex-shrink-0">✦</span>
              )}
            </button>
          ))}

          {/* Footer */}
          <div className="px-4 py-2 border-t border-border bg-muted/20">
            <p className="text-[9px] text-muted-foreground font-ui">
              9 languages · each edition generates independently
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Hook: persist edition in localStorage ────────────────────────────────────

const STORAGE_KEY = "cup_edition_v3"; // v3.0.0+: supports 9 editions (en/fr/de/es/pt/zh/ru/tr/it)

export function useEdition() {
  // ── Language handoff from landing page (v3.2.5) ──────────────────────────
  // The cupof.news landing page appends ?lang=fr (etc.) when navigating here.
  // On first mount we read that param, write it to localStorage, then clean
  // the URL so it doesn't persist across refreshes or get bookmarked.
  //
  // Priority order:
  //   1. ?lang= URL param (from landing page navigation) — highest priority
  //   2. localStorage cup_edition_v3 (user's previous app session)
  //   3. Default: English
  const getSaved = (): Edition => {
    try {
      // Check ?lang= param first (landing → app handoff)
      const urlParams = new URLSearchParams(window.location.search);
      const langParam = urlParams.get("lang");
      if (langParam) {
        const found = EDITIONS.find(e => e.id === langParam);
        if (found) {
          // Persist it and clean the URL param
          try { localStorage.setItem(STORAGE_KEY, found.id); } catch {}
          // Remove ?lang= from URL without triggering a reload
          const cleanUrl = window.location.pathname + window.location.hash;
          window.history.replaceState(null, "", cleanUrl);
          return found;
        }
      }
      // Fall back to persisted edition
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const found = EDITIONS.find(e => e.id === saved);
        if (found) return found;
      }
    } catch {}
    return EDITIONS[0]; // Default: en
  };

  const [edition, setEditionState] = useState<Edition>(getSaved);

  const setEdition = (e: Edition) => {
    setEditionState(e);
    try { localStorage.setItem(STORAGE_KEY, e.id); } catch {}
  };

  return { edition, setEdition };
}
