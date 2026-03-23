/**
 * @file client/src/pages/DigestView.tsx
 * @author Paul Fleury <hello@paulfleury.com>
 * @version 0.5.0
 *
 * Espresso — Public Digest Reader
 *
 * UX MODEL:
 *   Full-screen card reader — one story per screen.
 *   Navigation: keyboard arrows ← → (useEffect + keydown listener),
 *   left/right click buttons, and touch swipe on mobile (50px threshold).
 *
 * MOBILE-FIRST TYPOGRAPHY (v0.5.0):
 *   Previous version used text-xl/text-2xl which renders small on mobile.
 *   New scale: headlines at text-3xl (mobile) → text-4xl (desktop),
 *   body at text-lg (mobile) — readable without zooming.
 *   Everything is designed for a phone screen first.
 *
 * LAYOUT:
 *   - Sticky header: logo + progress dots + controls
 *   - Card area: fills viewport between header and nav bar
 *   - Sticky nav bar: prev / counter / next
 *   - Final card: closing quote (inverted colour, editorial)
 */

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState, useRef, useEffect, useCallback } from "react";
import {
  Sun, Moon, ArrowUpRight, ChevronLeft, ChevronRight, LayoutGrid, X
} from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import type { DigestStory } from "@shared/schema";

interface DigestResponse {
  id: number;
  date: string;
  status: string;
  stories: DigestStory[];
  closingQuote: string;
  closingQuoteAuthor: string;
}

function formatDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function DigestView() {
  const { theme, toggle } = useTheme();
  const [cardIndex, setCardIndex] = useState(0);
  const [showGrid, setShowGrid] = useState(false);

  const { data: digest, isLoading } = useQuery<DigestResponse | null>({
    queryKey: ["/api/digest/latest"],
    queryFn: async () => {
      const r = await apiRequest("GET", "/api/digest/latest");
      if (!r.ok) return null;
      return r.json();
    },
    retry: false,
  });

  const totalCards = digest ? digest.stories.length + 1 : 0;
  const isQuoteCard = digest ? cardIndex === digest.stories.length : false;

  const goNext = useCallback(() => {
    setCardIndex(i => Math.min(i + 1, totalCards - 1));
  }, [totalCards]);

  const goPrev = useCallback(() => {
    setCardIndex(i => Math.max(i - 1, 0));
  }, []);

  // ── Keyboard navigation ────────────────────────────────────────────────────
  useEffect(() => {
    if (!digest) return;
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when user is typing in an input
      if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); goNext(); }
      if (e.key === "ArrowLeft"  || e.key === "ArrowUp")   { e.preventDefault(); goPrev(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [digest, goNext, goPrev]);

  // ── Touch swipe ────────────────────────────────────────────────────────────
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.targetTouches[0].clientX;
    touchStartY.current = e.targetTouches[0].clientY;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = touchStartX.current - e.changedTouches[0].clientX;
    const dy = touchStartY.current - e.changedTouches[0].clientY;
    // Only trigger if horizontal movement dominates (not a scroll)
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
      dx > 0 ? goNext() : goPrev();
    }
    touchStartX.current = null;
    touchStartY.current = null;
  };

  if (isLoading) return <LoadingView />;
  if (!digest)   return <EmptyView />;

  const story = isQuoteCard ? null : digest.stories[cardIndex];

  return (
    <div
      className="min-h-screen bg-background text-foreground flex flex-col select-none"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Economist signature red rule */}
      <div className="h-1.5 w-full bg-[#E3120B] flex-shrink-0" />

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 border-b border-border bg-background z-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          {/* Logo — tapping resets to card 0 */}
          <button
            onClick={() => { setCardIndex(0); setShowGrid(false); }}
            className="flex items-center gap-2 flex-shrink-0 hover:opacity-75 transition-opacity"
            aria-label="First story"
          >
            <div className="w-8 h-8 bg-[#E3120B] flex items-center justify-center flex-shrink-0">
              <span className="text-white font-black text-sm font-display tracking-tight">E</span>
            </div>
          </button>

          {/* Progress dots — centred, fills remaining space */}
          <div className="flex-1 flex items-center justify-center gap-1.5 overflow-hidden px-2">
            {digest.stories.map((_, i) => (
              <button
                key={i}
                onClick={() => setCardIndex(i)}
                aria-label={`Story ${i + 1}`}
                className={`rounded-full transition-all duration-200 flex-shrink-0 ${
                  i === cardIndex
                    ? "w-5 h-1.5 bg-[#E3120B]"
                    : i < cardIndex
                    ? "w-1.5 h-1.5 bg-foreground/30"
                    : "w-1.5 h-1.5 bg-border"
                }`}
              />
            ))}
            {/* Quote dot */}
            <button
              onClick={() => setCardIndex(digest.stories.length)}
              aria-label="Closing quote"
              className={`rounded-full transition-all duration-200 flex-shrink-0 ${
                isQuoteCard ? "w-5 h-1.5 bg-[#E3120B]" : "w-1.5 h-1.5 bg-border"
              }`}
            />
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => setShowGrid(v => !v)}
              className="w-9 h-9 flex items-center justify-center hover:bg-accent rounded transition-colors"
              aria-label="Overview grid"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              onClick={toggle}
              className="w-9 h-9 flex items-center justify-center hover:bg-accent rounded transition-colors"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <a
              href="/#/admin"
              className="hidden sm:flex w-9 h-9 items-center justify-center text-xs text-muted-foreground hover:text-[#E3120B] transition-colors font-ui"
              aria-label="Admin"
            >
              ⚙
            </a>
          </div>
        </div>
      </header>

      {/* ── Grid overlay ────────────────────────────────────────────────────── */}
      {showGrid && (
        <GridOverlay
          digest={digest}
          activeIndex={cardIndex}
          onSelect={i => { setCardIndex(i); setShowGrid(false); }}
          onClose={() => setShowGrid(false)}
        />
      )}

      {/* ── Card area ───────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {isQuoteCard
          ? <QuoteCard quote={digest.closingQuote} author={digest.closingQuoteAuthor} date={digest.date} />
          : story
          ? <StoryCard story={story} index={cardIndex} total={digest.stories.length} />
          : null
        }
      </div>

      {/* ── Navigation bar ──────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-t border-border bg-background z-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">

          <button
            onClick={goPrev}
            disabled={cardIndex === 0}
            className="flex items-center gap-2 text-sm font-bold font-ui text-muted-foreground
                       hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed
                       transition-colors py-3 pr-6"
            data-testid="prev-story"
            aria-label="Previous story"
          >
            <ChevronLeft size={20} />
            <span className="hidden sm:block">Prev</span>
          </button>

          {/* Counter */}
          <span className="text-sm text-muted-foreground font-ui tabular-nums font-medium">
            {isQuoteCard
              ? <span className="text-[#E3120B]">✦</span>
              : `${cardIndex + 1} / ${digest.stories.length}`
            }
          </span>

          <button
            onClick={goNext}
            disabled={cardIndex === totalCards - 1}
            className="flex items-center gap-2 text-sm font-bold font-ui text-muted-foreground
                       hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed
                       transition-colors py-3 pl-6"
            data-testid="next-story"
            aria-label="Next story"
          >
            <span className="hidden sm:block">Next</span>
            <ChevronRight size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Story Card ───────────────────────────────────────────────────────────────
// Mobile-first: big type, generous padding, image above the fold

function StoryCard({ story, index, total }: { story: DigestStory; index: number; total: number }) {
  return (
    <article className="max-w-2xl lg:max-w-3xl mx-auto w-full px-5 sm:px-8 lg:px-12 py-7 sm:py-10 lg:py-14">

      {/* Hero image */}
      {story.imageUrl && (
        <div className="w-full aspect-video bg-muted border border-border/50 overflow-hidden mb-6">
          <img
            src={story.imageUrl}
            alt={story.title}
            className="w-full h-full object-cover"
            onError={e => {
              (e.target as HTMLImageElement).parentElement!.style.display = "none";
            }}
          />
        </div>
      )}

      {/* Category + number */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-xs font-black font-ui text-[#E3120B] uppercase tracking-[0.18em]">
          {story.category}
        </span>
        <span className="text-xs text-muted-foreground font-ui tabular-nums">
          {index + 1} of {total}
        </span>
      </div>

      {/* Headline — large and bold, mobile-first */}
      <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black font-display leading-[1.15] tracking-tight mb-5">
        {story.title}
      </h1>

      {/* Red accent line */}
      <div className="w-10 h-0.5 bg-[#E3120B] mb-6" />

      {/* Summary — editorial serif, comfortable reading size on mobile */}
      <p className="text-lg sm:text-xl lg:text-2xl font-editorial leading-[2.0] text-foreground/85">
        {story.summary}
      </p>

      {/* Source link */}
      <a
        href={story.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 mt-8 text-sm font-bold font-ui
                   text-[#E3120B] hover:underline underline-offset-2"
        data-testid="read-source-link"
      >
        Read full story <ArrowUpRight size={14} />
      </a>

    </article>
  );
}

// ─── Quote Card ───────────────────────────────────────────────────────────────

function QuoteCard({ quote, author, date }: { quote: string; author: string; date: string }) {
  return (
    <div className="min-h-full flex items-center justify-center bg-foreground text-background px-6 py-16">
      <div className="max-w-2xl w-full text-center space-y-10">
        <p className="text-xs uppercase tracking-[0.22em] opacity-40 font-ui">
          {formatDate(date)} · Today’s Thought
        </p>
        <div className="w-10 h-0.5 bg-[#E3120B] mx-auto" />
        <blockquote className="text-3xl sm:text-4xl lg:text-5xl font-editorial italic leading-[1.6] font-medium">
          “{quote}”
        </blockquote>
        {author && (
          <p className="text-lg sm:text-xl opacity-55 font-ui">{author}</p>
        )}
      </div>
    </div>
  );
}

// ─── Grid Overlay ─────────────────────────────────────────────────────────────

function GridOverlay({
  digest,
  activeIndex,
  onSelect,
  onClose,
}: {
  digest: DigestResponse;
  activeIndex: number;
  onSelect: (i: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-background/97 backdrop-blur-sm overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="font-black text-lg font-display uppercase tracking-wide">All Stories</h2>
            <p className="text-sm text-muted-foreground font-ui mt-0.5">{formatDate(digest.date)}</p>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center hover:bg-accent rounded transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border">
          {digest.stories.map((story, i) => (
            <button
              key={story.id}
              onClick={() => onSelect(i)}
              className={`text-left p-5 transition-colors ${
                i === activeIndex
                  ? "bg-[#E3120B] text-white"
                  : "bg-card hover:bg-accent/50"
              }`}
            >
              {story.imageUrl && (
                <div className="aspect-video bg-muted mb-3 overflow-hidden">
                  <img
                    src={story.imageUrl}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={e => { (e.target as HTMLImageElement).parentElement!.style.display = "none"; }}
                  />
                </div>
              )}
              <p className={`text-[10px] font-black uppercase tracking-wider font-ui mb-2 ${
                i === activeIndex ? "text-white/70" : "text-[#E3120B]"
              }`}>
                {story.category}
              </p>
              <h3 className="text-sm font-bold font-display leading-[1.4] line-clamp-3">
                {story.title}
              </h3>
            </button>
          ))}
        </div>

        {/* Quote card shortcut */}
        <button
          onClick={() => onSelect(digest.stories.length)}
          className="mt-px w-full bg-card hover:bg-accent/50 transition-colors p-5 text-center border-t border-border"
        >
          <p className="text-xs text-muted-foreground font-ui">✦ Closing Thought</p>
          {digest.closingQuote && (
            <p className="text-sm font-editorial italic mt-1 text-muted-foreground line-clamp-2">
              "{digest.closingQuote}"
            </p>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Loading / Empty ──────────────────────────────────────────────────────────

function LoadingView() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="h-1.5 w-full bg-[#E3120B]" />
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-10 h-10 bg-[#E3120B] mx-auto animate-pulse" />
          <p className="text-base text-muted-foreground font-ui">Loading your briefing…</p>
        </div>
      </div>
    </div>
  );
}

function EmptyView() {
  const { toggle, theme } = useTheme();
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="h-1.5 w-full bg-[#E3120B]" />
      <header className="border-b border-border">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-[#E3120B] flex items-center justify-center">
              <span className="text-white font-black text-sm font-display">E</span>
            </div>

          </div>
          <button onClick={toggle} className="w-9 h-9 flex items-center justify-center hover:bg-accent rounded transition-colors">
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </header>
      <div className="flex-1 flex items-center justify-center px-6 text-center">
        <div className="max-w-sm space-y-5">
          <div className="w-14 h-14 bg-[#E3120B] mx-auto flex items-center justify-center">
            <span className="text-white font-black text-2xl font-display">E</span>
          </div>
          <h2 className="text-2xl font-black font-display">No digest yet</h2>
          <p className="text-base text-muted-foreground font-editorial leading-[1.9]">
            Submit links, generate a digest, and publish it to start reading.
          </p>
          <a
            href="/#/admin"
            className="inline-flex items-center gap-2 text-sm font-bold bg-[#E3120B] text-white
                       px-6 py-3 hover:bg-[#B50D08] transition-colors font-ui"
          >
            Go to Admin <ArrowUpRight size={14} />
          </a>
        </div>
      </div>
    </div>
  );
}
