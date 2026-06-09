import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        // Engraved serif for headings/role names; clean sans for body.
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      colors: {
        // Noir palette: ink & smoke, bone, candlelight gold, blood, moonlight steel.
        ink: {
          900: "#0a0807",
          800: "#110e0b",
          700: "#16120e",
          600: "#1e1812",
        },
        bone: "#e7e1d4",
        gold: {
          DEFAULT: "#c9a24a",
          soft: "#dcc183",
          deep: "#8a6d28",
        },
        blood: {
          DEFAULT: "#a31d1d",
          soft: "#c5494b",
          deep: "#6e1212",
        },
        steel: {
          DEFAULT: "#7d97a6",
          soft: "#aabfc9",
          deep: "#2a3942",
        },
        // Team logic still references these.
        town: "#7d97a6",
        mafia: "#a31d1d",
      },
    },
  },
  plugins: [],
};

export default config;
