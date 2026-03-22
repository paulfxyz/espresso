import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { Sun, Moon, ArrowUpRight, Coffee, ChevronLeft, ChevronRight } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import type { DigestStory } from "@shared/schema";

interface DigestResponse {
  id: number;
  date: string;
  status: string;
  stories: DigestStory[];
  closingQuote: string;
  closingQuoteAuthor: string;
  publishedAt: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  Technology:   "bg-blue-500/10 text-blue-400 dark:text-blue-300",
  Science:      "bg-violet-500/10 text-violet-400 dark:text-violet-300",
  Business:     "bg-amber-500/10 text-amber-400 dark:text-amber-300",
  Politics:     "bg-red-500/10 text-red-400 dark:text-red-300",
  World:        "bg-emerald-500/10 text-emerald-400 dark:text-emerald-300",
  Culture:      "bg-pink-500/10 text-pink-400 dark:text-pink-300",
  Health:       "bg-teal-500/10 text-teal-400 dark:text-teal-300",
  Environment:  "bg-green-500/10 text-green-400 dark:text-green-300",
  Sports:       "bg-orange-500/10 text-orange-400 dark:text-orange-300",
  Other:        "bg-zinc-500/10 text-zinc-400 dark:text-zinc-300",
};

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
}

export default function DigestView() {
  const { theme, toggle } = useTheme();
  const [activeStory, setActiveStory] = useState<string | null>(null);

  const { data: digest, isLoading, isError } = useQuery<DigestResponse | null>({
    queryKey: ["/api/digest/latest"],
    queryFn: async () => {
      const r = await apiRequest("GET", "/api/digest/latest");
      if (!r.ok) return null;
      const data = await r.json();
      return data;
    },
    retry: false,
  });

  if (isLoading) return <LoadingView />;
  if (isError || !digest) return <EmptyView />;

  const openStory = activeStory
    ? digest.stories.find(s => s.id === activeStory)
    : null;

  const currentIdx = activeStory
    ? digest.stories.findIndex(s => s.id === activeStory)
    : -1;

  const goNext = () => {
    if (currentIdx < digest.stories.length - 1) {
      setActiveStory(digest.stories[currentIdx + 1].id);
    }
  };
  const goPrev = () => {
    if (currentIdx > 0) {
      setActiveStory(digest.stories[currentIdx - 1].id);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground transition-colors">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5" data-testid="logo">
            <Coffee size={20} className="text-amber-500" />
            <span className="font-bold tracking-tight text-base font-display">espresso</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground hidden sm:block">
              {formatDate(digest.date)}
            </span>
            <button
              onClick={toggle}
              data-testid="theme-toggle"
              className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-accent transition-colors"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <a href="/#/admin" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              admin
            </a>
          </div>
        </div>
      </header>

      {/* Hero date */}
      <section className="max-w-5xl mx-auto px-6 pt-12 pb-8">
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2 font-medium">Morning Briefing</p>
        <h1 className="text-2xl font-bold font-display text-foreground" data-testid="digest-date">
          {formatDate(digest.date)}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{digest.stories.length} stories curated for you</p>
      </section>

      {/* Stories grid */}
      {!openStory ? (
        <main className="max-w-5xl mx-auto px-6 pb-16">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {digest.stories.map((story, idx) => (
              <StoryCard
                key={story.id}
                story={story}
                index={idx}
                onClick={() => setActiveStory(story.id)}
              />
            ))}
          </div>

          {/* Closing quote */}
          {digest.closingQuote && (
            <div className="mt-16 border-t border-border/50 pt-12 max-w-2xl mx-auto text-center">
              <p className="text-sm text-muted-foreground mb-3 uppercase tracking-widest">Today's Thought</p>
              <blockquote className="text-lg font-display font-medium italic text-foreground leading-relaxed">
                "{digest.closingQuote}"
              </blockquote>
              {digest.closingQuoteAuthor && (
                <p className="mt-3 text-sm text-muted-foreground">— {digest.closingQuoteAuthor}</p>
              )}
            </div>
          )}
        </main>
      ) : (
        /* Story reader */
        <main className="max-w-3xl mx-auto px-6 pb-16">
          <button
            onClick={() => setActiveStory(null)}
            className="mb-6 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            data-testid="back-button"
          >
            <ChevronLeft size={16} /> Back to briefing
          </button>

          <article data-testid={`story-detail-${openStory.id}`}>
            {openStory.imageUrl && (
              <div className="rounded-xl overflow-hidden aspect-video mb-6 bg-muted">
                <img
                  src={openStory.imageUrl}
                  alt={openStory.title}
                  className="w-full h-full object-cover"
                  onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </div>
            )}

            <div className="flex items-center gap-2 mb-3">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CATEGORY_COLORS[openStory.category] || CATEGORY_COLORS.Other}`}>
                {openStory.category}
              </span>
              <span className="text-xs text-muted-foreground">
                Story {currentIdx + 1} of {digest.stories.length}
              </span>
            </div>

            <h2 className="text-xl font-bold font-display mb-4 leading-snug">{openStory.title}</h2>
            <p className="text-base text-foreground/90 leading-relaxed whitespace-pre-wrap">{openStory.summary}</p>

            <a
              href={openStory.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-amber-500 hover:text-amber-400 transition-colors"
              data-testid="read-source-link"
            >
              Read source <ArrowUpRight size={14} />
            </a>
          </article>

          {/* Prev / Next */}
          <div className="flex items-center justify-between mt-10 pt-6 border-t border-border/50">
            <button
              onClick={goPrev}
              disabled={currentIdx === 0}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              data-testid="prev-story"
            >
              <ChevronLeft size={16} /> Previous
            </button>
            <button
              onClick={goNext}
              disabled={currentIdx === digest.stories.length - 1}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              data-testid="next-story"
            >
              Next <ChevronRight size={16} />
            </button>
          </div>

          {/* Quote at end of last story */}
          {currentIdx === digest.stories.length - 1 && digest.closingQuote && (
            <div className="mt-12 border-t border-border/50 pt-8 text-center">
              <p className="text-xs text-muted-foreground mb-3 uppercase tracking-widest">Today's Thought</p>
              <blockquote className="text-base font-display font-medium italic text-foreground leading-relaxed">
                "{digest.closingQuote}"
              </blockquote>
              {digest.closingQuoteAuthor && (
                <p className="mt-2 text-xs text-muted-foreground">— {digest.closingQuoteAuthor}</p>
              )}
            </div>
          )}
        </main>
      )}
    </div>
  );
}

function StoryCard({ story, index, onClick }: { story: DigestStory; index: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      data-testid={`story-card-${story.id}`}
      className="group text-left rounded-xl border border-border/60 overflow-hidden hover:border-border transition-all duration-200 hover:shadow-lg bg-card"
    >
      {story.imageUrl && (
        <div className="aspect-video overflow-hidden bg-muted">
          <img
            src={story.imageUrl}
            alt={story.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            onError={e => { (e.target as HTMLImageElement).parentElement!.style.display = "none"; }}
          />
        </div>
      )}
      <div className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-muted-foreground font-mono">#{String(index + 1).padStart(2, "0")}</span>
          <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${CATEGORY_COLORS[story.category] || CATEGORY_COLORS.Other}`}>
            {story.category}
          </span>
        </div>
        <h3 className="text-sm font-semibold font-display leading-snug text-foreground group-hover:text-amber-500 transition-colors line-clamp-3">
          {story.title}
        </h3>
        <p className="text-xs text-muted-foreground mt-2 line-clamp-2 leading-relaxed">
          {story.summary}
        </p>
      </div>
    </button>
  );
}

function LoadingView() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <Coffee size={32} className="text-amber-500 mx-auto mb-4 animate-pulse" />
        <p className="text-sm text-muted-foreground">Brewing your morning digest…</p>
      </div>
    </div>
  );
}

function EmptyView() {
  const { theme, toggle } = useTheme();
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/95">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Coffee size={20} className="text-amber-500" />
            <span className="font-bold tracking-tight text-base font-display">espresso</span>
          </div>
          <button onClick={toggle} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-accent transition-colors">
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </header>
      <div className="flex-1 flex items-center justify-center text-center px-6">
        <div>
          <Coffee size={48} className="text-amber-500/40 mx-auto mb-6" />
          <h2 className="text-xl font-bold font-display mb-2">No digest yet</h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
            Submit some links via the admin panel, then generate your first morning digest.
          </p>
          <a
            href="/#/admin"
            className="inline-flex items-center gap-2 text-sm font-medium bg-amber-500 text-black px-4 py-2 rounded-lg hover:bg-amber-400 transition-colors"
          >
            Go to Admin <ArrowUpRight size={14} />
          </a>
        </div>
      </div>
    </div>
  );
}
