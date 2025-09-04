import { useEffect } from 'react'

const BRAND_NAME = 'Bauhouse'

export function useDocumentTitle(title?: string) {
  useEffect(() => {
    const next = title && title.trim() ? `${title} - ${BRAND_NAME}` : BRAND_NAME
    if (typeof document !== 'undefined') {
      document.title = next
    }
  }, [title])
}

