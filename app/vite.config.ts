import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// The new React app lives at /app/ when deployed, so the original
// kirkmcdonald.github.io/calc.html stays untouched at root.
export default defineConfig({
  base: "/app/",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5179,
    fs: {
      // Allow Vite to serve the parent repo's data/ via symlinks in public/.
      allow: [".."],
    },
  },
})
