# Convex Backend

This directory contains ShowTracker's Convex schema, auth, functions, scheduled jobs, and HTTP endpoints.

Domain files:

- `shows.ts`: show metadata, tracking, Home feeds, Library, anime relations, import/reset, watch actions, and repair tools.
- `schedule.ts`: schedule cache, Home schedule signals, projected schedule reads, and future count reads.
- `scheduleConfidence.ts`: token-protected boundary for the SQLite schedule-confidence reconciler.
- `lists.ts`: custom list mutations and queries.
- `stats.ts`: profile, stats, favorites, and watch history.
- `schema.ts`: Convex tables and indexes.

Use `npx convex dev` from the project root to push functions and regenerate Convex types.

Do not put external provider calls in queries or mutations. Use actions for external I/O, validate args with `v.*`, and validate auth before returning user-owned data.
