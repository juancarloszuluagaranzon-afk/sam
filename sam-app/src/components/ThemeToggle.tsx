import { useTheme } from '../hooks/useTheme'

/**
 * Botón circular para alternar entre tema claro y oscuro.
 *
 * Diseño: en tema light muestra una luna (sugiere "cambiar a dark");
 * en tema dark muestra un sol (sugiere "cambiar a light").
 * Se renderiza solo dentro del menú lateral, junto a Cambiar PIN /
 * Diagnóstico. El estado real lo maneja el hook `useTheme`.
 */
export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'

  return (
    <div className="theme-toggle-row">
      <span className="theme-toggle-row__label">Tema</span>
      <button
        type="button"
        className="theme-toggle"
        onClick={toggle}
        title="Tema"
        aria-label={isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
      >
        {isDark ? <SunIcon /> : <MoonIcon />}
      </button>
    </div>
  )
}

function MoonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m4.93 19.07 1.41-1.41" />
      <path d="m17.66 6.34 1.41-1.41" />
    </svg>
  )
}
