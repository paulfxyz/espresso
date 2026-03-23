# 📦 INSTALL.md — Espresso Installation Guide

Complete guide for every deployment scenario. Start with **Local Development** to verify everything works, then follow the platform guide that fits your setup.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Local Development](#local-development)
3. [Environment Variables](#environment-variables)
4. [Getting an OpenRouter Key](#getting-an-openrouter-key)
5. [Production Deployment](#production-deployment)
   - [Fly.io](#flyio-recommended) ← recommended
   - [Railway](#railway)
   - [Render](#render)
   - [VPS / Self-hosted](#vps--self-hosted)
   - [Docker](#docker)
6. [Custom Domain (HTTPS)](#custom-domain-https)
7. [Scheduling Daily Generation](#scheduling-daily-generation)
8. [Submitting Links](#submitting-links)
9. [Admin Panel](#admin-panel)
10. [Changing the AI Model](#changing-the-ai-model)
11. [Security](#security)
12. [Updating](#updating)
13. [Troubleshooting](#troubleshooting)

---

## Prerequisites

- **Node.js 20+** — verify: `node --version`
- **npm 10+** — verify: `npm --version`
- **OpenRouter API key** — free account at [openrouter.ai](https://openrouter.ai)
- ~100 MB disk space (app + SQLite DB)

---

## Local Development

```bash
# 1. Clone
git clone https://github.com/paulfxyz/espresso.git
cd espresso

# 2. Install dependencies
npm install

# 3. Start dev server (hot reload on both frontend and backend)
npm run dev
# → http://localhost:5000
```

Visit `http://localhost:5000/#/setup` to configure your OpenRouter key.

Then `http://localhost:5000/#/admin` — password `admin` — to generate your first digest.

---

## Environment Variables

Create `.env` in the project root (already in `.gitignore`):

```bash
# Required
OPENROUTER_KEY=sk-or-v1-...       # Your OpenRouter API key

# Recommended
ADMIN_KEY=your-random-secret       # Protects all write endpoints
DB_PATH=./espresso.db              # SQLite file path (default: ./espresso.db)

# Optional
PORT=5000                          # Server port (default: 5000)
NODE_ENV=production                # Set in deployed environments
```

Keys can also be set via the `/#/setup` UI on first run — stored in the SQLite config table. Environment variables take precedence over DB-stored keys.

**Generate a strong admin key:**
```bash
openssl rand -hex 32
# or
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Getting an OpenRouter Key

1. Create a free account at [openrouter.ai](https://openrouter.ai)
2. Go to **Keys → Create Key** — name it `espresso`
3. Add a small credit balance (~$5 lasts months)

**Cost:** Gemini 2.0 Flash (default model) costs approximately $0.02 per full 20-story digest generation.

**Change the model** — edit `server/pipeline.ts` → `DEFAULT_MODEL`:
```typescript
const DEFAULT_MODEL = "google/gemini-2.0-flash-001";
// Try: "anthropic/claude-3-haiku", "openai/gpt-4o-mini", "meta-llama/llama-3.1-70b"
```
Browse all available models at [openrouter.ai/models](https://openrouter.ai/models).

---

## Production Deployment

### Fly.io (Recommended)

Fly.io is the best fit: persistent volumes for SQLite, no cold starts, automatic HTTPS, Paris region (close to Lisbon/Europe).

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh
fly auth login

# Launch from the project directory
fly launch
# When prompted: name your app, select region (cdg = Paris is closest to Lisbon)
# DO NOT deploy yet when asked — say No

# Create a persistent volume for SQLite (1 GB, free)
fly volumes create espresso_data --size 1 --region cdg

# Set secrets
fly secrets set \
  OPENROUTER_KEY=sk-or-v1-... \
  ADMIN_KEY=your-secure-password \
  DB_PATH=/data/espresso.db

# Verify fly.toml has the volume mount (should be auto-added, check anyway):
# [[mounts]]
#   source = "espresso_data"
#   destination = "/data"

# Deploy
fly deploy
```

**fly.toml** reference (already included in the repo):
```toml
app = "your-app-name"
primary_region = "cdg"

[env]
  PORT = "8080"
  NODE_ENV = "production"
  DB_PATH = "/data/espresso.db"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true

[[mounts]]
  source = "espresso_data"
  destination = "/data"

[[vm]]
  size = "shared-cpu-1x"
  memory = "256mb"
```

---

### Railway

1. Create account at [railway.app](https://railway.app)
2. **New Project → Deploy from GitHub** → select `paulfxyz/espresso`
3. Add environment variables in the **Variables** tab:
   ```
   OPENROUTER_KEY=sk-or-v1-...
   ADMIN_KEY=your-password
   NODE_ENV=production
   ```
4. Build command: `npm run build` · Start command: `npm start`
5. For persistent SQLite: add a **Volume** (Railway Pro) mounted at `/data`, then set `DB_PATH=/data/espresso.db`

> Without a persistent volume, the database resets on every deploy. Use GitHub Actions to regenerate on each deploy in that case.

---

### Render

1. New **Web Service** → connect your repo
2. **Build Command:** `npm install && npm run build`
3. **Start Command:** `npm start`
4. Add env vars in the **Environment** tab
5. Free tier spins down after 15 min inactivity — first request after idle takes ~30s
6. For persistent storage: use a **Persistent Disk** (paid) mounted at `/data`

---

### VPS / Self-hosted

Full control. Cheapest for long-term.

```bash
# 1. Install Node.js 20 (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Clone and build
git clone https://github.com/paulfxyz/espresso.git /opt/espresso
cd /opt/espresso
npm install
npm run build

# 3. Create .env
mkdir -p /opt/espresso/data
cat > /opt/espresso/.env << EOF
OPENROUTER_KEY=sk-or-v1-...
ADMIN_KEY=your-secure-password
DB_PATH=/opt/espresso/data/espresso.db
PORT=3000
NODE_ENV=production
EOF

# 4. Systemd service
sudo tee /etc/systemd/system/espresso.service > /dev/null << EOF
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

# 5. Verify
curl http://localhost:3000/api/health
```

**Nginx reverse proxy** (for HTTPS):
```nginx
server {
    listen 443 ssl http2;
    server_name news.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/news.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/news.yourdomain.com/privkey.pem;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo certbot --nginx -d news.yourdomain.com
```

---

### Docker

```bash
# Build
docker build -t espresso .

# Run with persistent volume
docker run -d \
  --name espresso \
  -p 5000:5000 \
  -e OPENROUTER_KEY=sk-or-v1-... \
  -e ADMIN_KEY=your-password \
  -e DB_PATH=/data/espresso.db \
  -v espresso-data:/data \
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
      OPENROUTER_KEY: ${OPENROUTER_KEY}
      ADMIN_KEY: ${ADMIN_KEY}
      DB_PATH: /data/espresso.db
      NODE_ENV: production
    volumes:
      - espresso_data:/data
    restart: unless-stopped

volumes:
  espresso_data:
```

---

## Custom Domain (HTTPS)

### Fly.io custom domain

```bash
# Add the domain
fly certs add news.yourdomain.com --app your-app-name

# Get DNS instructions
fly certs setup news.yourdomain.com --app your-app-name
```

Add these DNS records at your registrar:

| Type | Name | Value |
|------|------|-------|
| `A` | `news` | (your Fly IPv4 — from `fly ips list`) |
| `AAAA` | `news` | (your Fly IPv6 — from `fly ips list`) |
| `TXT` | `_fly-ownership.news` | (from `fly certs setup` output) |

Check validation: `fly certs check news.yourdomain.com --app your-app-name`

SSL is auto-issued via Let's Encrypt. Propagation typically takes 5–30 minutes.

---

## Scheduling Daily Generation

### GitHub Actions (recommended — already included)

The workflow file `.github/workflows/daily-digest.yml` fires at **6:00 AM GMT** every day.

Add these secrets to your GitHub repo (**Settings → Secrets → Actions**):

| Secret | Value |
|--------|-------|
| `ESPRESSO_URL` | `https://news.yourdomain.com` |
| `ESPRESSO_ADMIN_KEY` | Your admin password |

**Optional:** set repo variable `AUTO_PUBLISH=true` to skip manual review and publish automatically.

Manual trigger: **Actions → Daily Morning Digest → Run workflow**

### System cron (VPS)

```bash
# crontab -e
# Fire at 6:00 AM UTC (adjust for your timezone)
0 6 * * * curl -s -X POST https://news.yourdomain.com/api/digest/generate \
  -H "x-admin-key: your-password" \
  >> /var/log/espresso.log 2>&1
```

---

## Submitting Links

### Admin panel

`/#/admin → Links` tab — paste a URL and press Add, or use bulk paste (one per line).

### REST API

```bash
# Single URL
curl -X POST https://news.yourdomain.com/api/links \
  -H "Content-Type: application/json" \
  -H "x-admin-key: your-password" \
  -d '{"url": "https://example.com/article"}'

# Multiple URLs at once
curl -X POST https://news.yourdomain.com/api/links \
  -H "Content-Type: application/json" \
  -H "x-admin-key: your-password" \
  -d '{"urls": ["https://...", "https://...", "https://..."]}'
```

### Apple Shortcuts (iOS Share Sheet)

1. Open **Shortcuts** → New Shortcut
2. Add: **Get URLs from input** (enables Share Sheet)
3. Add: **Get Contents of URL**
   - URL: `https://news.yourdomain.com/api/links`
   - Method: `POST`
   - Headers: `Content-Type: application/json`, `x-admin-key: your-password`
   - Body: JSON → `{"url": "[shortcut input]"}`
4. Add to Share Sheet

Share any Safari page directly into Espresso.

### Browser bookmarklet

Create a bookmark with this URL (replace values):
```javascript
javascript:(function(){fetch('https://news.yourdomain.com/api/links',{method:'POST',headers:{'Content-Type':'application/json','x-admin-key':'your-password'},body:JSON.stringify({url:location.href})}).then(r=>r.json()).then(()=>alert('☕ Saved to Espresso!'));})();
```

---

## Admin Panel

Visit `/#/admin`. Default password: `admin`.

**Overview tab** — stats, generate button, API reference  
**Links tab** — submit URLs (single or bulk), view/delete link history  
**Digest tab** — view all digests, expand stories, swap, publish/unpublish

**Change password:** red toolbar at top of admin → "Change password"  
**Log out:** red toolbar at top → "Log out"

---

## Changing the AI Model

Edit `server/pipeline.ts`:

```typescript
const DEFAULT_MODEL = "google/gemini-2.0-flash-001";
```

Recommended alternatives (all available on OpenRouter):

| Model | Speed | Quality | Cost/digest |
|-------|-------|---------|-------------|
| `google/gemini-2.0-flash-001` | Fast | Excellent | ~$0.02 |
| `anthropic/claude-3-haiku` | Fast | Great | ~$0.05 |
| `openai/gpt-4o-mini` | Fast | Great | ~$0.04 |
| `anthropic/claude-3.5-sonnet` | Medium | Best | ~$0.30 |
| `meta-llama/llama-3.1-70b` | Medium | Good | ~$0.01 |

---

## Security

- **Set a strong admin key** before exposing publicly — use `openssl rand -hex 32`
- **HTTPS is mandatory** in production — Fly/Railway/Render handle this automatically; use Certbot on VPS
- **SQLite file** is never served as a static asset — it's inside the container, not accessible via HTTP
- **Rate limiting** is not built in — add Nginx rate limiting if your API is public-facing
- **OpenRouter key** is stored in the SQLite config table, not in plaintext files

---

## Updating

```bash
# Pull latest
cd /opt/espresso  # or your project directory
git pull origin main

# Install any new dependencies
npm install

# Rebuild
npm run build

# Restart (systemd)
sudo systemctl restart espresso

# Or redeploy on Fly.io
fly deploy
```

Database migrations are automatic — `CREATE TABLE IF NOT EXISTS` runs on every startup. No separate migration step needed.

---

## Troubleshooting

**`admin` password not working**
```bash
# Reset via API (if you know the current password)
curl -X POST https://news.yourdomain.com/api/setup \
  -H "Content-Type: application/json" \
  -H "x-admin-key: current-password" \
  -d '{"adminKey": "admin"}'
```

**"No content available"**
No links submitted and RSS fetch failed. Test connectivity:
```bash
curl https://feeds.bbci.co.uk/news/world/rss.xml | head -5
```

**"OpenRouter error: 401"**
API key invalid or not set. Check `/#/admin → Overview → Configuration status`.

**"OpenRouter error: 404 — No endpoints found"**
Model slug is wrong. Check [openrouter.ai/models](https://openrouter.ai/models) for the correct identifier.

**"Published digest already exists"**
Unpublish today's digest from admin before regenerating.

**Blank page on load**
Open browser console for errors. Usually a build issue — run `npm run build` and check for TypeScript errors first.

**Database errors on first run**
Ensure `DB_PATH` directory exists and is writable:
```bash
mkdir -p $(dirname $DB_PATH)
chmod 755 $(dirname $DB_PATH)
```

**Fly.io: `app not found`**
Your `fly.toml` app name doesn't match the actual Fly app. Run `fly apps list` to see your real app name, then update `fly.toml`.

---

*For bugs and feature requests: [github.com/paulfxyz/cup-of-news/issues](https://github.com/paulfxyz/cup-of-news/issues)*
