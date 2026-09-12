import { useAppData } from '../context/AppDataContext'
import logoAgromorales from '../assets/logo-agromorales.jpeg'
import { ThemeToggle } from '../components/ThemeToggle'
import { BotonManual } from '../components/BotonManual'
import { PantallaSegura } from '../components/PantallaSegura'
import { TallerModule } from './TallerModule'

/**
 * Vista del rol `taller`: el mecánico y el jefe de taller.
 *
 * 🔴 **Existía el rol y existía el módulo, pero no había ruta que los uniera.**
 * `mapRole` devolvía `'taller'` correctamente y el CHECK de la base lo aceptaba,
 * pero `App.tsx` no tenía ningún `if` para ese rol: la persona entraba y caía en
 * la vista del OPERARIO, con Activas, Campo e Historial. Sin un error, sin un
 * aviso — exactamente la trampa que el CLAUDE.md advierte de `mapRole`, solo que
 * un escalón más abajo. Se descubrió el 11-sep-2026 al crear el primer usuario
 * `taller` de verdad para probar la asistencia: hasta ese día el módulo solo se
 * abría desde el menú «Más» del dueño, así que nadie lo había notado.
 *
 * ⚠️ Al agregar un rol, el checklist de `managing-supabase` no termina en
 * `mapRole`: **hay que abrirle la puerta en `App.tsx`**, o el rol existe en la
 * base y no lleva a ninguna parte.
 */
export function TallerView({ onLogout }: { onLogout: () => void }) {
  const { session, error, info } = useAppData()
  if (!session) return null

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-info">
            <img src={logoAgromorales} alt="AgroMorales" className="header-logo" />
            <div>
              <strong>AgroMorales</strong>
              <span>Taller · {session.name}</span>
            </div>
          </div>
        </div>
        <div className="topbar-actions">
          <ThemeToggle />
          <BotonManual className="inline-button" />
          <button type="button" className="inline-button" onClick={onLogout}>Salir</button>
        </div>
      </header>

      {error && <div className="sync-error-banner" role="alert"><span>{error}</span></div>}
      {info && <div role="status" className="info-banner-simple">{info}</div>}

      <div style={{ padding: '12px 0' }}>
        <PantallaSegura nombre="Taller"><TallerModule /></PantallaSegura>
      </div>
    </main>
  )
}

export default TallerView
