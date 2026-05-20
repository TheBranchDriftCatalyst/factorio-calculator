import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["test/unit/**/*.test.ts", "test/unit/**/*.test.tsx", "test/integration/**/*.test.tsx"],
    exclude: ["test/e2e/**", "node_modules/**"],
  },
})
