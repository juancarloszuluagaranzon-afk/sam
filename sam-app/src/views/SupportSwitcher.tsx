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
 * Pantalla de inicio del rol "soporte". Permite entrar a la app IMPERSONANDO un
 * rol completo (propietario / administración) o un usuario concreto (supervisor
 * u operario), para ver exactamente lo que esa persona ve. La sesión efectiva se
 * intercambia en App.tsx (enterImpersonation); una barra flotante permite volver.
 */
export function SupportSwitcher({ me, users, onView, onLogout }: SupportSwitcherProps) {
  // Solo se puede impersonar usuarios ACTIVOS (los inactivos no pueden loguear).
  const act = (u: UserProfile) => u.active !== false
  const operators = useMemo(
    () => users.filter((u) => u.role === 'operador' && act(u)).sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  )
  const supervisors = useMemo(
    () => users.filter((u) => u.role === 'supervisor' && act(u)).sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  )
  const owners = useMemo(() => users.filter((u) => u.role === 'owner' && act(u)), [users])
  const admins = useMemo(() => users.filter((u) => u.role === 'administracion' && act(u)), [users])
  const insumosSups = useMemo(
    () => users.filter((u) => u.role === 'supervisor_insumos' && act(u)).sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  )
  const conductoresMadera = useMemo(
    () => users.filter((u) => u.role === 'conductor_madera' && act(u)).sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  )
  const conductores = useMemo(
    () => users.filter((u) => u.role === 'conductor' && act(u)).sort((a, b) => a.name.localeCompare(b.name)),
    [users],
  )

  const [supId, setSupId] = useState('')
  const [opId, setOpId] = useState('')
  const [insId, setInsId] = useState('')
  const [conId, setConId] = useState('')
  const [madId, setMadId] = useState('')

  // Para roles "globales" usamos un usuario real si existe (su id no afecta:
  // ven todo). Si no hay, sintetizamos uno con la identidad de soporte.
  const ownerTarget: UserProfile = owners[0] ?? { id: me.id, name: 'Propietario', role: 'owner', equipmentCode: '' }
  const adminTarget: UserProfile = admins[0] ?? { id: me.id, name: 'Administración', role: 'administracion', equipmentCode: '' }

  return (
    <main className="app-shell support-shell">
      <section className="support-card">
        <div className="support-card__head">
          <div>
            <p className="eyebrow">Soporte · {me.name}</p>
            <h1>Ver como…</h1>
            <p className="support-sub">
              Entra a la app tal como la ve cada rol. Vuelves aquí con el botón flotante en
              cualquier momento.
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
          <span className="support-role-btn__icon" aria-hidden="true">⌂</span>
          <span className="support-role-btn__text">
            <strong>Propietario</strong>
            <span className="support-role-btn__desc">Toda la operación — todas las haciendas y operarios</span>
          </span>
          <span className="support-role-btn__go">Ver →</span>
        </button>

        <button
          type="button"
          className="support-role-btn"
          onClick={() => onView({ ...adminTarget })}
        >
          <span className="support-role-btn__icon" aria-hidden="true">⚙</span>
          <span className="support-role-btn__text">
            <strong>Administración</strong>
            <span className="support-role-btn__desc">Gestión completa — usuarios, validación, maestros, planilla</span>
          </span>
          <span className="support-role-btn__go">Ver →</span>
        </button>

        <div className="support-divider"><span>o entra como una persona</span></div>

        <div className="support-pick">
          <label className="support-pick__field">
            <span className="support-pick__label">Supervisor</span>
            <SearchableSelect
              value={supId}
              onChange={setSupId}
              options={supervisors.map((s) => ({ value: s.id, label: s.name }))}
              placeholder="Buscar supervisor…"
            />
          </label>
          <button
            type="button"
            className="primary-button support-pick__btn"
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
            <span className="support-pick__label">Operario</span>
            <SearchableSelect
              value={opId}
              onChange={setOpId}
              options={operators.map((o) => ({ value: o.id, label: o.name }))}
              placeholder="Buscar operario…"
            />
          </label>
          <button
            type="button"
            className="primary-button support-pick__btn"
            disabled={!opId}
            onClick={() => {
              const u = operators.find((o) => o.id === opId)
              if (u) onView({ ...u })
            }}
          >
            Ver
          </button>
        </div>

        {insumosSups.length > 0 && (
          <div className="support-pick">
            <label className="support-pick__field">
              <span className="support-pick__label">Supervisor de insumos</span>
              <SearchableSelect
                value={insId}
                onChange={setInsId}
                options={insumosSups.map((s) => ({ value: s.id, label: s.name }))}
                placeholder="Buscar…"
              />
            </label>
            <button
              type="button"
              className="primary-button support-pick__btn"
              disabled={!insId}
              onClick={() => {
                const u = insumosSups.find((s) => s.id === insId)
                if (u) onView({ ...u })
              }}
            >
              Ver
            </button>
          </div>
        )}

        {conductores.length > 0 && (
          <div className="support-pick">
            <label className="support-pick__field">
              <span className="support-pick__label">Conductor de escolta</span>
              <SearchableSelect
                value={conId}
                onChange={setConId}
                options={conductores.map((s) => ({ value: s.id, label: s.name }))}
                placeholder="Buscar…"
              />
            </label>
            <button
              type="button"
              className="primary-button support-pick__btn"
              disabled={!conId}
              onClick={() => {
                const u = conductores.find((s) => s.id === conId)
                if (u) onView({ ...u })
              }}
            >
              Ver
            </button>
          </div>
        )}

        {conductoresMadera.length > 0 && (
          <div className="support-pick">
            <label className="support-pick__field">
              <span className="support-pick__label">Conductor de madera</span>
              <SearchableSelect
                value={madId}
                onChange={setMadId}
                options={conductoresMadera.map((s) => ({ value: s.id, label: s.name }))}
                placeholder="Buscar…"
              />
            </label>
            <button
              type="button"
              className="primary-button support-pick__btn"
              disabled={!madId}
              onClick={() => {
                const u = conductoresMadera.find((s) => s.id === madId)
                if (u) onView({ ...u })
              }}
            >
              Ver
            </button>
          </div>
        )}
      </section>
    </main>
  )
}
