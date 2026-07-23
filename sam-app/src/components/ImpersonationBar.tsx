import { useMemo } from 'react'
import type { UserProfile } from '../domain/sam'

interface ImpersonationBarProps {
  // Sesión efectiva (el usuario que el soporte está viendo ahora).
  current: UserProfile
  users: UserProfile[]
  // Cambia la vista a otro usuario SIN salir del modo soporte.
  onSwitch: (profile: UserProfile) => void
  // Vuelve a la pantalla de soporte.
  onExit: () => void
}

function roleLabel(role: UserProfile['role']): string {
  if (role === 'owner') return 'Propietario'
  if (role === 'supervisor') return 'Supervisor'
  if (role === 'administracion') return 'Administración'
  if (role === 'soporte') return 'Soporte'
  if (role === 'supervisor_insumos') return 'Supervisor de insumos'
  if (role === 'conductor') return 'Conductor de escolta'
  return 'Operario'
}

/**
 * Barra naranja que aparece cuando el usuario de SOPORTE está impersonando.
 * Trae un selector "Cambiar vista…" para saltar al vuelo entre Propietario,
 * cualquier supervisor o cualquier operario, sin volver a la pantalla de
 * soporte. "Volver a Soporte" sale del modo impersonación.
 */
export function ImpersonationBar({ current, users, onSwitch, onExit }: ImpersonationBarProps) {
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
  const ownerTarget: UserProfile =
    owners[0] ?? { id: current.id, name: 'Propietario', role: 'owner', equipmentCode: '' }
  const adminTarget: UserProfile =
    admins[0] ?? { id: current.id, name: 'Administración', role: 'administracion', equipmentCode: '' }

  function handleChange(value: string) {
    if (!value) return
    if (value === '__owner') {
      onSwitch({ ...ownerTarget })
      return
    }
    if (value === '__admin') {
      onSwitch({ ...adminTarget })
      return
    }
    const u = [...supervisors, ...operators].find((x) => x.id === value)
    if (u) onSwitch({ ...u })
  }

  return (
    <div className="impersonation-bar" role="status">
      <span className="impersonation-bar__label">
        🛟 <strong>Soporte</strong> · viendo como <strong>{current.name}</strong> ({roleLabel(current.role)})
      </span>
      <div className="impersonation-bar__controls">
        <select
          className="impersonation-bar__select"
          value=""
          onChange={(e) => handleChange(e.target.value)}
          aria-label="Cambiar vista"
        >
          <option value="">Cambiar vista…</option>
          <option value="__owner">Propietario — toda la operación</option>
          <option value="__admin">Administración</option>
          {supervisors.length > 0 && (
            <optgroup label="Supervisores">
              {supervisors.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </optgroup>
          )}
          {operators.length > 0 && (
            <optgroup label="Operarios">
              {operators.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </optgroup>
          )}
        </select>
        <button type="button" className="impersonation-bar__exit" onClick={onExit}>
          Volver a Soporte
        </button>
      </div>
    </div>
  )
}
