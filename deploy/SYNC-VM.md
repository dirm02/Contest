# Keep local, GitHub, and the VM in sync

Your production VM serves **only the built frontend** from:

`/var/www/Contest/dist`

The hackathon backend API lives separately (today: `/var/www/AccountabilityMax-/general`).

Treat sync as **two tracks**: **frontend bundle** and **backend repo**.

---

## Track A — Frontend (`Contest`)

### 1. Local (source of truth)

```bash
cd Contest
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
cd /path/to/Contest   # same repo as GitHub
git pull
npm ci
npm run build
sudo rsync -a --delete dist/ /var/www/Contest/dist/
# nginx serves files from disk; optional: sudo systemctl reload nginx
```

**Option B — no git for the app on the VM** (quick and dirty)

From your **laptop** (replace host and path):

```bash
npm run build
rsync -avz --delete dist/ azureuser@YOUR_VM_IP:/var/www/Contest/dist/
```

Or zip `dist/` and `scp` it, then unzip on the VM into `/var/www/accountibilitymax/dist/`.

### Windows (no `rsync`): `scp` + SSH key

If `azureuser` cannot write `/var/www/...` directly, upload to `/tmp` then move with `sudo` on the VM.

1. Use your deploy key (example path):

   `%USERPROFILE%\.ssh\id_ed25519_accountibilitymax`

2. After `npm run build`:

   ```powershell
   scp -i $env:USERPROFILE\.ssh\id_ed25519_accountibilitymax -r dist/* azureuser@YOUR_VM_IP:/tmp/contest-dist-new/
   ```

3. On the VM (or one SSH line):

   ```bash
   sudo rm -rf /var/www/Contest/dist/*
   sudo cp -a /tmp/contest-dist-new/. /var/www/Contest/dist/
   sudo chown -R www-data:www-data /var/www/Contest/dist
   rm -rf /tmp/contest-dist-new
   ```

Optional `~/.ssh/config` host block:

```
Host prod3-contest
  HostName YOUR_VM_IP
  User azureuser
  IdentityFile ~/.ssh/id_ed25519_accountibilitymax
```

Then: `scp -r dist/* prod3-contest:/tmp/contest-dist-new/`

---

## One-command deploy (recommended)

Use the new script from `Contest/deploy/deploy-prod3.ps1`.

```powershell
cd C:\Users\LocalAccountHPT25\Desktop\newsaas\Contest
powershell -ExecutionPolicy Bypass -File .\deploy\deploy-prod3.ps1
```

What it does:
- builds frontend (`npm run build`)
- uploads `dist` to VM temp path
- publishes to `/var/www/Contest/dist`
- syncs backend `general/visualizations/server.js` to VM
- restarts `accountibilitymax-api`
- runs quick health checks (API root + governance pairs)

Useful flags:

```powershell
# Skip frontend build (if dist already built)
powershell -ExecutionPolicy Bypass -File .\deploy\deploy-prod3.ps1 -SkipBuild

# Frontend-only deploy (no backend file sync/restart)
powershell -ExecutionPolicy Bypass -File .\deploy\deploy-prod3.ps1 -SyncBackend:$false
```

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

Put `Contest` **inside** the hackathon repository (e.g. `agency-26-hackathon/web/Contest/`) so one `git pull` on `/var/www/AccountabilityMax-` updates both; add a small `Makefile` or script there that runs `npm run build` in the web folder and copies `dist/` to `/var/www/Contest/dist/`. That is a structural change—do it when you are ready.
