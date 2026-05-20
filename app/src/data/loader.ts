import type { KirkRawDataset } from "../factorio"

// Fetches a raw Factorio dataset JSON from the parent repo's data/ dir.
// Dev: app/public/data is a symlink to ../../data, served at /app/data/.
// Prod: app deploys at /app/ on kirkmcdonald.github.io, data lives at /data/.
export async function loadDataset(filename: string): Promise<KirkRawDataset> {
  const base = import.meta.env.DEV ? import.meta.env.BASE_URL : "/"
  const url = `${base}data/${filename}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`)
  return (await res.json()) as KirkRawDataset
}
