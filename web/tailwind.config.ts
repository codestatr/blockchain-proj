import type { Config } from "tailwindcss";
const config: Config = { content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"], theme: { extend: { colors: { ink: "#17352d", leaf: "#287a57", mint: "#e9f5ee", paper: "#f7f8f4" }, boxShadow: { card: "0 12px 36px rgba(26, 65, 47, .07)" } } }, plugins: [] };
export default config;
