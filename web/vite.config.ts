import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The website is built into web/dist, which Vercel serves next to the bot's
// /api functions (see vercel.json). `pnpm dev` proxies /api to a running
// `vercel dev` on port 3000.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { "/api": "http://localhost:3000" } },
});
