import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Coffee, ArrowRight, Loader2 } from "lucide-react";
import { useLocation } from "wouter";

export default function SetupPage() {
  const [, navigate] = useLocation();
  const [openRouterKey, setOpenRouterKey] = useState("");
  const [adminKey, setAdminKey] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/setup", { openRouterKey, adminKey });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: () => navigate("/admin"),
  });

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <Coffee size={40} className="text-amber-500 mx-auto" />
          <h1 className="text-xl font-bold font-display">Welcome to Espresso</h1>
          <p className="text-sm text-muted-foreground">Configure your morning digest in seconds.</p>
        </div>

        <div className="rounded-xl border border-border/60 p-6 bg-card space-y-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">OpenRouter API Key *</label>
            <input
              type="password"
              value={openRouterKey}
              onChange={e => setOpenRouterKey(e.target.value)}
              placeholder="sk-or-..."
              data-testid="setup-openrouter-key"
              className="w-full text-sm px-3 py-2.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-amber-500/30"
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              Get a free key at <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer" className="text-amber-500 hover:underline">openrouter.ai</a>
            </p>
          </div>

          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Admin Key (optional)</label>
            <input
              type="password"
              value={adminKey}
              onChange={e => setAdminKey(e.target.value)}
              placeholder="Protect your admin panel"
              data-testid="setup-admin-key"
              className="w-full text-sm px-3 py-2.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-amber-500/30"
            />
          </div>

          {mutation.error && (
            <p className="text-xs text-red-400">{(mutation.error as any).message}</p>
          )}

          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !openRouterKey.trim()}
            data-testid="setup-save-btn"
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-amber-500 text-black text-sm font-medium hover:bg-amber-400 transition-colors disabled:opacity-50"
          >
            {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
            Get Started <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
