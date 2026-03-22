import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  Coffee, Plus, Trash2, RefreshCw, Send, Eye, EyeOff,
  ArrowLeft, Link2, Loader2, ChevronDown, ChevronUp, ArrowUpRight,
  Sun, Moon, Settings, LayoutDashboard, BookOpen
} from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import type { DigestStory, Link } from "@shared/schema";

interface DigestResponse {
  id: number;
  date: string;
  status: string;
  stories: DigestStory[];
  closingQuote: string;
  closingQuoteAuthor: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  Technology: "bg-blue-500/10 text-blue-400",
  Science:    "bg-violet-500/10 text-violet-400",
  Business:   "bg-amber-500/10 text-amber-400",
  Politics:   "bg-red-500/10 text-red-400",
  World:      "bg-emerald-500/10 text-emerald-400",
  Culture:    "bg-pink-500/10 text-pink-400",
  Health:     "bg-teal-500/10 text-teal-400",
  Environment:"bg-green-500/10 text-green-400",
  Sports:     "bg-orange-500/10 text-orange-400",
  Other:      "bg-zinc-500/10 text-zinc-400",
};

type Tab = "overview" | "links" | "digest";

export default function AdminPage() {
  const { theme, toggle } = useTheme();
  const [tab, setTab] = useState<Tab>("overview");
  const [adminKey, setAdminKey] = useState(() => {
    try { return (window as any).__adminKey || ""; } catch { return ""; }
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/95 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <a href="/#/" className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft size={16} />
            </a>
            <div className="flex items-center gap-2">
              <Coffee size={18} className="text-amber-500" />
              <span className="font-bold text-sm font-display">espresso admin</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={toggle} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-accent transition-colors">
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-6xl mx-auto px-6 flex gap-1 pb-0">
          {(["overview", "links", "digest"] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              data-testid={`tab-${t}`}
              className={`px-4 py-2 text-xs font-medium capitalize border-b-2 transition-colors ${
                tab === t
                  ? "border-amber-500 text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "overview" ? <span className="flex items-center gap-1.5"><LayoutDashboard size={12} />{t}</span>
               : t === "links" ? <span className="flex items-center gap-1.5"><Link2 size={12} />{t}</span>
               : <span className="flex items-center gap-1.5"><BookOpen size={12} />{t}</span>}
            </button>
          ))}
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {tab === "overview" && <OverviewTab adminKey={adminKey} setAdminKey={setAdminKey} />}
        {tab === "links" && <LinksTab adminKey={adminKey} />}
        {tab === "digest" && <DigestTab adminKey={adminKey} />}
      </div>
    </div>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────
function OverviewTab({ adminKey, setAdminKey }: { adminKey: string; setAdminKey: (k: string) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [keyInput, setKeyInput] = useState("");
  const [adminInput, setAdminInput] = useState("");

  const { data: status } = useQuery({
    queryKey: ["/api/setup/status"],
    queryFn: async () => { const r = await apiRequest("GET", "/api/setup/status"); return r.ok ? r.json() : {}; },
  });

  const { data: links = [] } = useQuery<Link[]>({
    queryKey: ["/api/links"],
    queryFn: async () => { const r = await apiRequest("GET", "/api/links"); return r.ok ? r.json() : []; },
  });

  const { data: digests = [] } = useQuery<DigestResponse[]>({
    queryKey: ["/api/digests"],
    queryFn: async () => { const r = await apiRequest("GET", "/api/digests"); return r.ok ? r.json() : []; },
  });

  const setupMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/setup", {
        openRouterKey: keyInput || undefined,
        adminKey: adminInput || undefined,
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Configuration saved" });
      qc.invalidateQueries({ queryKey: ["/api/setup/status"] });
      if (adminInput) setAdminKey(adminInput);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/digest/generate", {}, {
        "x-admin-key": adminKey,
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: `Digest generated`, description: `${data.storiesCount} stories ready for review` });
      qc.invalidateQueries({ queryKey: ["/api/digests"] });
    },
    onError: (e: any) => toast({ title: "Generation failed", description: e.message, variant: "destructive" }),
  });

  const publishedCount = digests.filter(d => d.status === "published").length;
  const unprocessedLinks = links.filter((l: any) => !l.processedAt).length;

  return (
    <div className="space-y-8">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total links", value: links.length, color: "text-blue-400" },
          { label: "Unprocessed", value: unprocessedLinks, color: "text-amber-400" },
          { label: "Total digests", value: digests.length, color: "text-violet-400" },
          { label: "Published", value: publishedCount, color: "text-emerald-400" },
        ].map(stat => (
          <div key={stat.label} className="rounded-xl border border-border/60 p-4 bg-card">
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className={`text-2xl font-bold font-display mt-1 ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="rounded-xl border border-border/60 p-6 bg-card space-y-4">
        <h2 className="text-sm font-semibold">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending || !status?.configured}
            data-testid="generate-digest-btn"
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-black text-sm font-medium hover:bg-amber-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generateMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Generate Today's Digest
          </button>
          <a
            href="/#/"
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm hover:bg-accent transition-colors"
          >
            <Eye size={14} /> View Digest
          </a>
        </div>
        {!status?.configured && (
          <p className="text-xs text-amber-400">⚠️ Configure your OpenRouter API key below before generating.</p>
        )}
      </div>

      {/* Configuration */}
      <div className="rounded-xl border border-border/60 p-6 bg-card space-y-4">
        <h2 className="text-sm font-semibold flex items-center gap-2"><Settings size={14} /> Configuration</h2>
        <p className="text-xs text-muted-foreground">
          Status: {status?.configured ? "✅ OpenRouter key configured" : "❌ Not configured"}
          {status?.adminKeySet ? " · 🔒 Admin key set" : " · 🔓 No admin key"}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">OpenRouter API Key</label>
            <input
              type="password"
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              placeholder="sk-or-..."
              data-testid="input-openrouter-key"
              className="w-full text-sm px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-amber-500/30"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Admin Key (optional)</label>
            <input
              type="password"
              value={adminInput}
              onChange={e => setAdminInput(e.target.value)}
              placeholder="Set a secret key to protect admin"
              data-testid="input-admin-key"
              className="w-full text-sm px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-amber-500/30"
            />
          </div>
        </div>
        <button
          onClick={() => setupMutation.mutate()}
          disabled={setupMutation.isPending || (!keyInput && !adminInput)}
          data-testid="save-config-btn"
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm hover:bg-accent transition-colors disabled:opacity-50"
        >
          {setupMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
          Save Configuration
        </button>
        <p className="text-xs text-muted-foreground mt-2">
          After saving the admin key, add <code className="bg-muted px-1 rounded">x-admin-key: your-key</code> header to API calls.
        </p>
      </div>

      {/* Admin key input for session */}
      <div className="rounded-xl border border-border/60 p-6 bg-card space-y-3">
        <h2 className="text-sm font-semibold">Session Admin Key</h2>
        <p className="text-xs text-muted-foreground">If you set an admin key, enter it here to authenticate this session.</p>
        <input
          type="password"
          value={adminKey}
          onChange={e => setAdminKey(e.target.value)}
          placeholder="Enter admin key for this session"
          data-testid="input-session-key"
          className="w-full max-w-sm text-sm px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-amber-500/30"
        />
      </div>
    </div>
  );
}

// ─── Links Tab ────────────────────────────────────────────────────────────────
function LinksTab({ adminKey }: { adminKey: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [urlInput, setUrlInput] = useState("");
  const [bulkInput, setBulkInput] = useState("");
  const [showBulk, setShowBulk] = useState(false);

  const headers = adminKey ? { "x-admin-key": adminKey } : {};

  const { data: links = [], isLoading } = useQuery<Link[]>({
    queryKey: ["/api/links"],
    queryFn: async () => { const r = await apiRequest("GET", "/api/links", undefined, headers); return r.ok ? r.json() : []; },
  });

  const addMutation = useMutation({
    mutationFn: async (urls: string[]) => {
      const res = await apiRequest("POST", "/api/links", { urls }, headers);
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: `${data.created} link(s) added` });
      setUrlInput("");
      setBulkInput("");
      qc.invalidateQueries({ queryKey: ["/api/links"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/links/${id}`, undefined, headers);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Link removed" });
      qc.invalidateQueries({ queryKey: ["/api/links"] });
    },
  });

  const handleAdd = () => {
    if (showBulk) {
      const urls = bulkInput.split("\n").map(u => u.trim()).filter(Boolean);
      if (urls.length) addMutation.mutate(urls);
    } else {
      if (urlInput.trim()) addMutation.mutate([urlInput.trim()]);
    }
  };

  return (
    <div className="space-y-6">
      {/* Add links */}
      <div className="rounded-xl border border-border/60 p-6 bg-card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold flex items-center gap-2"><Plus size={14} /> Add Links</h2>
          <button
            onClick={() => setShowBulk(v => !v)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showBulk ? "Single URL" : "Bulk paste"}
          </button>
        </div>

        {!showBulk ? (
          <div className="flex gap-3">
            <input
              type="url"
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAdd()}
              placeholder="https://article.com/news..."
              data-testid="input-url"
              className="flex-1 text-sm px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-amber-500/30"
            />
            <button
              onClick={handleAdd}
              disabled={addMutation.isPending || !urlInput.trim()}
              data-testid="add-link-btn"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-black text-sm font-medium hover:bg-amber-400 transition-colors disabled:opacity-50"
            >
              {addMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Add
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <textarea
              value={bulkInput}
              onChange={e => setBulkInput(e.target.value)}
              placeholder="Paste one URL per line..."
              data-testid="input-bulk-urls"
              rows={6}
              className="w-full text-sm px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-amber-500/30 font-mono resize-none"
            />
            <button
              onClick={handleAdd}
              disabled={addMutation.isPending || !bulkInput.trim()}
              data-testid="add-bulk-btn"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-black text-sm font-medium hover:bg-amber-400 transition-colors disabled:opacity-50"
            >
              {addMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Add {bulkInput.split("\n").filter(Boolean).length} URLs
            </button>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Supports articles, YouTube, TikTok, and any URL. Content is extracted automatically when the digest is generated.
        </p>
      </div>

      {/* Links list */}
      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Links ({links.length})</h2>
          <span className="text-xs text-muted-foreground">
            {links.filter((l: any) => !l.processedAt).length} unprocessed
          </span>
        </div>
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : links.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No links yet. Add some above.</div>
        ) : (
          <div className="divide-y divide-border/30">
            {links.map((link: any) => (
              <div key={link.id} data-testid={`link-row-${link.id}`} className="px-6 py-3 flex items-center justify-between gap-4 hover:bg-accent/30 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${link.processedAt ? "bg-emerald-500" : "bg-amber-500"}`} title={link.processedAt ? "Used in digest" : "Unprocessed"} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{link.title || link.url}</p>
                    <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-foreground truncate flex items-center gap-1">
                      {new URL(link.url).hostname} <ArrowUpRight size={10} />
                    </a>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-muted-foreground hidden md:block">
                    {new Date(link.submittedAt).toLocaleDateString()}
                  </span>
                  <button
                    onClick={() => deleteMutation.mutate(link.id)}
                    data-testid={`delete-link-${link.id}`}
                    className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* API reference */}
      <div className="rounded-xl border border-border/60 p-6 bg-card space-y-3">
        <h2 className="text-sm font-semibold">API Reference</h2>
        <div className="font-mono text-xs space-y-2 text-muted-foreground">
          <p className="text-foreground font-semibold">Submit a link</p>
          <pre className="bg-muted rounded-lg p-3 overflow-x-auto">{`curl -X POST /api/links \\
  -H "Content-Type: application/json" \\
  -H "x-admin-key: YOUR_KEY" \\
  -d '{"url": "https://..."}'`}</pre>
          <p className="text-foreground font-semibold mt-3">Submit multiple links</p>
          <pre className="bg-muted rounded-lg p-3 overflow-x-auto">{`curl -X POST /api/links \\
  -H "Content-Type: application/json" \\
  -H "x-admin-key: YOUR_KEY" \\
  -d '{"urls": ["https://...", "https://..."]}'`}</pre>
        </div>
      </div>
    </div>
  );
}

// ─── Digest Tab ───────────────────────────────────────────────────────────────
function DigestTab({ adminKey }: { adminKey: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const headers = adminKey ? { "x-admin-key": adminKey } : {};

  const { data: digests = [], isLoading } = useQuery<DigestResponse[]>({
    queryKey: ["/api/digests"],
    queryFn: async () => { const r = await apiRequest("GET", "/api/digests", undefined, headers); return r.ok ? r.json() : []; },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/digest/generate", {}, headers);
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: `Digest generated`, description: `${data.storiesCount} stories ready` });
      qc.invalidateQueries({ queryKey: ["/api/digests"] });
    },
    onError: (e: any) => toast({ title: "Generation failed", description: e.message, variant: "destructive" }),
  });

  const publishMutation = useMutation({
    mutationFn: async ({ id, publish }: { id: number; publish: boolean }) => {
      const endpoint = publish ? `/api/digest/${id}/publish` : `/api/digest/${id}/unpublish`;
      const res = await apiRequest("POST", endpoint, {}, headers);
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: (_, vars) => {
      toast({ title: vars.publish ? "Digest published" : "Digest unpublished" });
      qc.invalidateQueries({ queryKey: ["/api/digests"] });
      qc.invalidateQueries({ queryKey: ["/api/digest/latest"] });
    },
  });

  const swapMutation = useMutation({
    mutationFn: async ({ digestId, storyId }: { digestId: number; storyId: string }) => {
      const res = await apiRequest("PATCH", `/api/digest/${digestId}/story/${storyId}/swap`, {}, headers);
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Story swapped" });
      qc.invalidateQueries({ queryKey: ["/api/digests"] });
    },
    onError: (e: any) => toast({ title: "Swap failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/digest/${id}`, undefined, headers);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Digest deleted" });
      qc.invalidateQueries({ queryKey: ["/api/digests"] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">All Digests ({digests.length})</h2>
        <button
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          data-testid="generate-digest-btn-2"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-black text-sm font-medium hover:bg-amber-400 transition-colors disabled:opacity-50"
        >
          {generateMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Generate Today
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Loading digests…</div>
      ) : digests.length === 0 ? (
        <div className="rounded-xl border border-border/60 p-12 bg-card text-center">
          <Coffee size={32} className="text-amber-500/40 mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">No digests yet. Generate one to get started.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {digests.map(digest => (
            <div key={digest.id} className="rounded-xl border border-border/60 bg-card overflow-hidden" data-testid={`digest-row-${digest.id}`}>
              {/* Digest header */}
              <div className="px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setExpandedId(expandedId === digest.id ? null : digest.id)}
                    data-testid={`expand-digest-${digest.id}`}
                    className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-foreground"
                  >
                    {expandedId === digest.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  <div>
                    <p className="text-sm font-semibold">{digest.date}</p>
                    <p className="text-xs text-muted-foreground">{digest.stories.length} stories</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    digest.status === "published"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-amber-500/10 text-amber-400"
                  }`}>
                    {digest.status}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => publishMutation.mutate({ id: digest.id, publish: digest.status !== "published" })}
                    disabled={publishMutation.isPending}
                    data-testid={`publish-btn-${digest.id}`}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-accent transition-colors"
                  >
                    {digest.status === "published" ? <><EyeOff size={12} /> Unpublish</> : <><Send size={12} /> Publish</>}
                  </button>
                  <a
                    href="/#/"
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-accent transition-colors"
                  >
                    <Eye size={12} /> Preview
                  </a>
                  <button
                    onClick={() => deleteMutation.mutate(digest.id)}
                    data-testid={`delete-digest-${digest.id}`}
                    className="w-7 h-7 rounded flex items-center justify-center text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {/* Expanded stories */}
              {expandedId === digest.id && (
                <div className="border-t border-border/30">
                  <div className="divide-y divide-border/20">
                    {digest.stories.map((story, idx) => (
                      <div key={story.id} className="px-6 py-3 flex items-start gap-4" data-testid={`story-admin-${story.id}`}>
                        <span className="text-xs font-mono text-muted-foreground mt-0.5 flex-shrink-0 w-5">
                          {String(idx + 1).padStart(2, "0")}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className={`text-xs px-1.5 py-0.5 rounded-full ${CATEGORY_COLORS[story.category] || CATEGORY_COLORS.Other}`}>
                              {story.category}
                            </span>
                          </div>
                          <p className="text-sm font-medium leading-snug">{story.title}</p>
                          <a href={story.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mt-0.5">
                            {story.sourceTitle || story.sourceUrl} <ArrowUpRight size={10} />
                          </a>
                        </div>
                        <button
                          onClick={() => swapMutation.mutate({ digestId: digest.id, storyId: story.id })}
                          disabled={swapMutation.isPending}
                          data-testid={`swap-story-${story.id}`}
                          className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-border hover:bg-accent transition-colors flex-shrink-0"
                        >
                          {swapMutation.isPending ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                          Swap
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Quote */}
                  {digest.closingQuote && (
                    <div className="px-6 py-4 border-t border-border/30 bg-muted/20">
                      <p className="text-xs text-muted-foreground mb-1">Closing Quote</p>
                      <p className="text-sm italic">"{digest.closingQuote}"</p>
                      {digest.closingQuoteAuthor && (
                        <p className="text-xs text-muted-foreground mt-1">— {digest.closingQuoteAuthor}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
