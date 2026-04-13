---
applyTo: "app.json,app.config.*,app/**,components/**"
excludeAgent: "cloud-agent"
---

For Expo and React Native review:

- Focus on navigation correctness, platform compatibility, auth gating, and user-visible regressions.
- Do not suggest `StyleSheet.create`; this repo standard is NativeWind `className`.
- Do not suggest `expo-image` for app/component images; this repo uses `Image` from `react-native`.
- For long lists, prefer `FlashList` over `FlatList` when performance is relevant.
- For Expo config changes, verify claims against current Expo docs before flagging keys or formats.
- Distinguish root app background, splash background, adaptive icon background, and web manifest metadata; do not conflate them.
