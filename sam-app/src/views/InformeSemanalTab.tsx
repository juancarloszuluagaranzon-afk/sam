import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { loadSolicitudes, loadCombustibleExterno } from '../services/samApi'
import type { SolicitudInsumo, CombustibleExterno } from '../domain/sam'
import { armarInformeSemanal, desviacionRendimiento } from '../lib/informeSemanal'
import { fmtCantidad } from '../lib/cantidad'
import { fmtFechaHora } from '../lib/fechas'
import { Ayuda } from '../components/Ayuda'

/**
 * Informe semanal por máquina — reemplaza la hoja de Excel que se llenaba a mano.
 *
 * La hoja tenía una fila por entrega con el horómetro anotado, y una columna por
 * insumo. Todo eso está aquí, más lo que en la hoja no se podía calcular: las
 * horas entre un evento y el siguiente, las de la semana completa y los galones
 * por hora.
 *
 * ⚠️ Los horómetros vienen sucios y el informe lo dice en vez de taparlo: las
 * lecturas que no cuadran se marcan y NO entran en el cálculo. Ver
 * `lib/informeSemanal.ts`.
 */

function haceSemanas(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n * 7)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function InformeSemanalTab() {
  const { users, sortedEquipment, busy, setBusy, setError, setInfo } = useAppData()

  const [entregas, setEntregas] = useState<SolicitudInsumo[]>([])
  const [tanqueos, setTanqueos] = useState<CombustibleExterno[]>([])
  const [cargando, setCargando] = useState(true)
  const [desde, setDesde] = useState(haceSemanas(8))
  const [hasta, setHasta] = useState(hoyISO())
  const [abierta, setAbierta] = useState<string>('')

  const userName = useCallback((id?: string) => {
    if (!id) return ''
    return users.find((u) => u.id === id)?.name ?? id
  }, [users])
  const equipoNombre = useMemo(() => {
    const m = new Map<string, string>()
    sortedEquipment.forEach((e) => m.set(e.code, e.name))
    return m
  }, [sortedEquipment])

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const [sol, cb] = await Promise.all([
        loadSolicitudes({ limit: 1500 }),
        loadCombustibleExterno({ desde, hasta, limit: 800 }),
      ])
      // Las solicitudes no se pueden filtrar por fecha en la consulta, así que
      // se recortan aquí al rango pedido.
      setEntregas(sol.filter((s) => {
        const d = (s.entregadoEn ?? s.createdAt).slice(0, 10)
        return d >= desde && d <= hasta
      }))
      setTanqueos(cb)
    } finally { setCargando(false) }
  }, [desde, hasta])
  useEffect(() => { void cargar() }, [cargar])

  const filas = useMemo(
    () => armarInformeSemanal({ entregas, tanqueos, nombreUsuario: userName }),
    [entregas, tanqueos, userName],
  )

  /** Todas las columnas de insumo que aparecieron, para armar la tabla y el Excel. */
  const columnas = useMemo(() => {
    const set = new Map<string, string>()
    filas.forEach((f) => f.insumos.forEach((v, k) => set.set(k, v.unidad)))
    return [...set.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'))
  }, [filas])

  const totalSospechosos = filas.reduce((t, f) => t + f.sospechosos, 0)

  async function exportar() {
    setBusy(true); setError('')
    try {
      const { utils, writeFile } = await import('xlsx')
      const wb = utils.book_new()

      // Hoja 1 — la misma estructura de la hoja que ya llevaban, más lo nuevo.
      const resumen = filas.map((f) => {
        const fila: Record<string, unknown> = {
          'SEMANA': f.semana,
          'Tractor': equipoNombre.get(f.equipo) ?? f.equipo,
          'Operario': f.operario,
          'Responsable': f.responsable,
          'Horómetro inicial': f.horometroInicial ?? '',
          'Horómetro final': f.horometroFinal ?? '',
          'HORAS TRABAJADAS': f.horas ?? '',
          'Combustible(gal)': f.galones || '',
          'GALONES / HORA': f.galonesPorHora ?? '',
          'Eventos': f.eventos.length,
          'Lecturas descartadas': f.sospechosos || '',
        }
        for (const [nombre] of columnas) {
          fila[nombre] = f.insumos.get(nombre)?.cantidad ?? 0
        }
        return fila
      })
      utils.book_append_sheet(wb, utils.json_to_sheet(resumen), 'Semanal por máquina')

      // Hoja 2 — evento por evento, con las horas de cada tramo.
      const detalle: Record<string, unknown>[] = []
      for (const f of filas) {
        for (const e of f.eventos) {
          detalle.push({
            'SEMANA': f.semana,
            'Fecha': fmtFechaHora(e.cuando),
            'Tractor': equipoNombre.get(f.equipo) ?? f.equipo,
            'Tipo': e.tipo === 'TANQUEO' ? 'Tanqueo' : 'Entrega',
            'Horómetro': e.horometro,
            'Horas desde el anterior': e.horasDesdeAnterior ?? '',
            'Combustible(gal)': e.galones || '',
            'Operario': e.operario,
            'Responsable': e.responsable,
            'Insumos': e.insumos.map((i) => `${fmtCantidad(i.cantidad, i.unidad)} ${i.unidad} ${i.nombre}`).join(' · '),
            '⚠ Horómetro dudoso': e.horometroSospechoso ? 'SÍ' : '',
          })
        }
      }
      utils.book_append_sheet(wb, utils.json_to_sheet(detalle), 'Evento por evento')

      writeFile(wb, `informe-semanal-${desde}-a-${hasta}.xlsx`)
      setInfo(`Informe descargado: ${filas.length} fila(s).`)
    } catch {
      setError('No se pudo generar el Excel.')
    } finally { setBusy(false) }
  }

  return (
    <section className="panel">
      <div className="panel-title split">
        <h2>📅 Informe semanal por máquina</h2>
        <button type="button" className="inline-button" onClick={() => void cargar()} disabled={cargando}>↻ Actualizar</button>
      </div>
      <Ayuda>
        <p>
          Una fila por máquina y semana: horómetro inicial y final, las horas que trabajó,
          el combustible que recibió y los <strong>galones por hora</strong>. Es la hoja que
          se llenaba a mano, con lo que ahí no se podía calcular.
        </p>
        <p>
          Las horas salen de los horómetros que se anotan al entregar o al tanquear. Si una
          lectura no cuadra con las demás de esa máquina, <strong>se marca y no se usa</strong>:
          más vale una casilla vacía que un número inventado.
        </p>
      </Ayuda>

      <div className="rep-toolbar">
        <label className="rep-fecha">Desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
        <label className="rep-fecha">Hasta<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        <button type="button" className="primary-button rep-export" onClick={() => void exportar()} disabled={busy || cargando || filas.length === 0}>
          ⬇ Descargar Excel
        </button>
      </div>

      {totalSospechosos > 0 && (
        <div className="taller-aviso taller-aviso--warn" style={{ marginTop: 10 }}>
          ⚠ {totalSospechosos} lectura(s) de horómetro no cuadran con su máquina y quedaron por
          fuera del cálculo. Están marcadas en el detalle — vale la pena corregirlas con el operario.
        </div>
      )}

      {cargando ? (
        <p className="muted-text">Cargando…</p>
      ) : filas.length === 0 ? (
        <p className="muted-text">Sin entregas ni tanqueos con horómetro en este rango.</p>
      ) : (
        <div className="inv-list" style={{ marginTop: 12 }}>
          {filas.map((f) => {
            const clave = `${f.equipo}-${f.semana}`
            const desv = desviacionRendimiento(f, filas)
            return (
              <div key={clave} className="sem-fila">
                <button type="button" className="sem-fila__cab" onClick={() => setAbierta(abierta === clave ? '' : clave)}>
                  <div className="sem-fila__id">
                    <strong>🚜 {equipoNombre.get(f.equipo) ?? f.equipo}</strong>
                    <small>Semana {f.semana} · {f.operario || 'sin operario'}</small>
                  </div>
                  <div className="sem-fila__kpis">
                    <span><small>Horas</small><strong>{f.horas ?? '—'}</strong></span>
                    <span><small>Galones</small><strong>{f.galones || '—'}</strong></span>
                    <span className={desv != null && Math.abs(desv) >= 25 ? 'sem-alerta' : ''}>
                      <small>gal/hora</small>
                      <strong>
                        {f.galonesPorHora ?? '—'}
                        {desv != null && Math.abs(desv) >= 25 && <em> {desv > 0 ? '▲' : '▼'}{Math.abs(desv)}%</em>}
                      </strong>
                    </span>
                  </div>
                  <span className="consumo-maq__ver">{abierta === clave ? 'ocultar ▴' : 'ver eventos ▾'}</span>
                </button>

                {abierta === clave && (
                  <div className="sem-fila__detalle">
                    {f.horas == null && (
                      <p className="subtle-copy" style={{ margin: '0 0 8px' }}>
                        No se pudieron calcular las horas: hace falta al menos <strong>dos</strong>{' '}
                        lecturas de horómetro confiables en la semana.
                      </p>
                    )}
                    {f.eventos.map((e) => (
                      <div key={e.id} className={`sem-evento${e.horometroSospechoso ? ' sem-evento--dudoso' : ''}`}>
                        <div className="sem-evento__top">
                          <strong>{e.tipo === 'TANQUEO' ? '⛽ Tanqueo' : '📦 Entrega'}</strong>
                          <span className="subtle-copy">{fmtFechaHora(e.cuando)}</span>
                        </div>
                        <div className="sem-evento__datos">
                          <span>Horómetro <strong>{e.horometro}</strong></span>
                          {e.horasDesdeAnterior != null && <span>Trabajó <strong>{e.horasDesdeAnterior} h</strong></span>}
                          {e.galones > 0 && <span>Recibió <strong>{fmtCantidad(e.galones, 'galón')} gal</strong></span>}
                        </div>
                        <span className="subtle-copy">
                          {e.insumos.map((i) => `${fmtCantidad(i.cantidad, i.unidad)} ${i.unidad} ${i.nombre}`).join(' · ')}
                        </span>
                        <span className="subtle-copy">
                          {e.operario && `🙋 ${e.operario}`}{e.responsable && ` · entregó ${e.responsable}`}
                        </span>
                        {e.horometroSospechoso && (
                          <span className="sem-evento__aviso">
                            ⚠ Este horómetro no cuadra con los demás de la máquina. No se usó para calcular horas.
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

export default InformeSemanalTab
