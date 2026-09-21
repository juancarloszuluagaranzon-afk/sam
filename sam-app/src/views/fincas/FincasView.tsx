import { useCallback, useEffect, useMemo, useState } from 'react'
import logoAgromorales from '../../assets/logo-agromorales.jpeg'
import { useAppData } from '../../context/AppDataContext'
import { ThemeToggle } from '../../components/ThemeToggle'
import { PantallaSegura } from '../../components/PantallaSegura'
import { cargarFincas, type DatosFincas } from '../../services/fincasApi'
import { hoyBogota } from '../../lib/periodos'
import { FincasInicio } from './FincasInicio'
import { FincaDetalle } from './FincaDetalle'
import { ReportarLabor } from './ReportarLabor'
import { PorAceptar } from './PorAceptar'
import { FincaForm } from './FincaForm'
import { PaqueteLabores } from './PaqueteLabores'

/**
 * Administración de fincas de caña — el SEGUNDO inicio de la app de ASM
 * (MVP, 22-sep-2026). El primero es el de la maquinaria; los dos se cambian con
 * el selector de arriba (`ModoSwitch`, en App.tsx).
 *
 * Todo el módulo trabaja sobre UNA carga de los datos (`cargarFincas`): el Inicio,
 * la finca y la cuenta salen de la misma foto y no se contradicen. Después de
 * cada acción se recarga completo — son pocas fincas y así nada queda a medias.
 */

export type TabFincas = 'inicio' | 'fincas' | 'aceptar' | 'reportar' | 'paquete'

export interface CtxFincas {
  datos: DatosFincas
  recargar: () => Promise<void>
  usuario: string
  esAdmin: boolean
  puedeReportar: boolean
  nombre: (id: string) => string
  hoy: string
  abrirFinca: (id: string) => void
  ir: (t: TabFincas) => void
}

export function FincasView({ onLogout }: { onLogout: () => void }) {
  const { session, users, error, info, setError } = useAppData()
  const [datos, setDatos] = useState<DatosFincas | null>(null)
  const [cargando, setCargando] = useState(true)
  const [tab, setTab] = useState<TabFincas>('inicio')
  const [fincaSel, setFincaSel] = useState<string | null>(null)
  const [editando, setEditando] = useState<'nueva' | string | null>(null)
  const [aviso, setAviso] = useState('')

  const recargar = useCallback(async () => {
    try {
      const d = await cargarFincas()
      setDatos(d)
      setAviso(d.truncado.length ? `Hay más datos de los que se alcanzan a traer (${d.truncado.join(', ')}). Avísele a soporte.` : '')
    } catch (e) {
      setError(`No se pudieron cargar las fincas. ${(e as Error).message}`)
    } finally { setCargando(false) }
  }, [setError])
  useEffect(() => { void recargar() }, [recargar])

  const nombreDe = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users])
  if (!session) return null

  const esAdmin = session.role === 'owner' || session.role === 'administracion'
  const ctx: CtxFincas | null = datos ? {
    datos, recargar, usuario: session.id, esAdmin,
    puedeReportar: esAdmin || session.role === 'supervisor',
    nombre: (id: string) => nombreDe.get(id) ?? id,
    hoy: hoyBogota(),
    abrirFinca: (id: string) => { setFincaSel(id); setTab('fincas') },
    ir: (t: TabFincas) => { setTab(t); if (t !== 'fincas') setFincaSel(null) },
  } : null

  const porAceptar = datos?.reportes.filter((r) => r.estado === 'PENDIENTE').length ?? 0
  const TABS: { id: TabFincas; label: string; solo?: boolean }[] = [
    { id: 'inicio', label: 'Inicio' },
    { id: 'fincas', label: 'Fincas' },
    { id: 'aceptar', label: porAceptar ? `Por aceptar (${porAceptar})` : 'Por aceptar' },
    { id: 'reportar', label: 'Reportar labor' },
    { id: 'paquete', label: 'Paquete de labores', solo: true },
  ]

  return (
    <main className="app-shell af">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-info">
            <img src={logoAgromorales} alt="AgroMorales" className="header-logo" />
            <div>
              <strong>AgroMorales</strong>
              <span>Administración de fincas</span>
            </div>
          </div>
        </div>
        <div className="topbar-actions">
          <ThemeToggle />
          <button type="button" className="inline-button" onClick={onLogout}>Salir</button>
        </div>
      </header>

      <nav className="af-nav" aria-label="Secciones de fincas">
        {TABS.filter((t) => !t.solo || esAdmin).map((t) => (
          <button key={t.id} type="button" aria-pressed={tab === t.id}
                  className={t.id === 'aceptar' && porAceptar ? 'af-nav__pend' : ''}
                  onClick={() => ctx?.ir(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {error && <div className="sync-error-banner" role="alert"><span>{error}</span></div>}
      {info && <div className="af-info" role="status">{info}</div>}
      {aviso && <div className="sync-error-banner" role="alert"><span>{aviso}</span></div>}

      <section className="af-cuerpo">
        {cargando || !ctx ? <p className="subtle-copy">Cargando fincas…</p> : (
          <PantallaSegura nombre="Administración de fincas">
            {editando ? (
              <FincaForm ctx={ctx} fincaId={editando === 'nueva' ? null : editando}
                         onListo={(id) => { setEditando(null); if (id) { setFincaSel(id); setTab('fincas') } }} />
            ) : tab === 'inicio' ? (
              <FincasInicio ctx={ctx} onNueva={() => setEditando('nueva')} />
            ) : tab === 'fincas' && fincaSel ? (
              <FincaDetalle ctx={ctx} fincaId={fincaSel} onVolver={() => setFincaSel(null)} onEditar={() => setEditando(fincaSel)} />
            ) : tab === 'fincas' ? (
              <FincasInicio ctx={ctx} soloLista onNueva={() => setEditando('nueva')} />
            ) : tab === 'aceptar' ? (
              <PorAceptar ctx={ctx} />
            ) : tab === 'reportar' ? (
              <ReportarLabor ctx={ctx} />
            ) : (
              <PaqueteLabores ctx={ctx} />
            )}
          </PantallaSegura>
        )}
      </section>
    </main>
  )
}

export default FincasView
