import { useMemo, useState } from 'react'
import SearchableSelect from '../components/SearchableSelect'
import { ThemeToggle } from '../components/ThemeToggle'
import type { UserProfile } from '../domain/sam'

interface SupportSwitcherProps {
  me: UserProfile
  users: UserProfile[]
  onView: (profile: UserProfile) => void
  onLogout: () => void
}

/**
 * Pantalla de inicio del rol "soporte". Permite entrar a la app IMPERSONANDO a
 * un usuario concreto (operario o supervisor) o como propietario, para ver
 * exactamente lo que esa persona ve. La sesión efectiva se intercambia en
 * App.tsx (enterImpersonation) y una barra flotante permite volver aquí.
 */
export function SupportSwitcher({ me, users, onView, onLogout }: SupportSwitcherProps) {
  const operators = useMemo(
    () => users.filter((u) => u.role === 'operador').sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  )
  const supervisors = useMemo(
    () => users.filter((u) => u.role === 'supervisor').sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  )
  const owners = useMemo(() => users.filter((u) => u.role === 'owner'), [users])

  const [opId, setOpId] = useState('')
  const [supId, setSupId] = useState('')

  // Para "Propietario" usamos un dueño real si existe (su id no afecta: el dueño
  // ve todo). Si no hay, sintetizamos uno con la identidad de soporte.
  const ownerTarget: UserProfile = owners[0] ?? { id: me.id, name: 'Propietario', role: 'owner', equipmentCode: '' }

  return (
    <main className="app-shell support-shell">
      <section className="support-card">
        <div className="support-card__head">
          <div>
            <p className="eyebrow">Soporte · {me.name}</p>
            <h1>Ver como…</h1>
            <p className="support-sub">
              Entra a la app tal como la ve cada rol. Podrás volver aquí con el botón
              flotante en cualquier momento.
            </p>
          </div>
          <div className="support-card__actions">
            <ThemeToggle />
            <button type="button" className="inline-button" onClick={onLogout}>
              Cerrar sesión
            </button>
          </div>
        </div>

        <button
          type="button"
          className="support-role-btn"
          onClick={() => onView({ ...ownerTarget })}
        >
          <span className="support-role-btn__icon">⌂</span>
          <span className="support-role-btn__text">
            <strong>Propietario</strong>
            <span className="support-role-btn__desc">Ve toda la operación (todas las haciendas y operarios)</span>
          </span>
          <span className="support-role-btn__go">Ver →</span>
        </button>

        <div className="support-pick">
          <label className="support-pick__field">
            <span>Supervisor</span>
            <SearchableSelect
              value={supId}
              onChange={setSupId}
              options={supervisors.map((s) => ({ value: s.id, label: s.name }))}
              placeholder="Selecciona un supervisor…"
            />
          </label>
          <button
            type="button"
            className="primary-button"
            disabled={!supId}
            onClick={() => {
              const u = supervisors.find((s) => s.id === supId)
              if (u) onView({ ...u })
            }}
          >
            Ver
          </button>
        </div>

        <div className="support-pick">
          <label className="support-pick__field">
            <span>Operario</span>
            <SearchableSelect
              value={opId}
              onChange={setOpId}
              options={operators.map((o) => ({ value: o.id, label: o.name }))}
              placeholder="Selecciona un operario…"
            />
          </label>
          <button
            type="button"
            className="primary-button"
            disabled={!opId}
            onClick={() => {
              const u = operators.find((o) => o.id === opId)
              if (u) onView({ ...u })
            }}
          >
            Ver
          </button>
        </div>
      </section>
    </main>
  )
}
