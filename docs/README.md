# ShowTracker Documentation

This directory is the durable project memory for agents and maintainers. It favors goals, current architecture, and decisions over old phase logs or one-off implementation plans.

## Start Here

| Doc | Purpose |
| --- | --- |
| [GOALS.md](GOALS.md) | Product direction, non-goals, and high-risk guardrails |
| [../CONTEXT.md](../CONTEXT.md) | Product vocabulary and naming rules |
| [DECISIONS.md](DECISIONS.md) | ADR index grouped by behavior area |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Current app/backend/reconciliation shape |
| [API.md](API.md) | External provider roles and normalized API policy |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Setup, commands, env, validation, and workflow notes |
| [BROWSER_AUTOMATION.md](BROWSER_AUTOMATION.md) | Browser tool choice and UI verification guidance |
| [SCHEDULE_CONFIDENCE.md](SCHEDULE_CONFIDENCE.md) | Release-state reconciliation goals and commands |

## Decisions

All `ADR-####-*.md` files are retained. They explain why risky behavior exists, especially around watchlist, schedule, release availability, provider matching, duplicate collapse, and Convex I/O.

Treat those ADRs as long-term memory. The recent Home/Schedule/release ADRs are intentionally preserved so future agents do not reopen settled fixes or repeat old loops around titles appearing or disappearing from Home.

Read [DECISIONS.md](DECISIONS.md) before changing those areas. Add a new ADR for any behavior-changing watchlist/schedule/release/provider/projection work.

## Removed From This Layer

Historical phase plans, handoff notes, progress logs, and superseded implementation plans are intentionally not kept here. When their reasoning still matters, it should be represented in `GOALS.md`, `SCHEDULE_CONFIDENCE.md`, or an ADR.
