import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        gold: {
          DEFAULT: "#c9a84c",
          dim: "rgba(201, 168, 76, 0.25)",
          subtle: "rgba(201, 168, 76, 0.08)",
          bright: "#e0bf6a",
        },
        obsidian: {
          DEFAULT: "#0a0a0a",
          light: "#111111",
          mid: "#1a1a1a",
        },
        cream: "#ededed",
      },
      fontFamily: {
        serif: ["Georgia", "Cambria", "'Times New Roman'", "serif"],
        display: ["'Cormorant Garamond'", "Georgia", "serif"],
      },
      letterSpacing: {
        widest: "0.4em",
        wider: "0.25em",
        wide: "0.15em",
      },
      animation: {
        "fade-in-up": "fadeInUp 1.2s ease forwards",
        "fade-in": "fadeIn 1.5s ease forwards",
        "line-grow": "lineGrow 1s ease forwards",
        shimmer: "shimmer 3s ease-in-out infinite",
      },
      keyframes: {
        fadeInUp: {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        lineGrow: {
          "0%": { width: "0%" },
          "100%": { width: "100%" },
        },
        shimmer: {
          "0%, 100%": { opacity: "0.6" },
          "50%": { opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
