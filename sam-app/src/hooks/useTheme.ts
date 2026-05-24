import { useEffect, useState, useCallback } from 'react'

/**
 * Toggle de tema claro/oscuro para SAM.
 *
 * - Lee la preferencia inicial de localStorage; si no hay, usa
 *   `prefers-color-scheme` del sistema (solo la primera vez).
 * - Aplica `data-theme` a <html> para que las variables CSS de
 *   index.css y los overrides de App.css apliquen.
 * - Persiste cada cambio en localStorage.
 *
 * El anti-flash inicial se ejecuta antes de React en index.html
 * para que la primera pintura ya tenga el atributo correcto.
 */

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'sam:theme'

function readStoredTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    if (value === 'light' || value === 'dark') return value
  } catch {
    /* localStorage bloqueado (modo incógnito en algunos navegadores) */
  }
  return null
}

function readSystemTheme(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function readInitialTheme(): Theme {
  return readStoredTheme() ?? readSystemTheme()
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      window.localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      /* localStorage bloqueado: solo aplica al runtime actual */
    }
  }, [theme])

  const toggle = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }, [])

  return { theme, toggle, setTheme }
}
