import { useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { loadKardexSalidasEquipo } from '../services/samApi'
import type { InsumoKardex } from '../domain/sam'

/**
 * Reporte de consumo por máquina (tractor) — módulo Insumos.
 *
 * Agrupa las SALIDAS del kardex que tienen equipo asignado y muestra, por cada
 * tractor, cuánto se le ha cargado de cada insumo (acumulador de costos).
 */
export function ConsumoEquiposTab() {
  const { insumos, sortedEquipment } = useAppData()

  const [movimientos, setMovimientos] = useState<InsumoKardex[]>([])
  const [loading, setLoading] = useState(false)
  const [busca, setBusca] = useState('')

  const equipoNombre = useMemo(() => {
    const m = new Map<string, string>()
    sortedEquipment.forEach((e) => m.set(e.code, e.name))
    return m
  }, [sortedEquipment])
  const insumoInfo = useMemo(() => {
    const m = new Map<string, { nombre: string; unidad: string }>()
    insumos.forEach((i) => m.set(i.id, { nombre: i.nombre, unidad: i.unidad }))
    return m
  }, [insumos])

  async function refresh() {
    setLoading(true)
    try {
      setMovimientos(await loadKardexSalidasEquipo())
    } finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])

  // Agrupa por equipo → insumo → total NETO: SALIDA suma (despacho), ENTRADA
  // resta (devolución por diferencia confirmada por el operario).
  const grupos = useMemo(() => {
    const byEquipo = new Map<string, { equipo: string; entregas: number; insumos: Map<string, number> }>()
    for (const m of movimientos) {
      if (!m.equipoCodigo) continue
      const g = byEquipo.get(m.equipoCodigo) ?? { equipo: m.equipoCodigo, entregas: 0, insumos: new Map<string, number>() }
      if (m.tipo === 'SALIDA') g.entregas += 1
      const delta = m.tipo === 'SALIDA' ? m.cantidad : -m.cantidad
      g.insumos.set(m.insumoId, (g.insumos.get(m.insumoId) ?? 0) + delta)
      byEquipo.set(m.equipoCodigo, g)
    }
    const q = busca.trim().toLowerCase()
    return Array.from(byEquipo.values())
      .map((g) => ({ ...g, nombre: equipoNombre.get(g.equipo) ?? g.equipo }))
      .filter((g) => !q || g.nombre.toLowerCase().includes(q))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
  }, [movimientos, equipoNombre, busca])

  return (
    <section className="panel-card">
      <div className="panel-title split">
        <h2>Consumo por máquina</h2>
        <button type="button" className="inline-button" onClick={() => void refresh()} disabled={loading}>↻ Actualizar</button>
      </div>
      <p className="subtle-copy" style={{ marginTop: 0 }}>
        Lo que se le ha cargado a cada tractor (combustible y materiales), sumado de los despachos.
      </p>

      <input
        type="search"
        className="labores-search-input"
        placeholder="Buscar máquina…"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        style={{ marginBottom: 12 }}
      />

      {loading ? (
        <p className="muted-text">Cargando…</p>
      ) : grupos.length === 0 ? (
        <p className="muted-text">Aún no hay consumos cargados a máquinas. Aparecerán al entregar despachos con su tractor.</p>
      ) : (
        <div className="list-rows">
          {grupos.map((g) => (
            <div key={g.equipo} className="panel-card" style={{ padding: '12px 14px', marginBottom: 10 }}>
              <div className="panel-title split" style={{ marginBottom: 6 }}>
                <h3 style={{ margin: 0, fontSize: '1rem' }}>🚜 {g.nombre}</h3>
                <span className="subtle-copy">{g.entregas} despacho{g.entregas === 1 ? '' : 's'}</span>
              </div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {Array.from(g.insumos.entries())
                  .map(([insumoId, total]) => ({ insumoId, total, info: insumoInfo.get(insumoId) }))
                  .sort((a, b) => (a.info?.nombre ?? '').localeCompare(b.info?.nombre ?? ''))
                  .map(({ insumoId, total, info }) => (
                    <li key={insumoId} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <span>{info?.nombre ?? insumoId}</span>
                      <strong>{Number(total.toFixed(2))} {info?.unidad ?? ''}</strong>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default ConsumoEquiposTab
