import { useMemo, useRef, useState, type FormEvent } from 'react'
import logoAgromorales from '../assets/logo-agromorales.jpeg'
import type { UserProfile } from '../domain/sam'

interface Props {
  users: UserProfile[]
  onLogin: (userId: string, pin: string) => Promise<void>
  loading: boolean
  error: string
}

// Caracteres mínimos antes de sugerir, y tope de sugerencias visibles.
const MIN_CHARS_SUGERENCIA = 2
const MAX_SUGERENCIAS = 8

// Resuelve el texto que el usuario tecleo al ID del usuario que mejor coincida.
// Acepta: el ID directo ("U001"), el nombre completo ("Cristhian Morales"),
// o un fragmento del nombre que sea unico. Si nada matchea, devolvemos el
// input tal cual para que el RPC del servidor falle con el error normal de
// "credenciales invalidas" en lugar de quedarnos varados aqui.
function resolveUserId(input: string, users: UserProfile[]): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  const upper = trimmed.toUpperCase()
  const lower = trimmed.toLowerCase()

  // Match exacto por ID (insensitive)
  const byId = users.find((u) => u.id.toUpperCase() === upper)
  if (byId) return byId.id

  // Match exacto por nombre completo (insensitive)
  const byName = users.find((u) => u.name.toLowerCase() === lower)
  if (byName) return byName.id

  // Match parcial unico por nombre (si exactamente UNA persona contiene el texto)
  const partial = users.filter((u) => u.name.toLowerCase().includes(lower))
  if (partial.length === 1) return partial[0].id

  // Fallback: dejamos pasar lo que sea para que el servidor sea quien
  // valide. Si users esta vacio (fetch fallido) esto permite igual entrar
  // tecleando el ID a mano.
  return trimmed
}

export function LoginView({ users, onLogin, loading, error }: Props) {
  const [input, setInput] = useState('')
  const [pin, setPin] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Solo usuarios ACTIVOS: un inactivo no debe poder entrar ni aparecer.
  const activos = useMemo(() => users.filter((u) => u.active !== false), [users])

  // Sugerencias SOLO a partir de lo que se escribe (a pedido del cliente: la
  // lista completa al enfocar saturaba visualmente). Desde 2 caracteres y
  // acotada a 8 resultados para que quepa sin scroll.
  const suggestions = useMemo(() => {
    const q = input.trim().toLowerCase()
    if (q.length < MIN_CHARS_SUGERENCIA) return []
    return activos
      .filter((u) => u.name.toLowerCase().includes(q) || u.id.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
      .slice(0, MAX_SUGERENCIAS)
  }, [input, activos])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setShowSuggestions(false)
    // Resolvemos contra ACTIVOS: si alguien inactivo teclea su nombre, no
    // resuelve a su ID y el servidor responde con el error normal de acceso.
    const userId = resolveUserId(input, activos)
    await onLogin(userId, pin)
  }

  function pickUser(u: UserProfile) {
    setInput(u.name)
    setShowSuggestions(false)
    inputRef.current?.blur()
  }

  return (
    <main className="app-shell auth-shell">
      <section className="auth-panel">
        <div className="auth-copy">
          <img src={logoAgromorales} alt="Agroservicios Morales" className="auth-logo" />
          <p className="auth-company-name">Agroindustrial de Servicios Morales S.A.S</p>
        </div>

        <form className="login-card" onSubmit={handleSubmit}>
          <p className="eyebrow">Ingreso</p>
          <h2>Acceso</h2>

          <label>
            Usuario
            <div className="login-typeahead">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value)
                  setShowSuggestions(true)
                }}
                onBlur={() => {
                  // Pequeno delay para que el click en una sugerencia
                  // alcance a registrarse antes de ocultar la lista.
                  window.setTimeout(() => setShowSuggestions(false), 150)
                }}
                placeholder="Ej: Cristhian Morales o U001"
                autoComplete="off"
                autoCapitalize="words"
              />
              {showSuggestions && suggestions.length > 0 && (
                <ul className="login-suggestions">
                  {suggestions.map((u) => (
                    <li
                      key={u.id}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        pickUser(u)
                      }}
                    >
                      <span className="login-suggestion-name">{u.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </label>

          <label>
            PIN
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              placeholder="Ingresa tu PIN"
              autoComplete="off"
            />
          </label>

          {error ? <div className="feedback error">{error}</div> : null}
          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? 'Entrando...' : 'Ingresar'}
          </button>
        </form>
      </section>
    </main>
  )
}

export default LoginView
