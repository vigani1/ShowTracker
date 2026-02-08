/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        "brand-background": "#0b0f1a",
        "brand-surface": "#121a2b",
        "brand-primary": "#5b7cfa",
        "brand-text": "#e5e7eb"
      }
    },
  },
  plugins: [],
};
