# Development Guide

## Setup

```bash
npm install
```

Create local env files from `.env.example` as needed.

Common env values:

```text
EXPO_PUBLIC_TMDB_API_KEY
EXPO_PUBLIC_TMDB_READ_ACCESS_TOKEN
EXPO_PUBLIC_TMDB_BASE_URL
EXPO_PUBLIC_TVMAZE_BASE_URL
EXPO_PUBLIC_ANILIST_URL
EXPO_PUBLIC_CONVEX_URL
EXPO_PUBLIC_CONVEX_SITE_URL
```

## Running Locally

Useful local commands:

```bash
npm run start:web
npm start
npx convex dev
```

For delivery workflow, follow `AGENTS.md`. This doc is mostly command reference.

## Validation

Use the narrowest checks that prove the change.

```bash
npm run lint
npx tsc --noEmit --pretty false
git diff --check
```

Convex checks:

```bash
npx convex dev --once --typecheck enable --tail-logs disable
npx convex deploy --dry-run --yes
```

Production Convex deploy, when backend/schema/function behavior needs to ship:

```bash
npx convex deploy --yes
```

Schedule-confidence checks:

```bash
npm run schedule-confidence:validate
npm run schedule-confidence:dev:workflow
```

UI screenshot sweeps, when a running web app is available:

```bash
npm run ui:inspect:quick
npm run ui:inspect
```

## Browser Debugging

Use Chrome DevTools MCP first for web UI inspection, console/network debugging, screenshots, and visual polish. Use `agent-browser` for task-style flows such as login, guest mode, persistent auth, and route walkthroughs.

See `docs/BROWSER_AUTOMATION.md`.

## Schedule Confidence Workflow

The schedule-confidence reconciler is driven by `scripts/schedule-confidence.mjs`.

Useful commands:

```bash
npm run schedule-confidence:init
npm run schedule-confidence:import
npm run schedule-confidence:reconcile
npm run schedule-confidence:audit
npm run schedule-confidence:apply
npm run schedule-confidence:apply-projections
npm run schedule-confidence:compare-projections
npm run schedule-confidence:diagnose-projections
```

Local evidence is written under `.schedule-confidence/`, which is ignored.

## VPS Operations

Use `ssh showtracker-vps` for the private ShowTracker VPS. The schedule-confidence checkout lives at `/opt/showtracker`, and the production timer is `showtracker-schedule-confidence.timer`.

When the merged change needs the VPS checkout updated, use the existing repo deployment shape:

```bash
ssh showtracker-vps "cd /opt/showtracker && git fetch origin main && git reset --hard origin/main"
```

Useful VPS verification commands:

```bash
ssh showtracker-vps "cd /opt/showtracker && git rev-parse --short HEAD"
ssh showtracker-vps "systemctl list-timers showtracker-schedule-confidence.timer --no-pager"
ssh showtracker-vps "systemctl status showtracker-schedule-confidence.timer --no-pager"
ssh showtracker-vps "journalctl -u showtracker-schedule-confidence.service -n 120 --no-pager"
```

When a schedule/release fix needs to affect production immediately, run the service after syncing `main` if the session has permission:

```bash
ssh showtracker-vps "sudo systemctl start showtracker-schedule-confidence.service"
ssh showtracker-vps "journalctl -u showtracker-schedule-confidence.service -n 160 --no-pager"
```

The timer's service script also hard-resets `/opt/showtracker` to `origin/main` before each scheduled schedule-confidence run.

## Common Rules

- Use `@/` absolute imports where the repo does.
- Keep provider API access in `lib/api/*` or Convex actions.
- Keep user-owned synced state in Convex.
- Add an ADR for watchlist/schedule/release/provider/projection behavior changes.
- Do not use docs as proof of current behavior when code and docs disagree; inspect code and propose a doc fix.
