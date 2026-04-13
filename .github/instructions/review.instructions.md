---
applyTo: "**"
excludeAgent: "cloud-agent"
---

When performing code review in this repository, prioritize correctness, regressions, data consistency, auth safety, and platform-specific breakage over style commentary.

Only leave comments when there is a concrete bug, invalid configuration, broken assumption, missing validation, compatibility issue, or likely behavioral regression. Avoid praise, summaries, or speculative nitpicks unless they materially affect maintainability or user-visible behavior.

This is an Expo React Native + Web app backed by Convex. Prefer small, accurate findings grounded in the changed code and repository context.

Key project expectations:
- UI code uses NativeWind `className`; do not suggest `StyleSheet.create`.
- App and component images should use `Image` from `react-native`, not `expo-image`.
- Components should stay presentational; business logic belongs in hooks, lib, or Convex layers.
- External API access should go through `lib/api/*` clients, not directly from screens/components.
- User-synced data should go through Convex, not ad hoc local-only persistence.
- TypeScript is strict; flag unsafe `any`, swallowed errors, or untyped external data flow.

For app config and platform metadata changes, verify suggestions against current Expo documentation before flagging keys or formats as invalid.

If a changed file is an asset or generated binary, only comment when there is a concrete repository or platform integration issue visible from surrounding config.
