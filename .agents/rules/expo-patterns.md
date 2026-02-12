---
paths:
  - "app/**"
  - "components/**"
---
# Expo & React Native Patterns
- Use Expo Router for all navigation (never import from @react-navigation directly)
- Use React Native `Image` from `react-native` for all images (never `expo-image`)
- Use FlashList from @shopify/flash-list for long lists
- Use NativeWind className for styling, never StyleSheet.create
- Screens go in app/, reusable components in components/
- Use Expo Router's useLocalSearchParams for route params
- Tab icons use @expo/vector-icons
