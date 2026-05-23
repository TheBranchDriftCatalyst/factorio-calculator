import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "@thebranchdriftcatalyst/catalyst-ui"
// Static fallback for the theme tokens. ThemeProvider also injects at runtime,
// but a static import guarantees first-paint has the catalyst design tokens.
import "@thebranchdriftcatalyst/catalyst-ui/themes/catalyst"
import "./index.css"
import { App } from "./App"
import { StorageProvider } from "./storage"
import { initRotatingFavicon } from "./util/rotatingFavicon"

// Default to catalyst dark for first-time visitors. Subsequent loads honor
// whatever the user selected (persisted by ThemeProvider).
if (!localStorage.getItem("theme:name")) localStorage.setItem("theme:name", JSON.stringify("catalyst"))
if (!localStorage.getItem("theme:variant")) localStorage.setItem("theme:variant", JSON.stringify("dark"))

// Slow rotation across the 4 favicon variants (favicon-tl/tr/br/bl).
// No-op on reduced-motion preferences.
initRotatingFavicon()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <StorageProvider>
        <App />
      </StorageProvider>
    </ThemeProvider>
  </StrictMode>,
)
