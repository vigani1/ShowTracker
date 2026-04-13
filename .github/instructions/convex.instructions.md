---
applyTo: "convex/**"
excludeAgent: "cloud-agent"
---

For Convex review:

- Prioritize auth checks, argument validation, and data exposure risks.
- Queries and mutations should validate user identity where appropriate.
- Function args should use Convex validators.
- External API calls belong in actions, not queries or mutations.
- Prefer indexed queries over broad filtering when indexes exist.
- Flag user-visible consistency issues, stale-data risks, or normalized-type mismatches.
