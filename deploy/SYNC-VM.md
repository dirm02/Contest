# Keep local, GitHub, and the VM in sync

Your production VM serves **only the built frontend** from:

`/var/www/accountibilitymax/dist`

The hackathon backend API lives separately (today: `/var/www/AccountabilityMax-/general`).

Treat sync as **two tracks**: **frontend bundle** and **backend repo**.

---

## Track A — Frontend (`accountibilitymax-app`)

### 1. Local (source of truth)

```bash
cd accountibilitymax-app
npm ci
npm run build
git add -A && git commit -m "..." && git push
```

### 2. GitHub

- Ensure this app is in **its own repo** or a **monorepo path** you always push after changes.
- Never deploy by copying `node_modules`; only commit source + lockfile.

### 3. VM (publish new static files)

**Option A — app lives in a git clone on the VM** (recommended long term)

```bash
cd /path/to/accountibilitymax-app   # same repo as GitHub
git pull
npm ci
npm run build
sudo rsync -a --delete dist/ /var/www/accountibilitymax/dist/
# nginx serves files from disk; optional: sudo systemctl reload nginx
```

**Option B — no git for the app on the VM** (quick and dirty)

From your **laptop** (replace host and path):

```bash
npm run build
rsync -avz --delete dist/ azureuser@YOUR_VM_IP:/var/www/accountibilitymax/dist/
```

Or zip `dist/` and `scp` it, then unzip on the VM into `/var/www/accountibilitymax/dist/`.

---

## Track B — Backend (`agency-26-hackathon` / `AccountabilityMax-` on VM)

```bash
cd /var/www/AccountabilityMax-
git pull
cd general && npm install --omit=dev
sudo systemctl restart accountibilitymax-api
```

Ensure `general/.env` exists on the VM (not in git) with `DB_CONNECTION_STRING`.

---

## One habit that keeps everything aligned

1. **Commit + push** from local (frontend and/or backend repos).
2. **SSH to VM** → `git pull` each clone you use → **rebuild** what changed → **restart** API if backend changed → **rsync/copy** `dist/` if frontend changed.

---

## Optional: single `git pull` on the VM

Put `accountibilitymax-app` **inside** the hackathon repository (e.g. `agency-26-hackathon/web/accountibilitymax-app/`) so one `git pull` on `/var/www/AccountabilityMax-` updates both; add a small `Makefile` or script there that runs `npm run build` in the web folder and copies `dist/` to `/var/www/accountibilitymax/dist/`. That is a structural change—do it when you are ready.
