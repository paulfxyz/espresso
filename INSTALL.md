# 📦 INSTALL.md — Espresso Installation Guide

This guide covers every deployment scenario, from local development to production on major platforms.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Local Development](#local-development)
3. [Environment Variables](#environment-variables)
4. [Getting an OpenRouter API Key](#getting-an-openrouter-api-key)
5. [Production Deployment](#production-deployment)
   - [Fly.io](#flyio-recommended)
   - [Railway](#railway)
   - [Render](#render)
   - [DigitalOcean App Platform](#digitalocean-app-platform)
   - [VPS / Self-hosted](#vps--self-hosted-ubuntu--debian)
   - [Docker](#docker)
6. [Scheduling Daily Generation](#scheduling-daily-generation)
   - [GitHub Actions](#github-actions-recommended)
   - [System Cron](#system-cron)
   - [Cloudflare Workers Cron](#cloudflare-workers-cron)
7. [Submitting Links](#submitting-links)
   - [Admin Panel](#admin-panel)
   - [API](#api)
   - [Apple Shortcuts / iOS](#apple-shortcuts--ios)
   - [Browser Bookmarklet](#browser-bookmarklet)
8. [Security](#security)
9. [Updating](#updating)
10. [Troubleshooting](#troubleshooting)

---

## Prerequisites

- **Node.js 20+** — check with `node --version`
- **npm 10+** — check with `npm --version`
- **OpenRouter API key** — free account at [openrouter.ai](https://openrouter.ai)
- 50 MB disk space for the SQLite database

---

## Local Development

```bash
# 1. Clone
git clone https://github.com/paulfxyz/espresso.git
cd espresso

# 2. Install dependencies
npm install

# 3. Start development server (hot reload on both frontend and backend)
npm run dev

# → Server running at http://localhost:5000
# → Frontend served via Vite with HMR
```

Visit `http://localhost:5000/#/setup` to configure your OpenRouter key and optional admin key.

---

## Environment Variables

Create a `.env` file in the project root (it's already in `.gitignore`):

```bash
# Required
OPENROUTER_KEY=sk-or-v1-...         # Your OpenRouter API key

# Optional but recommended
ADMIN_KEY=your-random-secret-here   # Protects admin endpoints (set something strong)
DB_PATH=./espresso.db               # SQLite file path (default: ./espresso.db)
PORT=5000                           # Server port (default: 5000)
NODE_ENV=production                 # Set to 'production' in deployed environments
```

**Alternatively**, configure via the web UI at `/#/setup` — keys are stored in the SQLite DB. Environment variables take precedence over DB-stored keys.

### Generating a strong admin key

```bash
# macOS / Linux
openssl rand -hex 32

# Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Getting an OpenRouter API Key

1. Go to [openrouter.ai](https://openrouter.ai) and create a free account
2. Navigate to **Keys** in the dashboard
3. Click **Create Key** and give it a name (e.g. `espresso`)
4. Copy the key — it starts with `sk-or-v1-...`
5. Add credits (a month of daily digests costs less than $1 at Gemini Flash / Claude Haiku rates)

**Recommended models** (set via OpenRouter):
- `google/gemini-flash-1.5` — fast, cheap, excellent for summarization (~$0.01/digest)
- `anthropic/claude-3-haiku` — slightly better editorial quality, still cheap
- `openai/gpt-4o-mini` — good balance of speed and quality

The model is set in `server/pipeline.ts` → `callOpenRouter()` → `model` parameter. Default is `google/gemini-flash-1.5`.

---

## Production Deployment

### Fly.io (Recommended)

Fly.io is the cleanest option — persistent volume for SQLite, no cold starts on the hobby plan.

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Launch (from the espresso/ directory)
fly launch
# Answer the prompts: name your app, choose a region near you

# Set secrets
fly secrets set OPENROUTER_KEY=sk-or-v1-... ADMIN_KEY=your-secret-key

# Create a persistent volume for the SQLite database (1 GB free)
fly volumes create espresso_data --size 1

# Mount the volume — edit fly.toml to add:
# [[mounts]]
#   source      = "espresso_data"
#   destination = "/app/data"

# Set DB path to the mounted volume
fly secrets set DB_PATH=/app/data/espresso.db

# Deploy
fly deploy

# Your app is live at https://your-app-name.fly.dev
```

**fly.toml** template (Fly generates this, but verify these settings):
```toml
app = 'your-espresso-app'
primary_region = 'cdg'  # Paris — adjust to your nearest region

[build]

[env]
  PORT = '5000'
  NODE_ENV = 'production'

[http_service]
  internal_port = 5000
  force_https = true
  auto_stop_machines = 'stop'
  auto_start_machines = true
  min_machines_running = 0

[[mounts]]
  source      = 'espresso_data'
  destination = '/app/data'

[[vm]]
  size = 'shared-cpu-1x'
```

---

### Railway

1. Create account at [railway.app](https://railway.app)
2. Click **New Project → Deploy from GitHub repo** → select `paulfxyz/espresso` (or your fork)
3. Add environment variables in the **Variables** tab:
   - `OPENROUTER_KEY=sk-or-v1-...`
   - `ADMIN_KEY=your-key`
   - `NODE_ENV=production`
4. Railway detects `package.json` automatically and uses `npm run build` + `npm start`
5. Add a **Volume** (Railway Pro) mounted at `/app/data` for persistent SQLite, then set `DB_PATH=/app/data/espresso.db`

Without a persistent volume, the SQLite DB resets on each deploy. Use the GitHub Actions cron to regenerate if needed.

---

### Render

1. Create account at [render.com](https://render.com)
2. **New Web Service → Connect Repository**
3. Settings:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Instance Type:** Free (spins down after 15 min inactivity — OK for personal use)
4. Add environment variables in the **Environment** tab
5. For persistent SQLite: create a **Persistent Disk** (paid) or use Render's managed Postgres if you prefer (requires schema migration)

---

### DigitalOcean App Platform

1. Create account at [digitalocean.com](https://digitalocean.com)
2. **Apps → Create App → GitHub**
3. Select your fork of this repo
4. DO auto-detects Node.js — set:
   - **Build Command:** `npm run build`
   - **Run Command:** `npm start`
5. Set environment variables under **App Settings → Environment Variables**
6. For persistent storage: use a DigitalOcean Space (S3-compatible) or a Managed Database (overkill for SQLite — just use a Volume)

---

### VPS / Self-hosted (Ubuntu / Debian)

Full control, cheapest option for ongoing costs ($5/month VPS runs this fine).

```bash
# 1. SSH into your server
ssh user@your-server

# 2. Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. Clone and install
git clone https://github.com/paulfxyz/espresso.git /opt/espresso
cd /opt/espresso
npm install

# 4. Create .env
cat > .env << EOF
OPENROUTER_KEY=sk-or-v1-...
ADMIN_KEY=your-secret-key
DB_PATH=/opt/espresso/data/espresso.db
PORT=5000
NODE_ENV=production
EOF

mkdir -p /opt/espresso/data

# 5. Build
npm run build

# 6. Set up systemd service
sudo cat > /etc/systemd/system/espresso.service << EOF
[Unit]
Description=Espresso Morning Digest
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/espresso
ExecStart=/usr/bin/node dist/index.cjs
Restart=on-failure
RestartSec=10
EnvironmentFile=/opt/espresso/.env

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable espresso
sudo systemctl start espresso

# 7. Check it's running
sudo systemctl status espresso
curl http://localhost:5000/api/health
```

**Nginx reverse proxy** (recommended — handles HTTPS, compression):

```nginx
# /etc/nginx/sites-available/espresso
server {
    listen 80;
    server_name espresso.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name espresso.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/espresso.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/espresso.yourdomain.com/privkey.pem;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Enable and get SSL cert
sudo ln -s /etc/nginx/sites-available/espresso /etc/nginx/sites-enabled/
sudo certbot --nginx -d espresso.yourdomain.com
sudo nginx -t && sudo systemctl reload nginx
```

---

### Docker

A `Dockerfile` is included in the repo root:

```bash
# Build the image
docker build -t espresso .

# Run with environment variables and persistent volume
docker run -d \
  --name espresso \
  -p 5000:5000 \
  -e OPENROUTER_KEY=sk-or-v1-... \
  -e ADMIN_KEY=your-secret-key \
  -e DB_PATH=/data/espresso.db \
  -v $(pwd)/data:/data \
  --restart unless-stopped \
  espresso
```

**docker-compose.yml:**
```yaml
version: '3.9'
services:
  espresso:
    build: .
    ports:
      - "5000:5000"
    environment:
      - OPENROUTER_KEY=${OPENROUTER_KEY}
      - ADMIN_KEY=${ADMIN_KEY}
      - DB_PATH=/data/espresso.db
      - NODE_ENV=production
    volumes:
      - espresso_data:/data
    restart: unless-stopped

volumes:
  espresso_data:
```

---

## Scheduling Daily Generation

### GitHub Actions (Recommended)

Already set up in `.github/workflows/daily-digest.yml`. Fires at 6:00 AM GMT every day.

Add these secrets to your GitHub repository (**Settings → Secrets and variables → Actions**):

| Secret | Value |
|--------|-------|
| `ESPRESSO_URL` | `https://your-deployed-app.com` |
| `ESPRESSO_ADMIN_KEY` | Your admin key |

Optional: add repo variable `AUTO_PUBLISH=true` to automatically publish without manual review.

Manual trigger: Go to **Actions → Daily Morning Digest → Run workflow**.

---

### System Cron

```bash
# Run every day at 6:00 AM GMT (adjust for your timezone)
crontab -e

# Add this line:
0 6 * * * curl -s -X POST https://yourdomain.com/api/digest/generate \
  -H "Content-Type: application/json" \
  -H "x-admin-key: your-key" \
  >> /var/log/espresso-cron.log 2>&1
```

---

### Cloudflare Workers Cron

If deploying to Cloudflare Workers (via Hono.js adapter):

```toml
# wrangler.toml
[triggers]
crons = ["0 6 * * *"]
```

---

## Submitting Links

### Admin Panel

Visit `https://yourdomain.com/#/admin` → **Links** tab.

- Single URL: paste and press Add
- Bulk: click "Bulk paste", paste one URL per line

### API

```bash
# Single link
curl -X POST https://yourdomain.com/api/links \
  -H "Content-Type: application/json" \
  -H "x-admin-key: YOUR_KEY" \
  -d '{"url": "https://example.com/article"}'

# Multiple links
curl -X POST https://yourdomain.com/api/links \
  -H "Content-Type: application/json" \
  -H "x-admin-key: YOUR_KEY" \
  -d '{"urls": ["https://...", "https://...", "https://..."]}'
```

### Apple Shortcuts / iOS

Create a Shortcut that sends a POST request:

1. Open **Shortcuts** → New Shortcut
2. Add action: **Get URLs from input** (for Share Sheet) or **Ask for Input** (URL)
3. Add action: **Get Contents of URL**
   - URL: `https://yourdomain.com/api/links`
   - Method: POST
   - Headers: `Content-Type: application/json`, `x-admin-key: your-key`
   - Request Body: JSON → `{"url": "[URL from step 1]"}`
4. Add to Share Sheet

Now you can share any URL from Safari/Chrome directly to Espresso.

### Browser Bookmarklet

Create a bookmark with this as the URL (replace `YOUR_KEY` and `yourdomain.com`):

```javascript
javascript:(function(){
  fetch('https://yourdomain.com/api/links',{
    method:'POST',
    headers:{'Content-Type':'application/json','x-admin-key':'YOUR_KEY'},
    body:JSON.stringify({url:location.href})
  }).then(()=>alert('Added to Espresso ☕'));
})();
```

Click the bookmarklet on any page to save it to your Espresso queue.

---

## Security

### Admin key

If you set an `ADMIN_KEY`, all write endpoints require the `x-admin-key: your-key` header. The public reader (`/` and `/api/digest/latest`) remains open.

Recommended: set an admin key before exposing Espresso publicly. Use a long random string.

### HTTPS

Always deploy behind HTTPS in production. Use Let's Encrypt (free) via Certbot or Caddy. Fly.io, Railway, and Render handle HTTPS automatically.

### Database

The SQLite file (`espresso.db`) contains your API key, admin key, and all your link history. Make sure:
- The DB path is not publicly accessible (it's inside the app container, not served as a static file)
- Regular backups if using a VPS (SQLite is a single file — easy to backup with `rsync` or `cp`)

### Rate limiting

No rate limiting is implemented by default. If you expose Espresso publicly, consider adding nginx rate limiting or a reverse proxy layer for the API endpoints.

---

## Updating

```bash
# Pull latest changes
cd /opt/espresso
git pull origin main

# Reinstall dependencies (in case package.json changed)
npm install

# Rebuild
npm run build

# Restart (if using systemd)
sudo systemctl restart espresso
```

Database migrations are handled automatically via inline SQL in `server/storage.ts` using `CREATE TABLE IF NOT EXISTS` — no separate migration step needed.

---

## Troubleshooting

### "No unprocessed links available"

You haven't submitted any links yet, AND the RSS trend fallback also failed (network issue). Check:
1. Are you connected to the internet from the server?
2. Can `curl https://feeds.reuters.com/reuters/topNews` reach the RSS feed?
3. Submit at least one link manually via the admin panel to unblock.

### "OpenRouter error: 401"

Your OpenRouter API key is invalid or not set. Check:
1. Visit `/#/admin` → Overview tab — is the status showing "✅ OpenRouter key configured"?
2. If not, enter your key in the Configuration section and save.
3. Make sure the key starts with `sk-or-v1-...` and hasn't expired.

### "OpenRouter error: 429"

Rate limited by OpenRouter. This shouldn't happen with one digest per day — check if you're accidentally running the pipeline multiple times. Wait a few minutes and try again.

### Jina Reader returning empty content

Some URLs are heavily JavaScript-rendered and Jina may struggle. Workarounds:
- Try submitting the article's AMP version if available (amp.example.com/...)
- For YouTube: Jina extracts the transcript if available; otherwise the title and description
- For TikTok: Jina extracts caption and description

### Database errors on first run

Make sure the `DB_PATH` directory exists and is writable:
```bash
mkdir -p $(dirname $DB_PATH)
ls -la $(dirname $DB_PATH)
```

### Port already in use

```bash
# Find what's on port 5000
lsof -i :5000
# Kill it or change PORT in your .env
PORT=3000 npm run dev
```

### GitHub Actions not firing

1. Check the Actions tab in your GitHub repo — is the workflow listed?
2. GitHub disables scheduled workflows on inactive repos. Trigger it manually once to re-enable.
3. Check `ESPRESSO_URL` doesn't have a trailing slash.
4. Verify `ESPRESSO_ADMIN_KEY` matches exactly what you configured.

---

*For more help, open an issue at [github.com/paulfxyz/espresso/issues](https://github.com/paulfxyz/espresso/issues)*
