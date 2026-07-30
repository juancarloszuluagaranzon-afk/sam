import { useEffect, useMemo, useState } from 'react'
import { useAppData } from '../../context/AppDataContext'
import { useTaller } from './TallerContext'
import { loadEquipoCostos, saveEquipoCosto } from '../../services/tallerApi'
import { loadCombustibleExterno, loadKardexReporte } from '../../services/samApi'
import { SearchableSelect } from '../../components/SearchableSelect'
import { calcularIndicadores, calcularCostoActivo, galonesDeMaquina } from '../../lib/indicadores'
import { COSTO_LABEL, type CostoConcepto, type EquipoCosto, type InsumoKardex, type CombustibleExterno } from '../../domain/sam'

/**
 * Ciclo de vida del activo — el "$/unitario" del apunte.
 *
 * Junta las tres bolsas de costo (administrativos, operativos, mantenimiento) y
 * los cuatro indicadores (disponibilidad, TMEF, TMR, paradas) en un periodo.
 *
 * Se dice en pantalla qué falta para que el número sea real: un costo por hora
 * sin depreciación o sin combustible se ve engañosamente barato, y alguien
 * podría tomar decisiones de tarifa con él.
 */

const money = (v: number) => `$${Math.round(v).toLocaleString('es-CO')}`
const nf = (v: number, d = 1) => v.toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d })

function mesActual(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0, 7)
}

export function CicloVidaTab() {
  const { equipment, insumos, session, busy, setBusy, setError, setInfo } = useAppData()
  const { ordenes, activos } = useTaller()

  const [equipo, setEquipo] = useState('')
  const [periodo, setPeriodo] = useState(mesActual)
  const [costos, setCostos] = useState<EquipoCosto[]>([])
  const [movs, setMovs] = useState<InsumoKardex[]>([])
  const [tanqueos, setTanqueos] = useState<CombustibleExterno[]>([])
  const [precioGalon, setPrecioGalon] = useState('16000')
  const [nuevoCosto, setNuevoCosto] = useState<{ concepto: CostoConcepto; valor: string } | null>(null)

  const desde = `${periodo}-01`
  const hasta = useMemo(() => {
    const [y, m] = periodo.split('-').map(Number)
    return `${periodo}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
  }, [periodo])

  useEffect(() => {
    if (!equipo) { setCostos([]); setMovs([]); setTanqueos([]); return }
    void loadEquipoCostos({ equipoCodigo: equipo, desde: periodo, hasta: periodo }).then(setCostos)
    void loadKardexReporte({ desde, hasta: `${hasta}T23:59:59` }).then((ms) =>
      setMovs(ms.filter((m) => m.equipoCodigo === equipo)))
    void loadCombustibleExterno({ desde, hasta, limit: 500 })
      .then((cs) => setTanqueos(cs.filter((c) => c.equipoCodigo === equipo)))
  }, [equipo, periodo, desde, hasta])

  const combustibleInsumos = useMemo(
    () => new Set(insumos.filter((i) => i.categoria === 'COMBUSTIBLE').map((i) => i.id)),
    [insumos],
  )
  // Una sola definicion, compartida con el reporte de consumo: sumar el kardex
  // y `combustible_externo` a ciegas contaba dos veces el tanqueo en sede, que
  // deja las DOS huellas. El costo por hora salia inflado.
  const galonesTotal = useMemo(
    () => galonesDeMaquina({
      kardex: movs,
      tanqueos,
      esCombustible: (id) => combustibleInsumos.has(id),
    }),
    [movs, tanqueos, combustibleInsumos],
  )

  const otsPeriodo = useMemo(
    () => ordenes.filter((o) => o.equipoCodigo === equipo && o.createdAt >= desde && o.createdAt <= `${hasta}T23:59:59`),
    [ordenes, equipo, desde, hasta],
  )

  const ind = useMemo(() => calcularIndicadores(otsPeriodo, desde, hasta), [otsPeriodo, desde, hasta])

  const act = useMemo(() => activos.find((a) => a.codigo === equipo), [activos, equipo])

  // Horas del periodo: no hay serie histórica de horómetro, así que se estima
  // con las horas de las órdenes. Si no hay, se deja en 0 y se avisa.
  const [horasPeriodo, setHorasPeriodo] = useState('')
  const horas = Number(horasPeriodo) || 0

  const costo = useMemo(() => calcularCostoActivo({
    ordenes: otsPeriodo,
    costos,
    galones: galonesTotal,
    precioGalon: Number(precioGalon) || 0,
    horas,
    valorCompra: act?.valorCompra,
    valorResidual: act?.valorResidual,
    vidaUtilHoras: act?.vidaUtilHoras,
  }), [otsPeriodo, costos, galonesTotal, precioGalon, horas, act])

  const faltantes = useMemo(() => {
    const f: string[] = []
    if (!act?.vidaUtilHoras || !act?.valorCompra) f.push('valor de compra y vida útil (no se está depreciando)')
    if (galonesTotal === 0) f.push('consumo de combustible del periodo')
    if (horas === 0) f.push('horas trabajadas (sin ellas no hay $/hora)')
    if (costos.length === 0) f.push('seguros e impuestos del periodo')
    return f
  }, [act, galonesTotal, horas, costos])

  return (
    <section className="panel-card">
      <h2>📈 Ciclo de vida y costo por hora</h2>
      <p className="subtle-copy" style={{ marginTop: 0 }}>
        Las tres bolsas de costo del activo y los cuatro indicadores, en un mes.
      </p>

      <div className="flota-grid" style={{ marginTop: 10 }}>
        <label>Máquina
          <SearchableSelect value={equipo} onChange={setEquipo}
            options={[...equipment].sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true }))
              .map((e) => ({ value: e.code, label: e.code, rightLabel: e.name }))}
            placeholder="Buscar máquina…" disabled={busy} />
        </label>
        <label>Periodo<input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} /></label>
        <label>Horas trabajadas en el mes
          <input type="number" min={0} step="any" value={horasPeriodo} placeholder="Ej: 180"
            onChange={(e) => setHorasPeriodo(e.target.value)} />
        </label>
        <label>Precio del galón
          <input type="number" min={0} step="any" value={precioGalon} onChange={(e) => setPrecioGalon(e.target.value)} />
        </label>
      </div>

      {!equipo ? (
        <p className="muted-text" style={{ marginTop: 12 }}>Elige una máquina para ver sus números.</p>
      ) : (
        <>
          {/* Indicadores */}
          <p className="ins-res__lbl" style={{ marginTop: 16 }}>Indicadores del periodo</p>
          <div className="dash-maq" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
            <div className="dash-maq__box"><strong>{nf(ind.disponibilidad)}%</strong><span>disponibilidad</span></div>
            <div className="dash-maq__box"><strong>{ind.tmef > 0 ? nf(ind.tmef) : '—'}</strong><span>TMEF (h entre fallas)</span></div>
            <div className="dash-maq__box"><strong>{ind.tmr > 0 ? nf(ind.tmr) : '—'}</strong><span>TMR (h por reparación)</span></div>
            <div className="dash-maq__box"><strong>{ind.paradas}</strong><span>paradas</span></div>
          </div>
          <p className="subtle-copy">
            {ind.horasParado > 0
              ? `${nf(ind.horasParado)} h parada de ${nf(ind.horasPeriodo, 0)} h del periodo.`
              : 'Sin paradas registradas en el periodo.'}
            {ind.abiertas > 0 && ` · ${ind.abiertas} orden(es) sin cerrar: su paro todavía no se cuenta.`}
          </p>

          {/* Costo */}
          <p className="ins-res__lbl" style={{ marginTop: 16 }}>Costo del periodo</p>
          <div className="taller-costo">
            <div className="taller-costo__hero">
              <strong>{horas > 0 ? money(costo.porHora) : '—'}</strong>
              <span>por hora de máquina</span>
            </div>
            <div className="taller-ficha">
              <div><span>Administrativos</span><strong>{money(costo.administrativos)}</strong></div>
              <div><span>Operativos</span><strong>{money(costo.operativos)}</strong></div>
              <div><span>Mantenimiento</span><strong>{money(costo.mantenimiento)}</strong></div>
              <div><span>Total</span><strong>{money(costo.total)}</strong></div>
            </div>
          </div>

          <div className="taller-ficha" style={{ marginTop: 10 }}>
            <div><span>Seguros</span><strong>{money(costo.detalle.seguros)}</strong></div>
            <div><span>Impuestos</span><strong>{money(costo.detalle.impuestos)}</strong></div>
            <div><span>Depreciación</span><strong>{money(costo.detalle.depreciacion)}</strong></div>
            <div><span>Combustible</span><strong>{money(costo.detalle.combustible)}</strong></div>
            <div><span>Repuestos</span><strong>{money(costo.detalle.repuestos)}</strong></div>
            <div><span>Mano de obra</span><strong>{money(costo.detalle.manoObra)}</strong></div>
            <div><span>Servicios externos</span><strong>{money(costo.detalle.externos)}</strong></div>
            <div><span>Galones</span><strong>{nf(galonesTotal)}</strong></div>
          </div>

          {faltantes.length > 0 && (
            <div className="taller-aviso taller-aviso--warn" style={{ marginTop: 12 }}>
              <strong>⚠ Este costo está incompleto</strong>
              <span>Falta cargar: {faltantes.join(' · ')}. Con datos parciales el costo por hora
                se ve más barato de lo que realmente es.</span>
            </div>
          )}

          {/* Costos administrativos */}
          <div className="bod-head" style={{ marginTop: 16 }}>
            <p className="ins-res__lbl" style={{ margin: 0 }}>Costos administrativos de {periodo}</p>
            <button type="button" className="inline-button" disabled={busy}
              onClick={() => setNuevoCosto({ concepto: 'SEGURO', valor: '' })}>+ Cargar costo</button>
          </div>
          {costos.length === 0 ? (
            <p className="muted-text" style={{ margin: 0 }}>
              Sin costos cargados. Seguros, impuestos y depreciación no se pueden deducir
              de la operación: hay que cargarlos.
            </p>
          ) : (
            costos.map((c) => (
              <div key={c.id} className="bod-stock__row">
                <span className="bod-stock__nom">{COSTO_LABEL[c.concepto]}{c.nota ? ` · ${c.nota}` : ''}</span>
                <strong className="bod-stock__val">{money(c.valor)}</strong>
              </div>
            ))
          )}
        </>
      )}

      {nuevoCosto && (
        <div className="modal-overlay open" onClick={() => { if (!busy) setNuevoCosto(null) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(400px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">{equipo} · {periodo}</p><h3>Cargar costo</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setNuevoCosto(null)} disabled={busy}>&#x2715;</button>
            </div>
            <label>Concepto
              <SearchableSelect value={nuevoCosto.concepto}
                onChange={(v) => setNuevoCosto({ ...nuevoCosto, concepto: v as CostoConcepto })}
                options={(Object.keys(COSTO_LABEL) as CostoConcepto[]).map((k) => ({ value: k, label: COSTO_LABEL[k] }))}
                disabled={busy} />
            </label>
            <label style={{ marginTop: 8 }}>Valor del mes
              <input type="number" min={0} step="any" value={nuevoCosto.valor} autoFocus
                onChange={(e) => setNuevoCosto({ ...nuevoCosto, valor: e.target.value })} disabled={busy} />
            </label>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setNuevoCosto(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" disabled={busy}
                onClick={async () => {
                  const v = Number(nuevoCosto.valor)
                  if (!v || v <= 0) { setError('Escribe el valor.'); return }
                  setBusy(true); setError('')
                  try {
                    await saveEquipoCosto({
                      equipoCodigo: equipo, concepto: nuevoCosto.concepto,
                      periodo, valor: v, creadoPor: session?.id,
                    })
                    setCostos(await loadEquipoCostos({ equipoCodigo: equipo, desde: periodo, hasta: periodo }))
                    setNuevoCosto(null); setInfo('Costo cargado.')
                  } catch (err) {
                    setError(`No se pudo guardar. (${(err as { message?: string })?.message ?? 'error'})`)
                  } finally { setBusy(false) }
                }}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
