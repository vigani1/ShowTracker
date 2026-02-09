/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "brand-background": "#0f141d",
        "brand-surface": "#222a37",
        "brand-primary": "#d16042",
        "brand-text": "#f7efe2",
        "brand-light-background": "#e9ddca",
        "brand-light-surface": "#f8f0e2",
        "brand-light-text": "#251c13",
        "brand-ink": "#2e2316",
        "brand-ink-soft": "#6f5e4b",
        "brand-frame": "#2b2115",
        "brand-frame-light": "#d8c5a7",
        "brand-accent": "#2fb8ae",
      }
    },
  },
  plugins: [],
};
