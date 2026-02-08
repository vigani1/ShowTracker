---
paths:
  - "lib/api/**"
---
# API Integration Rules
- All API clients must return NormalizedShow/NormalizedEpisode types from lib/api/types.ts
- Never expose raw API responses to components
- Handle rate limits: retry with backoff for 429 responses
- TMDB images: construct URLs as `https://image.tmdb.org/t/p/{size}{path}`
- AniList: use GraphQL, request only needed fields
- TVMaze: no auth needed, CORS enabled for direct browser use
- Store API keys in environment variables, never hardcode
- All fetches must have error handling with typed error responses
