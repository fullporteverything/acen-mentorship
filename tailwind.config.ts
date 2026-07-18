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
        burgundy: {
          DEFAULT: "#E8A0A0",
          bright: "#F0B0B0",
          dim: "rgba(232, 160, 160, 0.3)",
          subtle: "rgba(232, 160, 160, 0.08)",
          deep: "#8A5A5A",
        },
        void: {
          DEFAULT: "#000000",
          light: "#000000",
          mid: "#000000",
        },
        cream: "#F5F0F0",
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
