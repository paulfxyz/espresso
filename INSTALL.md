# 📦 INSTALL.md — Cup of News

Complete deployment guide. Every platform. Every scenario.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Local Development](#local-development)
3. [Environment Variables](#environment-variables)
4. [OpenRouter API Key](#openrouter-api-key)
5. [Production Deployment](#production-deployment)
   - [Fly.io](#flyio-recommended)
   - [Railway](#railway)
   - [Render](#render)
   - [VPS / Self-hosted](#vps--self-hosted)
   - [Docker](#docker)
6. [Custom Domain + HTTPS](#custom-domain--https)
7. [Daily Cron — GitHub Actions](#daily-cron--github-actions)
8. [Native iOS / Android App](#native-ios--android-app)
9. [Submitting Links](#submitting-links)
10. [Changing the AI Model](#changing-the-ai-model)
11. [Security](#security)
12. [Updating](#updating)
13. [Troubleshooting](#troubleshooting)

---

## Prerequisites

- **Node.js 20+** — `node --version`
- **npm 10+** — `npm --version`  
- **OpenRouter API key** — [openrouter.ai](https://openrouter.ai)
- ~100MB disk space

---

## Local Development

```bash
git clone https://github.com/paulfxyz/cup-of-news.git
cd cup-of-news
npm install
npm run dev
# → http://localhost:5000
```

1. Visit `http://localhost:5000/#/setup` → enter OpenRouter key
2. Visit `http://localhost:5000/#/admin` → password `admin`
3. Click **Generate Today's Digest** — first digest in ~15 seconds

---

## Environment Variables

Create `.env` in the project root (already in `.gitignore`):

```bash
# Required
OPENROUTER_KEY=sk-or-v1-...

# Recommended in production
ADMIN_KEY=your-random-secret          # protects all write endpoints
DB_PATH=./cup-of-news.db              # SQLite file path
PORT=5000                             # server port (default: 5000)
NODE_ENV=production
```

Keys can also be set via the `/#/setup` UI on first run — stored in the SQLite config
table. Environment variables take precedence.

**Generate a strong admin key:**
```bash
openssl rand -hex 32
```

---

## OpenRouter API Key

1. Create a free account at [openrouter.ai](https://openrouter.ai)
2. **Keys → Create Key** → name it `cup-of-news`
3. Add ~$10 credit (lasts months at ~$0.08-0.15/digest with Gemini 2.5 Pro; or ~$5 if you switch to `gemini-2.0-flash`)

**Default model:** `google/gemini-2.5-pro`

**Why Gemini 2.5 Pro?** It follows complex multi-constraint instructions reliably (diversity rules, mandatory slots, structured JSON). Cheaper models like `gemini-2.0-flash` ignore diversity mandates under topic-heavy news cycles. For a once-a-day task, the quality difference justifies the cost.

**Switch model** — edit `server/pipeline.ts`:
```typescript
const DEFAULT_MODEL = "google/gemini-2.5-pro";
// Alternatives (cheaper, lower quality on diversity rules):
// "google/gemini-2.0-flash-001"    ~$0.02/digest — fast, weaker instruction following
// "anthropic/claude-3-haiku"       ~$0.05/digest — good balance
// "openai/gpt-4o-mini"             ~$0.04/digest — reliable JSON output
// "anthropic/claude-3.5-sonnet"    ~$0.30/digest — best quality, most expensive
// "meta-llama/llama-3.1-70b"       ~$0.01/digest — cheapest, weakest diversity compliance
```

> ⚠️ **Note:** `google/gemini-2.5-pro-preview-03-25` does NOT exist on OpenRouter. Use `google/gemini-2.5-pro` exactly.

---

## Production Deployment

### Fly.io (Recommended)

Fly.io has persistent volumes (SQLite survives restarts/deploys), no cold starts on the
hobby plan, and automatic HTTPS. Paris region (CDG) is closest to Europe.

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh
fly auth login

# Launch (from the cup-of-news directory)
fly launch
# → when asked to deploy now: say NO
# → note the app name Fly generates (you'll need it)

# Create persistent SQLite volume (1GB free)
fly volumes create cup_of_news_data --size 1 --region cdg

# Verify fly.toml has the mount:
# [[mounts]]
#   source = "cup_of_news_data"
#   destination = "/data"

# Set secrets
fly secrets set \
  OPENROUTER_KEY=sk-or-v1-... \
  ADMIN_KEY=your-secure-password \
  DB_PATH=/data/cup-of-news.db

# Deploy
fly deploy

# Configure via browser
open https://your-app.fly.dev/#/setup
```

> ⚠️ **Critical:** Fly auto-generates a random app name (e.g. `app-lively-haze-690`).
> Your `fly.toml` must match this exact name. Check with `fly apps list`.

**fly.toml** (already in repo, update app name):
```toml
app = "your-actual-app-name"
primary_region = "cdg"

[env]
  PORT = "8080"
  NODE_ENV = "production"
  DB_PATH = "/data/cup-of-news.db"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true

[[mounts]]
  source = "cup_of_news_data"
  destination = "/data"
```

---

### Railway

1. [railway.app](https://railway.app) → New Project → Deploy from GitHub → `paulfxyz/cup-of-news`
2. Add variables: `OPENROUTER_KEY`, `ADMIN_KEY`, `NODE_ENV=production`
3. Build: `npm run build` · Start: `npm start`
4. For persistent SQLite: add a Volume (Railway Pro) at `/data`, set `DB_PATH=/data/cup-of-news.db`

> Without a persistent volume, the DB resets on every deploy. Acceptable for testing.

---

### Render

1. New Web Service → connect repo
2. Build: `npm install && npm run build` · Start: `npm start`
3. Add env vars
4. Free tier: spins down after 15 min inactivity (first request takes ~30s to wake)

---

### VPS / Self-hosted

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone and build
git clone https://github.com/paulfxyz/cup-of-news.git /opt/cup-of-news
cd /opt/cup-of-news
npm install && npm run build

# Environment
mkdir -p /opt/cup-of-news/data
cat > /opt/cup-of-news/.env << EOF
OPENROUTER_KEY=sk-or-v1-...
ADMIN_KEY=your-password
DB_PATH=/opt/cup-of-news/data/cup-of-news.db
PORT=3000
NODE_ENV=production
EOF

# Systemd service
sudo tee /etc/systemd/system/cup-of-news.service << EOF
[Unit]
Description=Cup of News
After=network.target
[Service]
Type=simple
WorkingDirectory=/opt/cup-of-news
ExecStart=/usr/bin/node dist/index.cjs
Restart=on-failure
EnvironmentFile=/opt/cup-of-news/.env
[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable cup-of-news
sudo systemctl start cup-of-news
curl http://localhost:3000/api/health
```

**Nginx + HTTPS:**
```nginx
server {
    listen 443 ssl http2;
    server_name app.cupof.news;
    ssl_certificate /etc/letsencrypt/live/app.cupof.news/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.cupof.news/privkey.pem;
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```
```bash
sudo certbot --nginx -d app.cupof.news
```

---

### Docker

```bash
docker build -t cup-of-news .
docker run -d \
  --name cup-of-news \
  -p 5000:5000 \
  -e OPENROUTER_KEY=sk-or-v1-... \
  -e ADMIN_KEY=your-password \
  -e DB_PATH=/data/cup-of-news.db \
  -v cup-of-news-data:/data \
  --restart unless-stopped \
  cup-of-news
```

---

## Custom Domain + HTTPS

### Fly.io

```bash
# Add domain
fly certs add app.cupof.news --app your-app-name

# Get DNS records
fly certs setup app.cupof.news --app your-app-name
```

Add to your DNS:

| Type | Name | Value |
|------|------|-------|
| `A` | `app` | (from `fly ips list`) |
| `AAAA` | `app` | (from `fly ips list`) |
| `TXT` | `_fly-ownership.app` | (from `fly certs setup`) |

SSL issues automatically via Let's Encrypt. Check: `fly certs check app.cupof.news`

---

## Daily Cron — GitHub Actions

Already included in `.github/workflows/daily-digest.yml`. Fires at **6:00 AM GMT**.

Add repo secrets (**Settings → Secrets → Actions**):

| Secret | Value |
|--------|-------|
| `ESPRESSO_URL` | `https://app.cupof.news` |
| `ESPRESSO_ADMIN_KEY` | Your admin password |

Optional repo variable: `AUTO_PUBLISH=true` to skip manual review.

Manual trigger: **Actions → Daily Morning Digest → Run workflow**

**System cron (VPS):**
```bash
0 6 * * * curl -s -X POST https://app.cupof.news/api/digest/generate \
  -H "x-admin-key: your-password" >> /var/log/cup-of-news.log 2>&1
```

---

## Multi-Edition Generation

Generate a specific edition via API:
```bash
# French edition
curl -X POST https://app.cupof.news/api/digest/generate \
  -H "x-admin-key: your-password" \
  -H "Content-Type: application/json" \
  -d '{"edition": "fr-FR"}'

# German edition
curl -X POST https://app.cupof.news/api/digest/generate \
  -H "x-admin-key: your-password" \
  -H "Content-Type: application/json" \
  -d '{"edition": "de-DE"}'
```

Available edition IDs: `en-WORLD`, `en-US`, `en-CA`, `en-GB`, `fr-FR`, `fr-CA`, `de-DE`, `en-AU`

Each edition maintains its own digest per day. The reader automatically fetches the correct edition based on your last selection (saved in the browser).

---

## Native iOS / Android App

Cup of News is PWA-ready and Capacitor-ready. Two paths to native:

### Option A — Capacitor (Recommended, free)

Capacitor wraps the existing React app in a native WebView. 100% code reuse. No rewrite.

```bash
# Install Capacitor
npm install @capacitor/core @capacitor/cli
npm install @capacitor/ios @capacitor/android
npm install @capacitor/status-bar @capacitor/splash-screen

# Build web app
npm run build

# Add native platforms
npx cap add ios
npx cap add android

# Sync web assets to native shells
npx cap sync

# Open in native IDE
npx cap open ios      # → Xcode (Mac required)
npx cap open android  # → Android Studio
```

Then distribute via App Store Connect and Google Play Console.
App ID: `news.cupof.app`

See [`NATIVE.md`](./NATIVE.md) for the full guide including App Store preparation,
deep links, push notifications, and future native plugins.

### Option B — Capacitor + Ionic AppFlow (CI/CD, paid)

[Ionic AppFlow](https://ionic.io/appflow) builds your native app in the cloud without
needing Xcode or Android Studio locally. Useful if you don't have a Mac for iOS builds.

```bash
npm install -g @ionic/cli
ionic init "Cup of News" --type=react
# Connect to AppFlow in ionic.io dashboard
# Push to GitHub → AppFlow builds and distributes automatically
```

Cost: ~$49/month for the CI/CD pipeline. Worth it if you're deploying regularly.

### Option C — Capacitor + Fastlane (free, automated)

[Fastlane](https://fastlane.tools) automates App Store and Play Store submissions.

```bash
gem install fastlane
cd ios/App && fastlane init
cd android && fastlane init
# Configure Appfile with your Apple/Google credentials
# Run: fastlane ios release / fastlane android release
```

### Option D — Progressive Web App (PWA, zero cost)

No build step. Works on Android natively (full PWA support). iOS has limitations:
no push notifications, no App Store listing, but fully installable from Safari.

The app already has `manifest.json`, all Apple meta tags, and `theme-color: #E3120B`.
Just visit `app.cupof.news` in Safari → Share → Add to Home Screen.

### Option E — Median.co / AppMySite (no-code, fastest)

Services that wrap any URL into a native app without touching code:
- **[Median.co](https://median.co)** — best quality, ~$99/year, iOS + Android
- **[AppMySite](https://www.appmysite.com)** — no-code, ~$29/month
- **[Gonative.io](https://gonative.io)** — developer-friendly, ~$99 one-time

Just point them at `https://app.cupof.news`. No code changes needed. Good for
testing the App Store experience before investing in a full Capacitor build.

### Comparison

| Approach | Cost | Effort | Native APIs | App Store |
|----------|------|--------|-------------|-----------|
| **Capacitor** | Free | Medium | ✅ Full | ✅ |
| **Capacitor + AppFlow** | $49/mo | Low | ✅ Full | ✅ |
| **Fastlane** | Free | Medium | ✅ Full | ✅ |
| **PWA** | Free | Zero | ❌ Limited | ❌ iOS |
| **Median.co** | $99/yr | Zero | ⚠️ Basic | ✅ |

**Recommendation:** Start with Median.co or PWA to test the concept. Move to Capacitor
when you want push notifications, haptics, and full App Store presence.

---

## Submitting Links

### Admin panel
`/#/admin → Links` tab — single URL or bulk paste (one per line)

### API
```bash
# Single
curl -X POST https://app.cupof.news/api/links \
  -H "Content-Type: application/json" \
  -H "x-admin-key: your-password" \
  -d '{"url": "https://example.com/article"}'

# Multiple
curl -X POST https://app.cupof.news/api/links \
  -H "Content-Type: application/json" \
  -H "x-admin-key: your-password" \
  -d '{"urls": ["https://...", "https://..."]}'
```

### Apple Shortcuts (iOS)
1. New Shortcut → **Get URLs from input** (enables Share Sheet)
2. **Get Contents of URL**: POST to `https://app.cupof.news/api/links`
   - Headers: `Content-Type: application/json`, `x-admin-key: your-password`
   - Body: JSON `{"url": "[input URL]"}`
3. Add to Share Sheet

### Bookmarklet
```javascript
javascript:(function(){fetch('https://app.cupof.news/api/links',{method:'POST',headers:{'Content-Type':'application/json','x-admin-key':'YOUR_PASSWORD'},body:JSON.stringify({url:location.href})}).then(()=>alert('☕ Saved to Cup of News!'));})();
```

---

## Changing the AI Model

Edit `server/pipeline.ts`, line ~80:
```typescript
const DEFAULT_MODEL = "google/gemini-2.5-pro";
```

| Model | Cost/digest | Quality | Speed |
|-------|-------------|---------|-------|
| `google/gemini-2.5-pro` | ~$0.08-0.15 | Best (diversity rules) | Medium |
| `google/gemini-2.0-flash-001` | ~$0.02 | Good | Fast |
| `anthropic/claude-3-haiku` | ~$0.05 | Great | Fast |
| `openai/gpt-4o-mini` | ~$0.04 | Great | Fast |
| `anthropic/claude-3.5-sonnet` | ~$0.30 | Excellent | Medium |
| `meta-llama/llama-3.1-70b` | ~$0.01 | Weak on constraints | Medium |

---

## Security

- **Set a strong `ADMIN_KEY`** before exposing publicly — use `openssl rand -hex 32`
- **HTTPS mandatory** in production — Fly/Railway handle it; use Certbot on VPS
- The admin URL (`/#/admin`) is not linked anywhere in the public reader — intentionally hidden
- The SQLite file is never served as a static asset
- No rate limiting built in — add Nginx rate limiting if the API is public-facing

---

## Updating

```bash
git pull origin main
npm install
npm run build
sudo systemctl restart cup-of-news   # VPS
# or
fly deploy                            # Fly.io
```

DB migrations run automatically (`CREATE TABLE IF NOT EXISTS`) on every startup.

---

## Troubleshooting

**Password `admin` not working on fresh Fly deploy**
The DB may have a different password from a previous setup call. Reset:
```bash
curl -X POST https://app.cupof.news/api/setup \
  -H "Content-Type: application/json" \
  -H "x-admin-key: old-password" \
  -d '{"adminKey": "admin"}'
```

**"No content available" error**
No links + RSS fetch failed. Test: `curl https://feeds.bbci.co.uk/news/world/rss.xml`

**"OpenRouter error: 404 — No endpoints found"**
Wrong model slug. Check [openrouter.ai/models](https://openrouter.ai/models).

**"Published digest already exists"**
Unpublish from Admin → Digest tab → Unpublish, then regenerate.

**Fly.io: `app not found`**
`fly.toml` app name doesn't match. Check with `fly apps list`, update `fly.toml`.

**Too many SVG placeholder images**
The direct HTML OG fetch is failing. Test: `curl -r 0-20000 https://article-url.com`
Some outlets block Range requests. Nothing to do — the editorial SVG is the correct fallback.

**Digest not diverse enough**
Add links from underrepresented regions before generating. The AI can only diversify
from what it receives. Submitting 5 links from Latin America + 5 from Asia before the
6 AM cron will immediately improve geographic spread.

---

*Bugs and questions: [github.com/paulfxyz/cup-of-news/issues](https://github.com/paulfxyz/cup-of-news/issues)*
