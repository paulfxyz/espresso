/**
 * @file client/src/components/EditionSelector.tsx
 * @author Paul Fleury <hello@paulfleury.com>
 * @version 2.0.0
 *
 * Cup of News — Edition Selector Dropdown
 *
 * Displays the current edition as a flag in the header.
 * Clicking opens a dropdown listing all 8 editions grouped by language.
 * Selection is persisted in localStorage under key "cup_edition".
 *
 * Design decisions:
 *   - The dropdown opens upward on mobile (where the header is near the bottom
 *     of the nav bar) and downward on desktop — handled via CSS positioning.
 *   - Clicking outside closes the dropdown (useEffect + mousedown listener).
 *   - The flag emoji is universally supported on modern iOS/Android/desktop.
 *   - Language grouping (English / Français / Deutsch) makes the picker
 *     scannable at a glance without requiring the user to read all 8 names.
 */

import { useState, useRef, useEffect } from "react";
import { EDITIONS } from "@shared/editions";
import type { Edition } from "@shared/editions";
import { ChevronDown } from "lucide-react";

interface Props {
  current: Edition;
  onChange: (edition: Edition) => void;
}

// Group editions by language for the dropdown
const LANGUAGE_GROUPS = [
  { lang: "en", label: "English", editions: EDITIONS.filter(e => e.language === "en") },
  { lang: "fr", label: "Français", editions: EDITIONS.filter(e => e.language === "fr") },
  { lang: "de", label: "Deutsch", editions: EDITIONS.filter(e => e.language === "de") },
];

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

          {/* Language groups */}
          {LANGUAGE_GROUPS.map(group => (
            <div key={group.lang}>
              {/* Language header */}
              <div className="px-4 py-1.5 border-b border-border/50">
                <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground font-ui">
                  {group.label}
                </p>
              </div>

              {/* Edition rows */}
              {group.editions.map(edition => (
                <button
                  key={edition.id}
                  onClick={() => { onChange(edition); setOpen(false); }}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent/60 ${
                    edition.id === current.id
                      ? "bg-[#E3120B]/10 border-l-2 border-[#E3120B]"
                      : "border-l-2 border-transparent"
                  }`}
                >
                  <span className="text-lg leading-none flex-shrink-0">{edition.flag}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-bold font-display leading-tight ${
                      edition.id === current.id ? "text-[#E3120B]" : ""
                    }`}>
                      {edition.name}
                    </p>
                    <p className="text-[10px] text-muted-foreground font-ui mt-0.5 truncate">
                      {edition.description.split("—")[1]?.trim() ?? edition.description}
                    </p>
                  </div>
                  {edition.id === current.id && (
                    <span className="text-[#E3120B] text-xs flex-shrink-0">✦</span>
                  )}
                </button>
              ))}
            </div>
          ))}

          {/* Footer */}
          <div className="px-4 py-2 border-t border-border bg-muted/20">
            <p className="text-[9px] text-muted-foreground font-ui">
              Each edition generates independently in the local language
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Hook: persist edition in localStorage ────────────────────────────────────

const STORAGE_KEY = "cup_edition";

export function useEdition() {
  const getSaved = (): Edition => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const found = EDITIONS.find(e => e.id === saved);
        if (found) return found;
      }
    } catch {}
    return EDITIONS[0]; // Default: en-WORLD
  };

  const [edition, setEditionState] = useState<Edition>(getSaved);

  const setEdition = (e: Edition) => {
    setEditionState(e);
    try { localStorage.setItem(STORAGE_KEY, e.id); } catch {}
  };

  return { edition, setEdition };
}
