import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        town: "#3b82f6",
        mafia: "#ef4444",
      },
    },
  },
  plugins: [],
};

export default config;
