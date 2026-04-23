import { useMemo, useState, type FormEvent } from 'react'
import logoAgromorales from '../assets/logo-agromorales.jpeg'
import type { UserProfile } from '../domain/sam'

interface Props {
  users: UserProfile[]
  onLogin: (userId: string, pin: string) => Promise<void>
  loading: boolean
  error: string
}

function roleLabel(role: UserProfile['role']): string {
  if (role === 'owner') return 'Propietario'
  if (role === 'supervisor') return 'Supervisor'
  if (role === 'administracion') return 'Administración'
  return 'Operador'
}

export function LoginView({ users, onLogin, loading, error }: Props) {
  const [userId, setUserId] = useState(() => users[0]?.id ?? '')
  const [pin, setPin] = useState('')

  const loginOptions = useMemo(
    () => users.map((u) => ({ id: u.id, label: `${u.name} - ${roleLabel(u.role)}` })),
    [users],
  )

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await onLogin(userId, pin)
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
          <h2>Acceso de piloto</h2>
          <label>
            Usuario
            <select
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
            >
              {loginOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            PIN
            <input
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              placeholder="Ingresa tu PIN"
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
