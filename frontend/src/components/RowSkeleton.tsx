import React from 'react'

type Props = {
  // 'list': a house-page list row (sticker, name, description).
  // 'item': a list-page item row (checkbox, text, category tag).
  variant: 'list' | 'item'
  rows: number
  label: string
}

// Placeholder rows drawn to the real rows' geometry, so the sheet keeps roughly its final
// size and the content settles in place instead of pushing the page around.
export const RowSkeleton: React.FC<Props> = ({ variant, rows, label }) => (
  <div className={`row-skeleton row-skeleton-${variant}`} role="status" aria-label={label}>
    {Array.from({ length: rows }, (_, i) => (
      // Widths vary per row so the placeholder reads as text, not a grid
      <div
        key={i}
        className="sk-row"
        style={{ '--sk-w': `${[62, 48, 70, 54][i % 4]}%` } as React.CSSProperties}
      >
        <span className="sk-lead" />
        <span className="sk-lines">
          <span className="sk-bar" />
          {variant === 'list' && <span className="sk-bar sk-bar-sub" />}
        </span>
        {variant === 'item' && <span className="sk-tag" />}
      </div>
    ))}
  </div>
)
