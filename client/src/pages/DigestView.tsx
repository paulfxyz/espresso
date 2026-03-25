/**
 * @file client/src/pages/DigestView.tsx
 * @author Paul Fleury <hello@paulfleury.com>
 * @version 3.2.3
 *
 * Cup of News — Public Digest Reader
 *
 * UX MODEL:
 *   Full-screen card reader — one story per screen.
 *   Navigation: keyboard arrows ← → (useEffect + keydown listener),
 *   left/right click buttons, and touch swipe on mobile (50px threshold).
 *
 * TYPOGRAPHY — RESPONSIVE LINE-HEIGHT (v2.0.1):
 *   The great line-height saga:
 *
 *   v0.5.0: leading-tight — too cramped, body text unreadable
 *   v1.1.0: leading-[2.4] — better but still tight for Libre Baskerville
 *   v1.5.0: leading-[2.6] + word-spacing + letter-spacing — good on desktop, excess on mobile
 *   v1.6.0: leading-[3.0] — THE MISTAKE. 300% line-height.
 *     On mobile (text-lg = 18px): 54px line gaps. Looks like double-spaced 1990s document.
 *     On desktop (text-2xl = 24px): 72px gaps. Also too much.
 *     Reason it was set this high: each iteration was judged on desktop;
 *     mobile view was never checked at the same time.
 *
 *   v2.0.2 CALIBRATION — "Air without excess":
 *     The goal: match the line density of quality editorial apps (NYT, FT, The Economist).
 *     Not so tight it feels cramped. Not so loose it feels like a Word doc with 2.0 spacing.
 *
 *     FONT SIZE:
 *       Mobile:  15px (text-[15px]) — Libre Baskerville has generous x-height;
 *                14px is too small, 16px+ requires too much scroll on 375px screens.
 *       Tablet:  17px (text-[17px]) — comfortable mid-range
 *       Desktop: 19px (text-[19px]) — full editorial presence on wide screens
 *
 *     LINE HEIGHT:
 *       Mobile:  1.85 — matches NYT/FT mobile rhythm. Enough air to read without
 *                eye-tracking loss, not so much that it feels double-spaced.
 *       Tablet:  2.0  — a half-step more air at larger font sizes
 *       Desktop: 2.15 — the editorial sweet spot. Wider columns need more leading
 *                to guide the eye back to the line start, but 2.6 (our old value)
 *                was too loose — the gaps became the dominant visual element.
 *
 *     WORD/LETTER SPACING:
 *       Removed entirely. At Libre Baskerville's natural spacing these additions
 *       made text feel artificially expanded rather than typographically refined.
 *       The font's built-in metrics are already well-spaced for body text.
 *
 *   HEADLINE LEADING (StoryCard h1):
 *     leading-[1.15] across all sizes — tight for headlines is correct.
 *     At 3xl-5xl, generous line-height on headlines wastes visual real estate.
 *
 *   MOBILE-FIRST SCALE:
 *   Headlines: text-3xl (mobile) → text-4xl (sm) → text-5xl (lg).
 *   Body: text-[15px] → text-[17px] sm → text-[19px] lg.
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
  Sun, Moon, ArrowUpRight, ChevronLeft, ChevronRight, LayoutGrid, X, Rss, RefreshCw, Loader2
} from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import { EditionSelector, useEdition } from "@/components/EditionSelector";
import type { DigestStory } from "@shared/schema";

interface DigestResponse {
  id: number;
  date: string;
  status: string;
  edition: string;
  stories: DigestStory[];
  closingQuote: string;
  closingQuoteAuthor: string;
  /** v2.0.3: true when the server returned a fallback edition (requested edition has no digest) */
  isFallback?: boolean;
  /** v2.0.3: the edition the user requested, when isFallback is true */
  requestedEdition?: string;
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
  const { edition, setEdition } = useEdition();

  // ── Card slide animation (v3.2.2) ─────────────────────────────────────────
  // On every card navigation (next/prev/keyboard/swipe/dot/grid), we:
  //   1. Set slideDir to "left" or "right" (determines animation direction)
  //   2. Bump a slideKey so React re-mounts the animated wrapper → triggers CSS
  //   3. The CSS keyframe runs once (animation-fill-mode: both, iteration: 1)
  // We do NOT use React transition libraries — inline keyframes keep the bundle
  // small and avoid SSR/hydration complications.
  const [slideDir, setSlideDir] = useState<"left" | "right" | null>(null);
  const [slideKey, setSlideKey] = useState(0);

  const triggerSlide = useCallback((dir: "left" | "right") => {
    setSlideDir(dir);
    setSlideKey(k => k + 1);
  }, []);

  // ── Logo click state (v3.2.2) ─────────────────────────────────────────────
  //
  // Single click : standard hard reload (1250ms spin → window.location.reload())
  // Triple click  : generate a new digest for the current edition, then reload.
  //
  // Triple-click detection:
  //   We track consecutive clicks within a 500ms window. On the 3rd click the
  //   logo enters "generating" mode: shows a Loader2 spinner and calls
  //   POST /api/digest/generate for the current edition. The admin key is read
  //   from localStorage (same key AdminPage uses). While generating, a countdown
  //   timer shows elapsed seconds so the user knows it's working (~30-90s).
  //   On success we hard-reload. On error we show a brief error state then reset.
  //
  // Why read adminKey from localStorage:
  //   DigestView is a public reader — it has no auth gate. But the generate
  //   endpoint requires x-admin-key. We read from localStorage('adminKey') where
  //   AdminPage stores it. If not present, we degrade gracefully: alert the user
  //   and redirect to /#/admin so they can authenticate first.
  //
  // Why hard reload after generate (not refetch()):
  //   Same reason as before — ensures the latest JS bundle is loaded, not just
  //   the latest data. See v3.1.0 notes above for full rationale.

  const [logoSpinning,   setLogoSpinning]   = useState(false);
  const [logoGenerating, setLogoGenerating] = useState(false);
  const [logoError,      setLogoError]      = useState(false);
  const [generateSecs,   setGenerateSecs]   = useState(0);
  const logoClickCount   = useRef(0);
  const logoClickTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generateInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleLogoClick = useCallback(() => {
    // Block all clicks while an operation is already running
    if (logoSpinning || logoGenerating) return;

    logoClickCount.current += 1;

    // Clear any existing reset timer
    if (logoClickTimer.current) clearTimeout(logoClickTimer.current);

    if (logoClickCount.current >= 3) {
      // ── Triple click: generate a new digest ────────────────────────────────
      logoClickCount.current = 0;

      const adminKey = localStorage.getItem('adminKey') || localStorage.getItem('cup_admin_key') || '';
      if (!adminKey) {
        // No key stored — send to admin to authenticate first
        window.location.href = '/#/admin';
        return;
      }

      setLogoGenerating(true);
      setGenerateSecs(0);
      setLogoError(false);

      // Live elapsed-second counter — reassures the user during 30-90s generation
      let secs = 0;
      generateInterval.current = setInterval(() => {
        secs += 1;
        setGenerateSecs(secs);
      }, 1000);

      fetch('/api/digest/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': adminKey,
        },
        body: JSON.stringify({ edition: edition.id }),
      })
        .then(async (res) => {
          if (generateInterval.current) clearInterval(generateInterval.current);
          if (res.ok || res.status === 409) {
            // 200 = new digest generated; 409 = already exists for today (still ok)
            // Either way, reload to pick up the freshest content + latest bundle
            setTimeout(() => window.location.reload(), 400);
          } else {
            // API returned an unexpected error — show error state briefly then reset
            setLogoError(true);
            setLogoGenerating(false);
            setTimeout(() => setLogoError(false), 3000);
          }
        })
        .catch(() => {
          if (generateInterval.current) clearInterval(generateInterval.current);
          setLogoError(true);
          setLogoGenerating(false);
          setTimeout(() => setLogoError(false), 3000);
        });

    } else {
      // ── Single / double click: schedule a hard reload after 500ms window ──
      // If a 3rd click doesn't arrive within 500ms, treat as single-click reload
      logoClickTimer.current = setTimeout(() => {
        if (logoClickCount.current < 3) {
          logoClickCount.current = 0;
          setLogoSpinning(true);
          setTimeout(() => window.location.reload(), 1250);
        }
      }, 500);
    }
  }, [logoSpinning, logoGenerating, edition.id]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (logoClickTimer.current)   clearTimeout(logoClickTimer.current);
      if (generateInterval.current) clearInterval(generateInterval.current);
    };
  }, []);

  // When the edition changes, reset to first card
  const handleEditionChange = (e: typeof edition) => {
    setEdition(e);
    setCardIndex(0);
    setShowGrid(false);
  };

  const { data: digest, isLoading, refetch } = useQuery<DigestResponse | null>({
    // Include edition in the query key so React Query re-fetches when edition changes
    queryKey: ["/api/digest/latest", edition.id],
    queryFn: async () => {
      const r = await apiRequest("GET", `/api/digest/latest?edition=${encodeURIComponent(edition.id)}`);
      if (!r.ok) return null;
      return r.json();
    },
    retry: false,
  });

  const totalCards = digest ? digest.stories.length + 1 : 0;
  const isQuoteCard = digest ? cardIndex === digest.stories.length : false;

  const goNext = useCallback(() => {
    setCardIndex(i => {
      if (i >= totalCards - 1) return i;
      triggerSlide("left");
      return i + 1;
    });
  }, [totalCards, triggerSlide]);

  const goPrev = useCallback(() => {
    setCardIndex(i => {
      if (i <= 0) return i;
      triggerSlide("right");
      return i - 1;
    });
  }, [triggerSlide]);

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
  if (!digest)   return <EmptyView edition={edition} />;

  const story = isQuoteCard ? null : digest.stories[cardIndex];

  return (
    <div
      className="min-h-screen bg-background text-foreground flex flex-col select-none"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Economist signature red rule */}
      <div className="h-1.5 w-full bg-[#E3120B] flex-shrink-0" />

      {/* ── Fallback notice (v2.0.3) ─────────────────────────────────────────
           When the selected edition has no digest, the server returns the most
           recent digest from any edition (never a blank page). This banner tells
           the reader which edition they're seeing and invites them to generate
           their edition. Non-intrusive: one line, dismissible by switching edition. */}
      {digest.isFallback && (
        <div className="flex-shrink-0 bg-muted/50 border-b border-border/60 px-4 py-2 flex items-center justify-between gap-3">
          <p className="text-[11px] text-muted-foreground font-ui leading-tight">
            <span className="text-foreground font-bold">{edition.flag} {edition.name}</span>
            {" — " + edition.ui.fallbackNotice}
          </p>
          <a
            href="/#/admin"
            className="text-[11px] font-bold font-ui text-[#E3120B] hover:underline flex-shrink-0 whitespace-nowrap"
          >
            {edition.ui.generateLink}
          </a>
        </div>
      )}

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 border-b border-border bg-background z-10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          {/* Logo (v3.1.0 refresh behaviour)
               Normal state : shows "C" in red square.
               Hover state  : "C" is replaced by a RefreshCw icon (CSS group-hover).
               Click        : logoSpinning = true → RefreshCw spins for 1250ms
                              then window.location.reload() fires a hard page reload.
               Hard reload vs React Query refetch():
                 refetch() only re-requests /api/digest/latest — it won’t pick up
                 a new JS bundle deployment. window.location.reload() guarantees
                 the user always runs the latest version after a click. */}
          {/* Logo (v3.2.2 triple-click generate)
               1 click  : 500ms window, then 1250ms spin → hard reload
               3 clicks : generate new digest for current edition → reload
               Generating state shows Loader2 spinner + elapsed seconds tooltip
               Error state flashes red briefly then resets */}
          <button
            onClick={handleLogoClick}
            className="group flex items-center gap-2 flex-shrink-0 transition-opacity"
            aria-label={logoGenerating ? "Generating digest…" : logoError ? "Error — try again" : "Click to refresh · Triple-click to generate new digest"}
            title={logoGenerating ? `Generating ${edition.name} digest… ${generateSecs}s` : logoError ? "Generation failed — check admin key" : "Click to refresh · Triple-click to generate new digest"}
            disabled={logoSpinning || logoGenerating}
          >
            <div className={`w-8 h-8 flex items-center justify-center flex-shrink-0 transition-all ${
              logoError      ? "bg-amber-500"  :
              logoGenerating ? "bg-[#E3120B]"  :
              "bg-[#E3120B] group-hover:scale-110"
            }`}>
              {logoGenerating ? (
                /* Generating: Loader2 spins while fetch is in-flight */
                <Loader2 size={14} className="text-white animate-spin" />
              ) : logoSpinning ? (
                /* Single-click reload: RefreshCw spins for 1250ms */
                <RefreshCw size={14} className="text-white animate-spin" />
              ) : logoError ? (
                /* Error flash: show X briefly */
                <X size={14} className="text-white" />
              ) : (
                <>
                  {/* Default: "C"; hover: static RefreshCw */}
                  <span className="block group-hover:hidden text-white font-black text-sm font-display tracking-tight">C</span>
                  <RefreshCw size={14} className="hidden group-hover:block text-white" />
                </>
              )}
            </div>
            {/* Elapsed seconds badge — only visible during generation */}
            {logoGenerating && generateSecs > 0 && (
              <span className="text-[10px] font-black font-ui text-[#E3120B] tabular-nums">
                {generateSecs}s
              </span>
            )}
          </button>

          {/* Progress dots — centred, fills remaining space */}
          <div className="flex-1 flex items-center justify-center gap-1.5 overflow-hidden px-2">
            {digest.stories.map((_, i) => (
              <button
                key={i}
                onClick={() => { triggerSlide(i > cardIndex ? 'left' : 'right'); setCardIndex(i); }}
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
              onClick={() => { triggerSlide('left'); setCardIndex(digest.stories.length); }}
              aria-label="Closing quote"
              className={`rounded-full transition-all duration-200 flex-shrink-0 ${
                isQuoteCard ? "w-5 h-1.5 bg-[#E3120B]" : "w-1.5 h-1.5 bg-border"
              }`}
            />
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Edition selector — flag dropdown */}
            <EditionSelector current={edition} onChange={handleEditionChange} />

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
          </div>
        </div>
      </header>

      {/* ── Grid overlay ────────────────────────────────────────────────────── */}
      {showGrid && (
        <GridOverlay
          digest={digest}
          activeIndex={cardIndex}
          onSelect={i => { triggerSlide(i > cardIndex ? 'left' : 'right'); setCardIndex(i); setShowGrid(false); }}
          onClose={() => setShowGrid(false)}
          edition={edition}
        />
      )}

      {/* ── Card area ───────────────────────────────────────────────────────── */}
      {/* Slide animation (v3.2.2):
           On every navigation we bump slideKey which re-mounts this div,
           restarting the CSS animation. slideDir controls which direction
           the incoming card slides in from (left=next, right=prev).
           duration: 280ms — snappy but not jarring on mobile.
           easing: cubic-bezier(0.25, 0.46, 0.45, 0.94) — iOS-style ease-out */}
      <style>{`
        @keyframes slide-in-left {
          from { opacity: 0; transform: translateX(48px);  }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes slide-in-right {
          from { opacity: 0; transform: translateX(-48px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .card-slide-left  { animation: slide-in-left  280ms cubic-bezier(0.25,0.46,0.45,0.94) both; }
        .card-slide-right { animation: slide-in-right 280ms cubic-bezier(0.25,0.46,0.45,0.94) both; }
      `}</style>
      <div className="flex-1 overflow-y-auto">
        <div
          key={slideKey}
          className={slideDir === "left" ? "card-slide-left" : slideDir === "right" ? "card-slide-right" : undefined}
        >
          {isQuoteCard
            ? <QuoteCard quote={digest.closingQuote} author={digest.closingQuoteAuthor} date={digest.date} label={edition.ui.closingThought} refreshLabel={edition.ui.refreshDigest} morningComplete={edition.ui.morningComplete} onRefresh={() => { triggerSlide("left"); refetch(); setCardIndex(0); }} />
            : story
            ? <StoryCard story={story} index={cardIndex} total={digest.stories.length} edition={edition} />
            : null
          }
        </div>
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
            <span className="hidden sm:block">{edition.ui.prevStory}</span>
          </button>

          {/* Counter */}
          <span className="text-sm text-muted-foreground font-ui tabular-nums font-medium">
            {isQuoteCard
              ? <span className="text-[#E3120B]">✦</span>
              : `${cardIndex + 1} ${edition.ui.of} ${digest.stories.length}`
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
            <span className="hidden sm:block">{edition.ui.nextStory}</span>
            <ChevronRight size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Story Source Modal ─────────────────────────────────────────────────────────

function SourcesStoryModal({ story, readSourcesLabel = "Read sources" }: { story: DigestStory; readSourcesLabel?: string }) {
  const [open, setOpen] = useState(false);
  const domain = (() => { try { return new URL(story.sourceUrl).hostname.replace("www.", ""); } catch { return story.sourceUrl; } })();

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 mt-8 text-sm font-bold font-ui text-[#E3120B] hover:underline underline-offset-2"
        data-testid="read-sources-btn"
      >
        <Rss size={13} /> {readSourcesLabel}
        {story.sources && story.sources.length > 0 && (
          <span className="text-[10px] bg-[#E3120B]/10 text-[#E3120B] px-1.5 py-0.5 font-black font-ui">
            {story.sources.length}
          </span>
        )}
      </button>

      {/* Modal (v3.2.2): clicking the dark backdrop (outside the card) closes it.
           stopPropagation on the inner div prevents the close from firing when
           the user clicks inside the card itself. */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm px-0 sm:px-6"
          onClick={() => setOpen(false)}
          aria-label="Close modal"
        >
          <div
            className="bg-card w-full sm:max-w-lg border border-border sm:rounded-none shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="border-b-2 border-[#E3120B] px-6 py-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#E3120B] font-ui mb-1">{story.category}</p>
                <h3 className="font-black text-base font-display leading-snug">{story.title}</h3>
              </div>
              <button onClick={() => setOpen(false)} className="flex-shrink-0 w-8 h-8 flex items-center justify-center hover:bg-accent rounded text-muted-foreground hover:text-foreground mt-0.5">
                <X size={16} />
              </button>
            </div>

            {/* Source entry */}
            <div className="px-6 py-5 space-y-3">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-ui">
                {story.sources && story.sources.length > 1 ? `${story.sources.length} Sources` : "Source"}
              </p>

              {/* Multi-source list */}
              {(story.sources && story.sources.length > 0 ? story.sources : [{ url: story.sourceUrl, title: story.sourceTitle || story.title, domain }]).map((src, i) => (
                <a
                  key={i}
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-4 p-4 border border-border hover:border-[#E3120B] transition-colors group"
                >
                  <div className="w-8 h-8 bg-muted flex items-center justify-center flex-shrink-0 text-xs font-bold text-muted-foreground group-hover:bg-[#E3120B]/10 group-hover:text-[#E3120B] transition-colors font-ui">
                    {String(i + 1).padStart(2, "0")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold font-display leading-snug group-hover:text-[#E3120B] transition-colors line-clamp-2">
                      {(src.title || "").startsWith("http") ? src.domain : (src.title || src.domain)}
                    </p>
                    <p className="text-xs text-muted-foreground font-ui mt-1 flex items-center gap-1">
                      {src.domain || domain} <ArrowUpRight size={10} />
                    </p>
                  </div>
                </a>
              ))}

              <p className="text-xs text-muted-foreground font-editorial leading-relaxed pt-1">
                This story was curated and summarised by the AI{story.sources && story.sources.length > 1 ? ` from ${story.sources.length} sources` : ""}. Always read the originals for full context.
              </p>
            </div>

            {/* Full article CTA */}
            <div className="border-t border-border px-6 py-4 flex items-center justify-between">
              <a
                href={story.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm font-bold font-ui bg-[#E3120B] text-white px-5 py-2.5 hover:bg-[#B50D08] transition-colors"
              >
                Read full article <ArrowUpRight size={13} />
              </a>
              <button onClick={() => setOpen(false)} className="text-sm text-muted-foreground hover:text-foreground font-ui transition-colors">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Story Card ───────────────────────────────────────────────────────────────
// Mobile-first: big type, generous padding, image above the fold

function StoryCard({ story, index, total, edition }: { story: DigestStory; index: number; total: number; edition: any }) {
  return (
    <article className="max-w-2xl lg:max-w-3xl mx-auto w-full px-4 sm:px-8 lg:px-12 py-5 sm:py-8 lg:py-14">
      {/* px: 4 mobile (tight but readable) → 8 sm → 12 lg
           py: 5 mobile (compact, more content visible) → 8 sm → 14 lg (editorial air) */}

      {/* Hero image
           On mobile: aspect-[16/7] (shorter than 16/9) so the image doesn't eat
           too much of the small viewport. mb-4 on mobile, mb-6 on desktop.
           On desktop: full aspect-video for editorial presence. */}
      {story.imageUrl && (
        <div className="w-full aspect-[16/7] sm:aspect-video bg-muted border border-border/50 overflow-hidden mb-4 sm:mb-6">
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
      <div className="flex items-center gap-3 mb-3 sm:mb-4">
        <span className="text-xs font-black font-ui text-[#E3120B] uppercase tracking-[0.18em]">
          {story.category}
        </span>
        <span className="text-xs text-muted-foreground font-ui tabular-nums">
          {index + 1} of {total}
        </span>
      </div>

      {/* Headline — tight leading is correct for large display type.
           leading-[1.15] keeps multi-line headlines compact and punchy.
           mb: snug on mobile, breathes on desktop. */}
      <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black font-display leading-[1.15] tracking-tight mb-3 sm:mb-4 lg:mb-5">
        {story.title}
      </h1>

      {/* Red accent line */}
      <div className="w-10 h-0.5 bg-[#E3120B] mb-4 sm:mb-6" />

      {/* Summary — rendered as 2-3 paragraphs (v2.1.2)
           The AI writes summaries with \n\n paragraph breaks.
           We split on those and render each as a separate <p> with
           mb-5 spacing between paragraphs for clean visual separation.
           Single-block summaries (old digests, no \n\n) render as one paragraph. */}
      <div className="space-y-5">
        {(story.summary || "").split(/\n\n+/).filter(p => p.trim()).map((para, i) => (
          <p
            key={i}
            className="text-[15px] sm:text-[17px] lg:text-[19px] font-editorial leading-[1.85] sm:leading-[2.0] lg:leading-[2.15] text-foreground/85"
          >
            {para.trim()}
          </p>
        ))}
      </div>

      {/* Sources — opens modal with source details */}
      <SourcesStoryModal story={story} readSourcesLabel={edition?.ui?.readSources ?? "Read sources"} />

    </article>
  );
}

// ─── Quote Card — Celebration screen (v2.3.0) ────────────────────────────────
//
// Design intent: the final card is the reward for reading the whole digest.
// Pure black (distinct from the dark-mode #0f0f0f background), staggered
// CSS entrance animations, a completion badge, and a closing quote.
//
// Pure CSS keyframe animations — no external animation library. All transitions
// are staggered (0.1s increments) so elements enter sequentially, not all at once.
// The shimmer on the ✦ badge loops indefinitely as a subtle "you're done" signal.
//
// layout: completion badge → date → red line → quote → author → end nudge

function QuoteCard({ quote, author, date, label = "Today's Thought", refreshLabel = "New digest", morningComplete = "You\u2019ve read today\u2019s digest", onRefresh }: {
  quote: string;
  author: string;
  date: string;
  label?: string;
  refreshLabel?: string;
  morningComplete?: string;
  onRefresh?: () => void;
}) {
  return (
    <div
      className="min-h-full flex items-center justify-center px-6 py-16"
      style={{ background: "#000000" }}
    >
      {/* CSS keyframes injected inline — no build step, no flash */}
      <style>{`
        @keyframes cup-fade-up {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes cup-badge-pop {
          0%   { opacity: 0; transform: scale(0.5); }
          70%  { transform: scale(1.1); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes cup-line-grow {
          from { width: 0; opacity: 0; }
          to   { width: 2.5rem; opacity: 1; }
        }
        @keyframes cup-shimmer {
          0%, 100% { opacity: 0.4; }
          50%       { opacity: 1; }
        }
        .cup-badge  { animation: cup-badge-pop  0.5s cubic-bezier(.34,1.56,.64,1) 0.05s both; }
        .cup-date   { animation: cup-fade-up 0.5s ease 0.3s both; }
        .cup-line   { animation: cup-line-grow 0.4s ease 0.5s both; }
        .cup-quote  { animation: cup-fade-up 0.7s ease 0.6s both; }
        .cup-author { animation: cup-fade-up 0.5s ease 0.9s both; }
        .cup-nudge    { animation: cup-fade-up 0.4s ease 1.1s both; }
        .cup-refresh  { animation: cup-fade-up 0.5s ease 1.4s both; }
        .cup-dot      { display: inline-block; animation: cup-shimmer 2s ease-in-out 1.3s infinite; }
      `}</style>

      <div className="max-w-xl w-full text-center">

        {/* Completion badge */}
        <div className="cup-badge flex items-center justify-center mb-10">
          <span className="inline-flex items-center gap-2.5 border border-white/15 px-5 py-2 text-[11px] font-black uppercase tracking-[0.22em] text-white/50 font-ui">
            <span className="cup-dot text-[#E3120B]">✦</span>
            {label}
            <span className="cup-dot text-[#E3120B]">✦</span>
          </span>
        </div>

        {/* Date */}
        <p className="cup-date text-[10px] uppercase tracking-[0.25em] text-white/25 font-ui mb-8">
          {formatDate(date)}
        </p>

        {/* Red accent line — grows in */}
        <div className="cup-line h-px bg-[#E3120B] mx-auto mb-10" />

        {/* The quote — the real payoff */}
        <blockquote className="cup-quote text-[1.6rem] sm:text-[2rem] lg:text-[2.4rem] font-editorial italic leading-[1.6] font-medium text-white">
          &ldquo;{quote}&rdquo;
        </blockquote>

        {/* Author */}
        {author && (
          <p className="cup-author text-sm sm:text-base text-white/35 font-ui mt-8 tracking-wide">
            — {author}
          </p>
        )}

        {/* End-of-digest nudge */}
        <p className="cup-nudge text-[10px] text-white/15 font-ui mt-14 uppercase tracking-[0.22em]">
          {morningComplete}
        </p>

        {/* Refresh button — large, prominent, invites the reader back */}
        {onRefresh && (
          <div className="cup-refresh mt-10">
            <button
              onClick={onRefresh}
              className="inline-flex items-center gap-3 px-8 py-4 border border-white/20 text-white/60 hover:text-white hover:border-white/50 text-sm font-bold font-ui uppercase tracking-[0.18em] transition-all duration-200 hover:bg-white/5 active:scale-95"
            >
              <RefreshCw size={14} className="flex-shrink-0" />
              {refreshLabel}
            </button>
          </div>
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
  edition,
}: {
  digest: DigestResponse;
  activeIndex: number;
  onSelect: (i: number) => void;
  onClose: () => void;
  edition: any;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-background/97 backdrop-blur-sm overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="font-black text-lg font-display uppercase tracking-wide">{edition.ui.allStories}</h2>
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
              <h3 className="text-sm font-bold font-display leading-[1.6] line-clamp-3">
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

function EmptyView({ edition }: { edition: any }) {
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
            <span className="text-white font-black text-2xl font-display">C</span>
          </div>
          <h2 className="text-2xl font-black font-display">{edition.ui.noDigestYet}</h2>
          <p className="text-base text-muted-foreground font-editorial leading-[1.9]">
            {edition.ui.noDigestSub}
          </p>
  
        </div>
      </div>
    </div>
  );
}

// ─── Sources Modal ────────────────────────────────────────────────────────────

const RSS_SOURCES = [
  // Wire Services
  { name: "Reuters",              url: "https://www.reuters.com",           category: "Wire",       flag: "🌐" },
  { name: "Associated Press",     url: "https://apnews.com",                category: "Wire",       flag: "🌐" },
  { name: "AFP",                  url: "https://www.afp.com",               category: "Wire",       flag: "🌐" },
  // English Broadsheets
  { name: "BBC News",             url: "https://www.bbc.com/news",          category: "Broadsheet", flag: "🇬🇧" },
  { name: "The Guardian",         url: "https://www.theguardian.com",       category: "Broadsheet", flag: "🇬🇧" },
  { name: "The Telegraph",        url: "https://www.telegraph.co.uk",       category: "Broadsheet", flag: "🇬🇧" },
  { name: "The Independent",      url: "https://www.independent.co.uk",     category: "Broadsheet", flag: "🇬🇧" },
  { name: "NYT World",            url: "https://www.nytimes.com",           category: "Broadsheet", flag: "🇺🇸" },
  { name: "WSJ World",            url: "https://www.wsj.com",              category: "Broadsheet", flag: "🇺🇸" },
  { name: "The Atlantic",         url: "https://www.theatlantic.com",       category: "Broadsheet", flag: "🇺🇸" },
  // The Economist
  { name: "The Economist",        url: "https://www.economist.com",         category: "Economist",  flag: "🇬🇧" },
  { name: "Economist Finance",    url: "https://www.economist.com/finance-and-economics", category: "Economist", flag: "🇬🇧" },
  // Business & Finance
  { name: "Financial Times",      url: "https://www.ft.com",               category: "Finance",    flag: "🇬🇧" },
  { name: "Bloomberg",            url: "https://www.bloomberg.com",         category: "Finance",    flag: "🇺🇸" },
  // European Press
  { name: "Le Monde (EN)",        url: "https://www.lemonde.fr/en",         category: "Europe",     flag: "🇫🇷" },
  { name: "Der Spiegel (EN)",     url: "https://www.spiegel.de/international", category: "Europe",  flag: "🇩🇪" },
  { name: "Euronews",             url: "https://www.euronews.com",          category: "Europe",     flag: "🇪🇺" },
  // Tech Press
  { name: "Ars Technica",         url: "https://arstechnica.com",           category: "Tech",       flag: "💻" },
  { name: "Wired",                url: "https://www.wired.com",             category: "Tech",       flag: "💻" },
  { name: "MIT Tech Review",      url: "https://www.technologyreview.com",  category: "Tech",       flag: "💻" },
  { name: "The Verge",            url: "https://www.theverge.com",          category: "Tech",       flag: "💻" },
  // Science
  { name: "Nature",               url: "https://www.nature.com",            category: "Science",    flag: "🔬" },
  { name: "Scientific American",  url: "https://www.scientificamerican.com",category: "Science",    flag: "🔬" },
  // Global South
  { name: "Al Jazeera",           url: "https://www.aljazeera.com",         category: "Global",     flag: "🌍" },
  { name: "SCMP",                 url: "https://www.scmp.com",              category: "Global",     flag: "🌏" },
];

const CATEGORY_ORDER = ["Wire", "Broadsheet", "Economist", "Finance", "Europe", "Tech", "Science", "Global"];

function SourcesModal({ onClose }: { onClose: () => void }) {
  const grouped = CATEGORY_ORDER.reduce((acc, cat) => {
    acc[cat] = RSS_SOURCES.filter(s => s.category === cat);
    return acc;
  }, {} as Record<string, typeof RSS_SOURCES>);

  const categoryLabels: Record<string, string> = {
    Wire: "Wire Services",
    Broadsheet: "Broadsheets",
    Economist: "The Economist",
    Finance: "Business & Finance",
    Europe: "European Press",
    Tech: "Tech & Innovation",
    Science: "Science",
    Global: "Global South",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm px-0 sm:px-4">
      <div className="bg-card w-full sm:max-w-2xl max-h-[85vh] flex flex-col border border-border sm:rounded-none shadow-2xl">
        {/* Header */}
        <div className="flex-shrink-0 border-b-2 border-[#E3120B] px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="font-black text-base font-display uppercase tracking-wide">RSS Sources</h2>
            <p className="text-xs text-muted-foreground font-ui mt-0.5">{RSS_SOURCES.length} trusted outlets · Auto-fills your digest when you haven't submitted links</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center hover:bg-accent rounded transition-colors text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        {/* Sources grid — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {CATEGORY_ORDER.map(cat => (
            <div key={cat}>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#E3120B] font-ui mb-2.5">
                {categoryLabels[cat]}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-border">
                {grouped[cat].map(source => (
                  <a
                    key={source.name}
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-card px-4 py-2.5 flex items-center justify-between hover:bg-accent/50 transition-colors group"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-base">{source.flag}</span>
                      <span className="text-sm font-bold font-display group-hover:text-[#E3120B] transition-colors">
                        {source.name}
                      </span>
                    </div>
                    <ArrowUpRight size={12} className="text-muted-foreground group-hover:text-[#E3120B] transition-colors flex-shrink-0" />
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-border px-6 py-3">
          <p className="text-xs text-muted-foreground font-editorial leading-relaxed">
            Your own submitted links always take priority. These sources fill the gaps automatically — no API keys, no cost.
          </p>
        </div>
      </div>
    </div>
  );
}
