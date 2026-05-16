# Documentation

Agent-first documentation for ShowTracker.

## Core Docs

| Doc | Purpose |
|-----|---------|
| **[ARCHITECTURE.md](ARCHITECTURE.md)** | System design, data flow, Convex schema |
| **[ROADMAP.md](ROADMAP.md)** | Implementation phases and feature breakdown |
| **[API.md](API.md)** | External API reference (TMDB, AniList, TVMaze, Jikan) |
| **[DEVELOPMENT.md](DEVELOPMENT.md)** | Setup, environment variables, dev workflow |
| **[QUALITY.md](QUALITY.md)** | Performance, loading states, error handling, fallbacks |
| **[WATCHING.md](WATCHING.md)** | Watch actions, status automation, testing checklist |
| **[CONVEX_BANDWIDTH_OWNERSHIP_PLAN.md](CONVEX_BANDWIDTH_OWNERSHIP_PLAN.md)** | End-to-end plan to reduce Convex reads while preserving Home/Upcoming behavior |

## Architecture Decisions

| ADR | Decision |
|-----|----------|
| **[ADR-0001-overlay-detail-routes.md](ADR-0001-overlay-detail-routes.md)** | Show details use Overlay Detail Routes for in-app navigation while keeping direct URLs full-page |
| **[ADR-0002-watchlist-schedule-cache-bridge.md](ADR-0002-watchlist-schedule-cache-bridge.md)** | Home uses same-day schedule cache facts as watchlist attention while keeping provider matching conservative |
| **[ADR-0003-tracked-metadata-refresh-cost-gate.md](ADR-0003-tracked-metadata-refresh-cost-gate.md)** | Tracked detail metadata refresh skips broad user-library aggregate repair while preserving show-level projection refresh |
| **[ADR-0004-tracked-ids-projection-read.md](ADR-0004-tracked-ids-projection-read.md)** | Discover and Recommendations read tracked identity state from feed projections instead of N+1 show hydration |

## Testing

| Doc | Purpose |
|-----|---------|
| **[testing/E2E_QA_MATRIX.md](testing/E2E_QA_MATRIX.md)** | Comprehensive E2E test matrix for QA |
| **[testing/AGENT_BROWSER_TESTING_PLAYBOOK.md](testing/AGENT_BROWSER_TESTING_PLAYBOOK.md)** | Agent-browser workflow, best practices, and full user-flow coverage checklist |

## Quick Reference

**For new agents:**
1. Read [ARCHITECTURE.md](ARCHITECTURE.md) for system overview
2. Check [DEVELOPMENT.md](DEVELOPMENT.md) for setup commands
3. Review [ROADMAP.md](ROADMAP.md) for current phase context

**For feature work:**
- API changes → [API.md](API.md)
- UI/UX changes → [QUALITY.md](QUALITY.md)
- Watch tracking changes → [WATCHING.md](WATCHING.md)

**For testing:**
- Use [testing/E2E_QA_MATRIX.md](testing/E2E_QA_MATRIX.md) for comprehensive QA
- Use [testing/AGENT_BROWSER_TESTING_PLAYBOOK.md](testing/AGENT_BROWSER_TESTING_PLAYBOOK.md) for robust browser automation execution and user-flow coverage
- Use [WATCHING.md](WATCHING.md) for watch action testing
