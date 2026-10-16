import type React from 'react'
import { Fragment, useEffect, useRef, useState } from 'react'

type Tone = 'red' | 'blue' | 'mark'

/** True once the element has come on screen (and stays true): the moment a heading is set. */
export function useSetOnScreen(ref: React.RefObject<HTMLElement | null>): boolean {
  const [set, setSet] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return setSet(true)
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSet(true)
          io.disconnect()
        }
      },
      { rootMargin: '0px 0px -12% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [ref])
  return set
}

/** A heading set like Bauhaus printed matter: broken across `lines`, one word (`accent`) in a
 *  primary colour or on the highlighter, a thick rule above it. As it comes on screen its words
 *  slide up into their lines one after another and stop, as if set by hand. The words are plain
 *  spans inside the heading, so it reads as one sentence; without JavaScript or with reduced
 *  motion it is simply set. */
export const SetWords: React.FC<{
  as?: 'h2' | 'h3'
  id?: string
  className?: string
  lines: string[]
  accent?: { word: string; tone: Tone }
}> = ({ as: Tag = 'h2', id, className, lines, accent }) => {
  const ref = useRef<HTMLHeadingElement>(null)
  const set = useSetOnScreen(ref)

  let i = 0
  return (
    <Tag
      ref={ref}
      id={id}
      className={['ld-set', className].filter(Boolean).join(' ')}
      data-set={set ? '' : undefined}
    >
      {lines.map((line, l) => (
        <span key={line} className="ld-set-line">
          {line.split(' ').map((word, w) => {
            const n = i++
            const bare = word.replace(/[.,!?]$/, '')
            const tone = accent && bare === accent.word ? ` is-${accent.tone}` : ''
            return (
              <Fragment key={`${word}-${w}`}>
                <span className="ld-w">
                  <span className={`ld-w-in${tone}`} style={{ '--i': n } as React.CSSProperties}>
                    {word}
                  </span>
                </span>{' '}
              </Fragment>
            )
          })}
          {l < lines.length - 1 && ' '}
        </span>
      ))}
    </Tag>
  )
}
