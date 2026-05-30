// Renders a single 32×32 sprite from the active Factorio sprite sheet.
// app/public/images is a symlink to ../../images, so Vite emits the sheet
// under ${BASE_URL}images/ for both dev and prod deploys.

import type { Catalog } from "../factorio"

interface Props {
  catalog: Catalog
  iconCol: number
  iconRow: number
  size?: number // px (rendered), default 32
  title?: string
  className?: string
}

function sheetUrl(hash: string): string {
  return `${import.meta.env.BASE_URL}images/sprite-sheet-${hash}.png`
}

export function Icon({ catalog, iconCol, iconRow, size = 32, title, className }: Props) {
  const { hash, width, height, cell } = catalog.sprites
  const scale = size / cell
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      className={`inline-block align-middle shrink-0 ${className ?? ""}`}
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${sheetUrl(hash)})`,
        backgroundPosition: `${-iconCol * size}px ${-iconRow * size}px`,
        backgroundSize: `${width * scale}px ${height * scale}px`,
        backgroundRepeat: "no-repeat",
        imageRendering: "pixelated",
      }}
    />
  )
}

// Convenience: render the icon for an item key, given the catalog.
interface ItemIconProps {
  catalog: Catalog
  itemKey: string
  size?: number
  className?: string
}

export function ItemIcon({ catalog, itemKey, size = 24, className }: ItemIconProps) {
  const item = catalog.items.get(itemKey)
  if (!item) return null
  return (
    <Icon
      catalog={catalog}
      iconCol={item.iconCol}
      iconRow={item.iconRow}
      size={size}
      title={item.name}
      className={className}
    />
  )
}
