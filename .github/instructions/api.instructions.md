---
applyTo: "lib/api/**"
excludeAgent: "cloud-agent"
---

For external API client review:

- Focus on normalization correctness, error handling, retries/rate limits, and secret handling.
- Raw provider responses should not leak into components.
- API keys must come from environment/config, never be hardcoded.
- Flag missing handling for failed or partial upstream responses when it can corrupt downstream state.
