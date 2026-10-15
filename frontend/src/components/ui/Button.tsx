import React from 'react'
import './ui.css'

type Common = {
  // key: the one yellow action. quiet: a paper pill for a secondary action. text: an inline action.
  kind?: 'key' | 'quiet' | 'text'
  // Red text (a text button only): Delete.
  danger?: boolean
  block?: boolean
  icon?: React.ReactNode
  // Icon only (a close key, a trash can): a round 36px control with a 44px hit area.
  iconOnly?: boolean
  className?: string
}

type ButtonProps = Common &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & { href?: undefined }
type LinkProps = Common &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'className'> & { href: string }

const cls = ({ kind = 'quiet', danger, block, iconOnly, className }: Common) =>
  [
    'ui-btn',
    `is-${kind}`,
    danger ? 'is-danger' : '',
    block ? 'is-block' : '',
    iconOnly ? 'is-icon' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

/** The three buttons: a yellow key, a quiet paper pill, an inline text action (red when it
 *  deletes). Nothing else is a button in the trip screens. With `href` it is a link that looks
 *  the same (Open Maps). */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps | LinkProps>(
  function Button(props, ref) {
    const { kind, danger, block, iconOnly, icon, className, children, ...rest } = props
    const c = cls({ kind, danger, block, iconOnly, className })
    if ('href' in rest && rest.href !== undefined) {
      return (
        <a
          ref={ref as unknown as React.Ref<HTMLAnchorElement>}
          className={c}
          {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
        >
          {icon}
          {children}
        </a>
      )
    }
    const { type = 'button', ...btn } = rest as React.ButtonHTMLAttributes<HTMLButtonElement>
    return (
      <button ref={ref} type={type} className={c} {...btn}>
        {icon}
        {children}
      </button>
    )
  },
)
