import type { KirkRawDataset } from "../factorio"

// Fetches a raw Factorio dataset JSON from the parent repo's data/ dir.
// app/public/data is a symlink to ../../data, so Vite emits the dataset
// under ${BASE_URL}data/ for both dev (/app/data/) and prod project-page
// deploys (/<repo>/app/data/) — keep it relative to BASE_URL.
export async function loadDataset(filename: string): Promise<KirkRawDataset> {
  const url = `${import.meta.env.BASE_URL}data/${filename}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`)
  return (await res.json()) as KirkRawDataset
}
