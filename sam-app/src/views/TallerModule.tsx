import { useMemo, useState } from 'react'
import { TallerProvider, useTaller } from './taller/TallerContext'
import { MaquinasTab } from './taller/MaquinasTab'
import { OrdenesTab } from './taller/OrdenesTab'
import { PreventivoTab } from './taller/PreventivoTab'
import { RepuestosTab } from './taller/RepuestosTab'
import { ComprasTab } from './taller/ComprasTab'
import { CicloVidaTab } from './taller/CicloVidaTab'
import { useAppData } from '../context/AppDataContext'
import { vencimientosDe } from '../lib/indicadores'

/**
 * Taller de maquinaria.
 *
 * Seis pestañas que son las seis piezas del modelo, en el orden en que se usan:
 * la máquina y su hoja de vida → lo que hay que hacerle (preventivo) → lo que se
 * le está haciendo (órdenes) → con qué (repuestos) → de dónde salió (compras) →
 * cuánto costó (ciclo de vida).
 */
export type TallerTab = 'maquinas' | 'preventivo' | 'ordenes' | 'repuestos' | 'compras' | 'ciclo'

const TABS: { key: TallerTab; icon: string; label: string; desc: string }[] = [
  { key: 'maquinas', icon: '🚜', label: 'Máquinas', desc: 'Hoja de vida' },
  { key: 'preventivo', icon: '🗓️', label: 'Preventivo', desc: 'Qué toca y cuándo' },
  { key: 'ordenes', icon: '🔧', label: 'Órdenes', desc: 'Trabajos y costos' },
  { key: 'repuestos', icon: '🔩', label: 'Repuestos', desc: 'Catálogo y stock' },
  { key: 'compras', icon: '🧾', label: 'Compras', desc: 'Proveedores' },
  { key: 'ciclo', icon: '📈', label: 'Ciclo de vida', desc: '$/hora e indicadores' },
]

function TallerInterno() {
  const { equipment } = useAppData()
  const { planes, horasDe, ordenes, cargando } = useTaller()
  const [tab, setTab] = useState<TallerTab>('maquinas')

  // Badges: lo que exige atención hoy. Un módulo de mantenimiento que no grita
  // cuando algo está vencido es un archivador.
  const vencidos = useMemo(() => {
    const eq = equipment.map((e) => ({ codigo: e.code, marca: e.brand, modelo: e.model }))
    return vencimientosDe(planes, horasDe, eq).filter((v) => v.estado === 'VENCIDO').length
  }, [planes, horasDe, equipment])

  const abiertas = useMemo(
    () => ordenes.filter((o) => o.estado === 'ABIERTA' || o.estado === 'EN_PROCESO').length,
    [ordenes],
  )

  const badge = (k: TallerTab) =>
    k === 'preventivo' && vencidos > 0 ? vencidos
      : k === 'ordenes' && abiertas > 0 ? abiertas
      : null

  return (
    <div>
      <div className="insumos-tabs" role="tablist" aria-label="Secciones del taller">
        {TABS.map((t) => {
          const b = badge(t.key)
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`insumos-tab${tab === t.key ? ' is-active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              <span className="insumos-tab__icon" aria-hidden>{t.icon}</span>
              <span className="insumos-tab__text">
                <span className="insumos-tab__label">
                  {t.label}
                  {b != null && <span className="taller-badge">{b}</span>}
                </span>
                <span className="insumos-tab__desc">{t.desc}</span>
              </span>
            </button>
          )
        })}
      </div>

      {cargando ? (
        <section className="panel-card"><p className="muted-text">Cargando el taller…</p></section>
      ) : tab === 'maquinas' ? <MaquinasTab />
        : tab === 'preventivo' ? <PreventivoTab />
        : tab === 'ordenes' ? <OrdenesTab />
        : tab === 'repuestos' ? <RepuestosTab />
        : tab === 'compras' ? <ComprasTab />
        : <CicloVidaTab />}
    </div>
  )
}

export function TallerModule() {
  return (
    <TallerProvider>
      <TallerInterno />
    </TallerProvider>
  )
}

export default TallerModule
