import { useState } from 'react'
import { SoporteView } from './SoporteView'
import { SupportSwitcher } from './SupportSwitcher'
import { PantallaSegura } from '../components/PantallaSegura'
import type { UserProfile } from '../domain/sam'

/**
 * Lo que ve quien tiene el rol de soporte.
 *
 * 🔴 Antes este rol entraba directo al «Ver como», que es una HERRAMIENTA, no un
 * trabajo. Abrir en la herramienta obliga a acordarse de a quién había que
 * mirar; abrir en la bandeja pone al frente lo que hay por hacer.
 *
 * El «Ver como» no desaparece — queda a un toque, porque meterse en la pantalla
 * del que sufre el problema es justamente como se resuelve un caso, y esta app
 * ya tenía esa capacidad antes de que existiera el módulo.
 */
export function SoporteShell({ me, users, onView, onLogout }: {
  me: UserProfile
  users: UserProfile[]
  onView: (u: UserProfile) => void
  onLogout: () => void
}) {
  const [verComo, setVerComo] = useState(false)

  if (verComo) {
    return (
      <SupportSwitcher
        me={me}
        users={users}
        onView={onView}
        onLogout={() => setVerComo(false)}
      />
    )
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <strong>Soporte</strong>
          <span className="app-header__sub">{me.name}</span>
        </div>
        <div className="app-header__actions">
          <button type="button" className="inline-button" onClick={() => setVerComo(true)}>
            👁 Ver como…
          </button>
          <button type="button" className="inline-button" onClick={onLogout}>
            Salir
          </button>
        </div>
      </header>

      <PantallaSegura nombre="Casos de soporte">
        <SoporteView />
      </PantallaSegura>
    </main>
  )
}

export default SoporteShell
