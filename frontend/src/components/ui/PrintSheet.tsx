import type React from 'react'
import { useEffect, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { HouseMark } from '../HouseMark'
import './ui.css'

// Printed on the closing line, which is what browsers without page-margin footers (Safari) show.
export const SITE_URL = 'bauhouse.app'

export type PrintFact = { label: string; value: string }

type Props = {
  // What kind of document it is, in small caps beside the mark ("Travel itinerary").
  kicker: string
  // The document's name on paper ("Groceries", "Lisbon & Porto").
  title: string
  // One muted line under it ("6 to get").
  meta?: string
  // A summary under the title: label and value pairs, two to a row.
  facts?: PrintFact[]
  children: React.ReactNode
}

/** True between the browser's beforeprint and afterprint (the menu's Print, Cmd+P, the share
 *  sheet's Print). The update is flushed at once so the sheet is in the page before it is laid out. */
export function usePrinting(): boolean {
  const [printing, setPrinting] = useState(false)
  useEffect(() => {
    const on = () => flushSync(() => setPrinting(true))
    const off = () => setPrinting(false)
    window.addEventListener('beforeprint', on)
    window.addEventListener('afterprint', off)
    return () => {
      window.removeEventListener('beforeprint', on)
      window.removeEventListener('afterprint', off)
    }
  }, [])
  return printing
}

/** Renders its children only while printing, so nothing print-only sits in the screen's DOM or
 *  costs a render between prints. */
export const PrintOnly: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  usePrinting() ? children : null

/** A string as a CSS string literal's contents: quotes and backslashes escaped, line breaks gone. */
export const cssString = (s: string) =>
  s
    .replace(/[\\"]/g, '\\$&')
    .replace(/[\r\n\f]+/g, ' ')
    .slice(0, 90)

/** The page footer as an @page rule (Chrome, Edge): the title on the left, the site and the page
 *  count on the right. */
export const pageFooter = (title: string, site: string) =>
  `@page { @bottom-left { content: "${cssString(title)}"; } @bottom-right { content: "${cssString(site)}  ·  Page " counter(page) " of " counter(pages); } }`

/** What a page prints, laid out as a document (wrap it in PrintOnly): the Bauhouse mark and the kind
 *  of document, a thick rule with a yellow tip, the title and its summary, the body, and a closing
 *  line. The page footer (title on the left, the site and "Page 1 of 3" on the right) is drawn by the browser in
 *  the page margin where it supports that (Chrome, Edge); elsewhere the closing line stands in.
 *  It sits beside the app's root rather than inside the screen's layout, so desks, scroll shells,
 *  maps and add bars never reach the paper; the print stylesheet hides everything else. */
export const PrintSheet: React.FC<Props> = ({ kicker, title, meta, facts, children }) => {
  // The site's own address (no path): the trip or list link opens only behind a sign-in.
  const site = window.location.host
  return createPortal(
    <section className="print-sheet">
      <style>{pageFooter(title, site)}</style>
      <header className="print-masthead">
        <span className="print-brand">
          <HouseMark size={30} />
          Bauhouse
        </span>
        <p className="print-kicker">{kicker}</p>
      </header>
      <div className="print-rule" aria-hidden />
      <h1 className="print-title">{title}</h1>
      {meta && <p className="print-meta">{meta}</p>}
      {facts && facts.length > 0 && (
        <dl className="print-facts">
          {facts.map((f) => (
            <div key={f.label} className="print-fact">
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {children}
      <p className="print-foot">Prepared with Bauhouse · {SITE_URL}</p>
    </section>,
    document.body,
  )
}
