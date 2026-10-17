import type React from 'react'
import './ui.css'

type Props = {
  /** The words of the stamp ("Run done"). */
  children: React.ReactNode
  /** A small line above them, as a dated stamp has ("Sat 17 Oct"). */
  note?: string
  className?: string
}

/** An inked rubber-stamp impression: green "done" ink in a double-ruled frame, set a little off true
 *  and pressed in once (reduced motion: it is simply there). The ink sits on the paper, so the grain
 *  shows through it. For a moment worth marking (a shopping run done), usually inside an announce
 *  Sheet; never as a control or a tag (that is `Stamp`). */
export const InkStamp: React.FC<Props> = ({ children, note, className }) => (
  <span className={['ui-ink-stamp', className ?? ''].filter(Boolean).join(' ')}>
    {note && <span className="ui-ink-stamp-note">{note}</span>}
    <span className="ui-ink-stamp-words">{children}</span>
  </span>
)
