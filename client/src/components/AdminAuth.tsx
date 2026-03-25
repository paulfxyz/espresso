/**
 * @file client/src/components/AdminAuth.tsx
 * @author Paul Fleury <hello@paulfleury.com>
 * @version 3.3.1
 *
 * Cup of News — Admin Authentication Gate
 *
 * Wraps the admin panel with a password login screen.
 * The password is persisted in localStorage (key: "adminKey") and validated
 * silently on mount. Session survives page refreshes and browser restarts.
 * Logout clears localStorage. On stale/wrong key, login screen is shown.
 * On first install with no admin key set, the default password is "admin".
 *
 * Features:
 * - Clean login form with Economist red styling
 * - Shows "Change Password" option once authenticated
 * - Password change calls POST /api/admin/change-password
 * - Session cleared on browser close (stateless, no cookies)
 */

import { useState, useEffect, createContext, useContext } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Eye, EyeOff } from "lucide-react";

// ── Auth Context ──────────────────────────────────────────────────────────────

interface AuthContextType {
  adminKey: string;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({ adminKey: "", logout: () => {} });

export const useAdminAuth = () => useContext(AuthContext);

// ── Auth Gate ─────────────────────────────────────────────────────────────────

// localStorage key for persisted admin session (also read by DigestView triple-click)
const ADMIN_KEY_STORAGE = "adminKey";

export function AdminAuthGate({ children }: { children: React.ReactNode }) {
  // ── Persistent session (v3.2.5) ─────────────────────────────────────────
  // On mount, restore the saved admin key from localStorage and validate it
  // silently against /api/links. If valid → auto-authenticate. If stale/wrong
  // → clear and show the login screen as normal.
  //
  // Security note: the admin key is a password stored in localStorage.
  // This is acceptable for a single-user self-hosted tool where the threat
  // model is "someone who can open the browser" rather than XSS attacks.
  // The key is never sent to any third-party service.
  const getSavedKey = () => {
    try { return localStorage.getItem(ADMIN_KEY_STORAGE) || ""; } catch { return ""; }
  };

  const [adminKey, setAdminKey] = useState(getSavedKey);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showChange, setShowChange] = useState(false);
  const [checking, setChecking] = useState(() => getSavedKey() !== "");

  // On mount: if a saved key exists, validate it silently
  useEffect(() => {
    const saved = getSavedKey();
    if (!saved) { setChecking(false); return; }
    fetch("/api/links", { headers: { "x-admin-key": saved } })
      .then(r => {
        if (r.ok || r.status === 200) {
          setAdminKey(saved);
          setIsAuthenticated(true);
        } else {
          // Stale or wrong key — clear it
          try { localStorage.removeItem(ADMIN_KEY_STORAGE); } catch {}
          setAdminKey("");
        }
      })
      .catch(() => {
        // Network error — keep the key, show login to re-confirm
        setAdminKey("");
      })
      .finally(() => setChecking(false));
  }, []);

  const logout = () => {
    setIsAuthenticated(false);
    setAdminKey("");
    try { localStorage.removeItem(ADMIN_KEY_STORAGE); } catch {}
  };

  // Show nothing while silently validating the saved session
  if (checking) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[#E3120B] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <LoginScreen
        onSuccess={(key) => {
          setAdminKey(key);
          setIsAuthenticated(true);
          try { localStorage.setItem(ADMIN_KEY_STORAGE, key); } catch {}
        }}
      />
    );
  }

  return (
    <AuthContext.Provider value={{ adminKey, logout }}>
      {showChange && (
        <ChangePasswordModal
          adminKey={adminKey}
          onClose={() => setShowChange(false)}
          onChanged={(newKey) => {
            setAdminKey(newKey);
            setShowChange(false);
          }}
        />
      )}
      <div>
        {/* Inject change-password trigger into context so AdminPage can call it */}
        <AdminToolbar onChangePassword={() => setShowChange(true)} onLogout={logout} />
        {children}
      </div>
    </AuthContext.Provider>
  );
}

// ── Toolbar injected at top of admin ─────────────────────────────────────────

function AdminToolbar({ onChangePassword, onLogout }: { onChangePassword: () => void; onLogout: () => void }) {
  return (
    <div className="bg-[#E3120B] text-white px-4 py-1.5 flex items-center justify-between text-xs font-ui">
      <span className="opacity-80">Admin session active</span>
      <div className="flex items-center gap-4">
        <button onClick={onChangePassword} className="hover:underline opacity-90 hover:opacity-100">
          Change password
        </button>
        <button onClick={onLogout} className="hover:underline opacity-90 hover:opacity-100">
          Log out
        </button>
      </div>
    </div>
  );
}

// ── Login Screen ──────────────────────────────────────────────────────────────

function LoginScreen({ onSuccess }: { onSuccess: (key: string) => void }) {
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const { data: status } = useQuery({
    queryKey: ["/api/setup/status"],
    queryFn: async () => {
      const r = await apiRequest("GET", "/api/setup/status");
      return r.ok ? r.json() : {};
    },
  });

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    // Use the actual password, or "admin" if field is empty (default)
    const key = password.trim() || "admin";

    try {
      const r = await apiRequest("GET", "/api/links", undefined, {
        "x-admin-key": key,
      });

      if (r.ok) {
        onSuccess(key);
      } else if (r.status === 401) {
        setError("Incorrect password. Default is \"admin\" on a fresh install.");
      } else {
        // Non-auth error (500, etc.) — still let through, error will show in panel
        onSuccess(key);
      }
    } catch {
      setError("Connection error. Check your internet and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Economist red rule */}
      <div className="h-1 w-full bg-[#E3120B]" />

      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 bg-[#E3120B] flex items-center justify-center">
              <span className="text-white font-bold text-lg font-display">C</span>
            </div>
            <div>
              <h1 className="font-bold text-base font-display uppercase tracking-wide">Cup of News</h1>
              <p className="text-xs text-muted-foreground font-ui">Admin panel</p>
            </div>
          </div>

          {/* Login form */}
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 font-ui">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="admin"
                  autoFocus
                  data-testid="login-password"
                  className="w-full text-sm px-3 py-2.5 pr-10 border border-border bg-background focus:outline-none focus:border-[#E3120B] focus:ring-1 focus:ring-[#E3120B] font-ui"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5 font-ui">
                Default password: <code className="bg-muted px-1 rounded text-xs">admin</code>
              </p>
            </div>

            {error && (
              <p className="text-xs text-[#E3120B] font-ui">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              data-testid="login-submit"
              className="w-full py-2.5 bg-[#E3120B] text-white text-sm font-bold hover:bg-[#B50D08] transition-colors disabled:opacity-40 font-ui uppercase tracking-wider"
            >
              {loading ? <Loader2 size={14} className="animate-spin mx-auto" /> : "Enter"}
            </button>
          </form>

          <p className="mt-6 text-xs text-center text-muted-foreground font-ui">
            <a href="/#/" className="hover:text-[#E3120B] transition-colors">← Back to digest</a>
          </p>
        </div>
      </div>

      <footer className="border-t border-border py-4 text-center text-xs text-muted-foreground font-ui">
        <a href="https://www.perplexity.ai/computer" target="_blank" rel="noopener noreferrer"
          className="hover:text-foreground transition-colors">
          Built with Perplexity Computer
        </a>
      </footer>
    </div>
  );
}

// ── Change Password Modal ─────────────────────────────────────────────────────

function ChangePasswordModal({
  adminKey,
  onClose,
  onChanged,
}: {
  adminKey: string;
  onClose: () => void;
  onChanged: (newKey: string) => void;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest(
        "POST",
        "/api/admin/change-password",
        { newPassword },
        { "x-admin-key": adminKey }
      );
      if (!r.ok) throw new Error((await r.json()).error || "Failed");
      return r.json();
    },
    onSuccess: () => onChanged(newPassword),
    onError: (e: any) => setError(e.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (newPassword.length < 4) return setError("Password must be at least 4 characters.");
    if (newPassword !== confirm) return setError("Passwords don't match.");
    mutation.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-card border border-border w-full max-w-sm shadow-2xl">
        <div className="border-b-2 border-[#E3120B] px-6 py-4 flex items-center justify-between">
          <h2 className="font-bold text-sm uppercase tracking-wider font-display">Change Password</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 font-ui">
              New Password
            </label>
            <div className="relative">
              <input
                type={showPw ? "text" : "password"}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Min. 4 characters"
                autoFocus
                className="w-full text-sm px-3 py-2.5 pr-10 border border-border bg-background focus:outline-none focus:border-[#E3120B] focus:ring-1 focus:ring-[#E3120B] font-ui"
              />
              <button type="button" onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 font-ui">
              Confirm Password
            </label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Repeat password"
              className="w-full text-sm px-3 py-2.5 border border-border bg-background focus:outline-none focus:border-[#E3120B] focus:ring-1 focus:ring-[#E3120B] font-ui"
            />
          </div>

          {error && <p className="text-xs text-[#E3120B] font-ui">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-border text-sm font-bold hover:bg-accent transition-colors font-ui">
              Cancel
            </button>
            <button type="submit" disabled={mutation.isPending}
              className="flex-1 py-2.5 bg-[#E3120B] text-white text-sm font-bold hover:bg-[#B50D08] transition-colors disabled:opacity-40 font-ui">
              {mutation.isPending ? <Loader2 size={13} className="animate-spin mx-auto" /> : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
