import { useTheme } from '../hooks/useTheme'

/**
 * Botón circular para alternar entre tema claro y oscuro.
 *
 * Variante `header` (default): se renderiza en la barra verde superior,
 * con fondo translúcido sobre el brand, icono blanco. Es el mismo
 * estilo visual que el botón hamburguesa.
 *
 * Variante `sidebar`: se renderiza dentro del menú lateral con una
 * fila etiquetada "Tema" — mantenida por si se quiere volver a usar.
 */
export function ThemeToggle({ variant = 'header' }: { variant?: 'header' | 'sidebar' }) {
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'
  const label = isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'
  const Icon = isDark ? SunIcon : MoonIcon

  if (variant === 'sidebar') {
    return (
      <div className="theme-toggle-row">
        <span className="theme-toggle-row__label">Tema</span>
        <button
          type="button"
          className="theme-toggle theme-toggle--sidebar"
          onClick={toggle}
          title="Tema"
          aria-label={label}
        >
          <Icon />
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      className="theme-toggle theme-toggle--header"
      onClick={toggle}
      title="Tema"
      aria-label={label}
    >
      <Icon />
    </button>
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
