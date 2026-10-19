import React from 'react'
import { CallBell, X } from '@phosphor-icons/react'
import { Checkbox } from 'antd'
import { Button } from '@components/ui'

type Props = {
  next: { itemId: string; name: string }
  /** The item that usually follows, if any. */
  thenName?: string
  onDone: (itemId: string) => void
  onHide: () => void
}

/** Up next: the item the House usually grabs next in the shop, as one slip above the list. It is
 *  autopilot's guess, so it wears autopilot's mark and says "Usually next". It lies on the list's
 *  sheet like the suggestion slip (same paper, same height) but has no key: nothing waits on a
 *  tap, and the page's one yellow key stays the suggestion's Add. Ticking checks the item off and
 *  the page hands the slip to the next pick in place; the round X waves it off for this run. */
export function UpNextSlip({ next, thenName, onDone, onHide }: Props) {
  return (
    <section className="upnext-slip" aria-label="Up next">
      <div className="upnext-row">
        <span className="upnext-check">
          <Checkbox
            checked={false}
            onChange={() => onDone(next.itemId)}
            aria-label={`${next.name}, done`}
          />
        </span>
        <div className="upnext-text">
          <span className="upnext-name" title={next.name}>
            {next.name}
          </span>
          <span className="upnext-why">
            <span className="upnext-mark" aria-hidden>
              <CallBell weight="bold" />
            </span>
            {thenName ? `Usually next · then ${thenName}` : 'Usually next'}
          </span>
        </div>
        {/* Announced politely when a tick hands the slip to the next pick. */}
        <span className="upnext-announce" role="status">
          Up next: {next.name}
        </span>
        <Button iconOnly title="Not now" aria-label="Hide up next" onClick={onHide}>
          <X size={18} aria-hidden />
        </Button>
      </div>
    </section>
  )
}
