import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// Ambient declaration to avoid pulling in @types/node just for the env
// read below. Vite runs this file under Node so `process` exists at runtime.
declare const process: { env: Record<string, string | undefined> }

// The new React app lives at /app/ when deployed, so the original
// kirkmcdonald.github.io/calc.html stays untouched at root.
// VITE_BASE override lets project-page deploys (e.g.
// thebranchdriftcatalyst.github.io/factorio-calculator/) prefix the path.
export default defineConfig({
  base: process.env.VITE_BASE || "/app/",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5179,
    fs: {
      // Allow Vite to serve the parent repo's data/ via symlinks in public/.
      allow: [".."],
    },
  },
})
