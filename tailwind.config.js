/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "brand-background": "#0b0f1a",
        "brand-surface": "#121a2b",
        "brand-primary": "#5b7cfa",
        "brand-text": "#e5e7eb",
        "brand-light-background": "#f8fafc",
        "brand-light-surface": "#ffffff",
        "brand-light-text": "#111827"
      }
    },
  },
  plugins: [],
};
