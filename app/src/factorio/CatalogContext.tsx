// React context providing the loaded `Catalog` to any descendant without
// prop-drilling. The Catalog is read-only (loaded once at app start and
// never mutated by consumers), so a single Context value is sufficient.
//
// `useCatalog()` throws when no provider is present — loud failure is
// preferable to silently rendering with a default empty catalog, which
// would produce confusing "missing item" UI rather than a stack trace
// pointing at the misconfigured tree.

import { createContext, useContext, type ReactNode } from "react"
import type { Catalog } from "./types"

const CatalogContext = createContext<Catalog | null>(null)

export function CatalogProvider({
  value,
  children,
}: {
  value: Catalog
  children: ReactNode
}) {
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
}

export function useCatalog(): Catalog {
  const ctx = useContext(CatalogContext)
  if (ctx === null) {
    throw new Error(
      "useCatalog() called outside of <CatalogProvider>. Wrap the consuming tree in <CatalogProvider value={catalog}>.",
    )
  }
  return ctx
}
