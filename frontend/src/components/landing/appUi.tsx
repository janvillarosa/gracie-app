import { Check, Plus } from '@phosphor-icons/react'
import { Avatar } from '@components/Avatar'

// Small copies of the app's own pieces (List page header, PillNav, the checkbox, category tags,
// the add bar), drawn at landing scale so the page shows the product as it really looks.

export const HOUSEMATES = ['Mia', 'Sam', 'Jo'] as const

/** The House's members, as the app draws them (the same avatar artwork, overlapped). */
export const Housemates: React.FC<{ size?: number }> = ({ size = 30 }) => (
  <span className="ld-mates" aria-hidden="true">
    {HOUSEMATES.map((name) => (
      <Avatar key={name} seed={name} size={size} alt="" className="ld-mate" />
    ))}
  </span>
)

/** The List page's header card: emoji in a circle, the list's name, a "N to get" line. */
export const ListHead: React.FC<{
  icon: string
  title: string
  meta: string
  as?: 'h2' | 'h3'
  mates?: boolean
}> = ({ icon, title, meta, as: Tag = 'h3', mates }) => (
  <div className="ld-app-head">
    <span className="ld-app-icon" aria-hidden="true">
      {icon}
    </span>
    <div className="ld-app-titles">
      <Tag className="ld-app-title">{title}</Tag>
      <p className="ld-app-meta">{meta}</p>
    </div>
    {mates && <Housemates />}
  </div>
)

/** PillNav, drawn: the selected tab is a white pill inside a soft track. */
export const Pills: React.FC<{ tabs: string[]; on: number; count?: number }> = ({
  tabs,
  on,
  count,
}) => (
  <span className="ld-pills" aria-hidden="true">
    {tabs.map((t, i) => (
      <span key={t} className={i === on ? 'ld-pill is-on' : 'ld-pill'}>
        {t}
        {i === 0 && count !== undefined && <span className="ld-pill-count">{count}</span>}
      </span>
    ))}
  </span>
)

/** The list checkbox: grey outline, yellow with an ink tick once checked. */
export const Box: React.FC<{ done?: boolean }> = ({ done }) => (
  <span className={done ? 'ld-box is-done' : 'ld-box'} aria-hidden="true">
    <Check weight="bold" />
  </span>
)

/** The add bar pinned to the bottom of a list: a soft pill field and a round add key. */
export const AddBarStill: React.FC<{ text?: string; placeholder: string; chip?: string }> = ({
  text,
  placeholder,
  chip,
}) => (
  <div className="ld-addbar is-still" aria-hidden="true">
    <span className="ld-addbar-field">
      {chip && <span className="ld-addbar-chip">{chip}</span>}
      {text ? (
        <span className="ld-addbar-text">
          {text}
          <span className="ld-caret" />
        </span>
      ) : (
        <span className="ld-addbar-placeholder">{placeholder}</span>
      )}
    </span>
    <span className={text ? 'ld-addbar-btn is-armed' : 'ld-addbar-btn'}>
      <Plus weight="bold" />
    </span>
  </div>
)
