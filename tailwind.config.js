/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Midnight Pulse - dark (primary experience)
        "bg-base": "#09090b",
        "bg-surface": "#18181b",
        "bg-elevated": "#27272a",
        "bg-hover": "#3f3f46",
        "border-default": "#27272a",
        "border-bright": "#3f3f46",
        // Signature accents
        primary: "#ef4444",
        "primary-glow": "#f97316",
        accent: "#38bdf8",
        "accent-dim": "#0ea5e9",
        success: "#34d399",
        warning: "#fbbf24",
        // Text
        "text-primary": "#fafafa",
        "text-secondary": "#a1a1aa",
        "text-muted": "#52525b",
      },
    },
  },
  plugins: [],
};
