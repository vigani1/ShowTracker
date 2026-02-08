---
paths:
  - "convex/**"
---
# Convex Backend Patterns
- All queries/mutations must validate user auth via ctx.auth.getUserIdentity()
- Use v.* validators for all function arguments
- One file per domain: shows.ts, users.ts, lists.ts, schedule.ts, stats.ts
- Use Convex actions (not queries) for external API calls
- Index all fields used in .filter() calls — prefer .withIndex() over .filter()
- Cache API data in Convex tables with lastUpdated timestamps
- Keep Convex functions small — extract shared logic to lib/ helpers
