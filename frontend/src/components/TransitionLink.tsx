import React from 'react'
import { Link } from 'react-router-dom'
import type { LinkProps } from 'react-router-dom'
import { useTransitionNavigate } from '@lib/viewTransition'

// A Link that navigates through a view transition. Modified clicks (new tab, etc.)
// and non-string targets keep the browser's default behavior.
export const TransitionLink: React.FC<LinkProps> = ({ onClick, to, replace, ...rest }) => {
  const go = useTransitionNavigate()
  return (
    <Link
      to={to}
      replace={replace}
      {...rest}
      onClick={(e) => {
        onClick?.(e)
        if (
          e.defaultPrevented ||
          e.button !== 0 ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey
        )
          return
        if (rest.target && rest.target !== '_self') return
        e.preventDefault()
        go(to, { replace })
      }}
    />
  )
}
