import { useEffect, useLayoutEffect } from 'react'

/** useLayoutEffect in the browser. The landing page is also rendered to HTML at build time
 *  (scripts/prerender.mjs), where layout effects can't run and React warns about them. */
export const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect
