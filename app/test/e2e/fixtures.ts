// Shared Playwright fixture — pins the theme, clears localStorage between
// tests (so e.g. profile-save in one test doesn't leak into another), and
// exposes a small page-helper API for navigating + driving the schematic
// without resorting to canvas coordinate fuzzing.

import { test as base, expect, type Page, type Locator } from "@playwright/test"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const ARTIFACT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "_artifacts",
)
export const shot = (name: string) => path.join(ARTIFACT_DIR, name)

/** Center of a known recipe's cell, in viewport coords. */
export interface CellAtFn {
  (recipeKey: string): { x: number; y: number } | null
}
/** Center of a belt carrying a known item, in viewport coords. */
export interface BeltAtFn {
  (item: string): { x: number; y: number } | null
}

export const test = base.extend<{
  /** Navigate to the app with theme pinned + storage cleared. */
  ready: void
  /** Helpers exposed by the in-page __schematic test hook. */
  schematic: {
    waitForCanvas(): Promise<Locator>
    cellAt(recipeKey: string): Promise<{ x: number; y: number }>
    beltAt(item: string): Promise<{ x: number; y: number } | null>
  }
}>({
  ready: [
    async ({ page }, use) => {
      // Theme MUST be pinned BEFORE the first navigation so the very first
      // paint sees the right values. addInitScript queues for every load
      // in this context, so subsequent reloads don't need to repeat it.
      await page.addInitScript(() => {
        localStorage.setItem("theme:name", JSON.stringify("catalyst"))
        localStorage.setItem("theme:variant", JSON.stringify("dark"))
      })
      await page.goto("/")
      // Now clear EVERY non-theme key so tests don't inherit each other's
      // schematic config, targets, inputs, profiles, etc. We keep the theme
      // keys so the dark/catalyst paint stays stable.
      await page.evaluate(() => {
        const themeKeys = new Set(["theme:name", "theme:variant"])
        for (const k of Object.keys(localStorage)) {
          if (!themeKeys.has(k)) localStorage.removeItem(k)
        }
      })
      // Reload so the cleared keys take effect before the test starts.
      await page.reload()
      await use()
    },
    { auto: true },
  ],

  schematic: async ({ page }, use) => {
    await use({
      async waitForCanvas() {
        const canvas = page.getByTestId("schematic-canvas")
        await expect(canvas).toBeVisible()
        await expect
          .poll(async () =>
            canvas.evaluate((c) => {
              const el = c as HTMLCanvasElement
              return el.width > 64 && el.height > 64
            }),
          )
          .toBe(true)
        return canvas
      },
      async cellAt(recipeKey: string) {
        // Wait for the test hook to be installed.
        const point = await page.waitForFunction(
          (key) => {
            const hook = (window as unknown as { __schematic?: { cellAt?: CellAtFn } })
              .__schematic
            return hook?.cellAt?.(key) ?? null
          },
          recipeKey,
          { timeout: 5_000 },
        )
        return point.jsonValue() as Promise<{ x: number; y: number }>
      },
      async beltAt(item: string) {
        const handle = await page.evaluateHandle(
          (key) => {
            const hook = (window as unknown as { __schematic?: { beltAt?: BeltAtFn } })
              .__schematic
            return hook?.beltAt?.(key) ?? null
          },
          item,
        )
        const v = await handle.jsonValue()
        return v as { x: number; y: number } | null
      },
    })
  },
})

/** Re-export expect so test files only need to import from this fixture. */
export { expect }

/** Open the schematic tab and wait for the canvas to be ready. */
export async function openSchematic(page: Page) {
  await page.getByTestId("tab-schematic").click()
  const canvas = page.getByTestId("schematic-canvas")
  await expect(canvas).toBeVisible()
  await expect
    .poll(async () =>
      canvas.evaluate((c) => {
        const el = c as HTMLCanvasElement
        return el.width > 64 && el.height > 64
      }),
    )
    .toBe(true)
}
