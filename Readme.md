<p align="center">
  <img src="logo-dark.svg" alt="CH-Quantum Logo" width="120"/>
</p>

# 🚀 CH-Quantum Dashboard Pro (WayPro Edition)

> 🌍 Global AI-powered dashboard — build world-class apps/games fast.  
> PWA • Starters • Projects/Files • Marketing Tools • Auto-Deploy (Deno)

---

## 🌐 English

### Features
- Chat (TTS), Projects (offline export/import/ZIP), Files editor+preview
- Starters: UltraRealFootball, RocketChat, Portfolio, Landing
- Tools: UTM generator, shortener, newsletter (stub)
- Admin: health/version
- PWA offline (add to homescreen)

### Structure
### Quickstart
1) Upload to GitHub → branch `main`  
2) Deno Deploy → repo + branch `main` → **Entrypoint: `server.js`** → Deploy  
3) Open `/healthz`, `/version`, then use the dashboard (Projects/Files/Tools)

### Secrets (Deno → Project → Settings → ENV)
`RESEND_API_KEY`, `STRIPE_SECRET`, `PUSH_GATEWAY_URL` (optional)

### Workflow
Commit to `main` → auto-deploy. PR → Preview → Merge → Production. Rollback via Deployments → Promote.

---

## 🇵🇱 Polska

### Funkcje
- Chat (TTS), Projekty (offline eksport/import/ZIP), Pliki (edytor + podgląd)
- Startery: URF, RocketChat, Portfolio, Landing
- Narzędzia: generator UTM, shortener, newsletter (stub)
- Admin: zdrowie/wersja
- PWA offline (dodaj na ekran główny)

### Szybki start
1) Upload do GitHub (`main`)  
2) Deno Deploy → repo + `main` → **Entrypoint: `server.js`** → Deploy  
3) Test `/healthz` i `/version` → korzystaj z dashboardu

### Sekrety/ENV
`RESEND_API_KEY`, `STRIPE_SECRET`, `PUSH_GATEWAY_URL` (opcjonalnie)

### Rytm pracy
Commit do `main` → auto-deploy. PR → Preview → Merge → Produkcja. Rollback w Deployments → Promote.
