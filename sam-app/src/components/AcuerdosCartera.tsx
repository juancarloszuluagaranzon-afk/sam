import { useEffect, useMemo, useState } from 'react'
import type { Assignment } from '../domain/sam'
import { aligerarDocumento } from '../lib/pdfLigero'
import {
  ESTADOS_ACUERDO, anularAcuerdo, anularPago, armarPlan, claveHacienda, estadoAcuerdo, guardarAcuerdo,
  ligarFacturaAcuerdo, loadPagosAcuerdo, nombreCuota, pesos, registrarPago, sumarDias,
  type Acuerdo, type Cuota, type CuotaConEstado, type FacturaCartera, type Pago,
} from '../services/carteraApi'

/**
 * ACUERDOS DE PAGO con proveedores / colonos (21-oct-2026). Cristian negocia con el
 * colono (anticipo de un % de la labor y cuotas a 30, 60, 90 días…); Carlos David lo
 * registra aquí. Regla de Iván: «el anticipo se descuenta de la factura final»: el
 * pago del anticipo queda en el acuerdo y pasa a la factura cuando se liga.
 * Ver `services/carteraApi` y la migración 20261021120000.
 */

const aPesos = (s: string) => Number(s.replace(/[^\d,]/g, '').replace(',', '.')) || 0
const miles = (n: number) => (n ? Math.round(n).toLocaleString('es-CO') : '')
const MEDIOS = ['TRANSFERENCIA', 'CONSIGNACIÓN', 'CHEQUE', 'EFECTIVO', 'CRUCE DE CUENTAS']

function ChipCuota({ c }: { c: CuotaConEstado }) {
  if (c.estado === 'PAGADA') return <span className="cart-chip cart--ok">Pagada ✓</span>
  if (c.estado === 'VENCIDA') return <span className="cart-chip cart--mal">Vencida hace {c.dias} día{c.dias === 1 ? '' : 's'}</span>
  const cuando = c.dias === 0 ? 'Vence hoy' : `Vence en ${c.dias} día${c.dias === 1 ? '' : 's'}`
  return (
    <span className={`cart-chip ${c.estado === 'PRONTO' ? 'cart--ojo' : 'cart--neutro'}`}>
      {cuando}{c.cubierto > 0 ? ` · falta ${pesos(c.falta)}` : ''}
    </span>
  )
}

/** «Anticipo 30 % + 3 cuotas» */
function resumenPlan(a: Pick<Acuerdo, 'anticipo' | 'valor' | 'nCuotas'>) {
  const partes: string[] = []
  if (a.anticipo > 0) partes.push(`Anticipo ${a.valor ? Math.round((a.anticipo / a.valor) * 100) : 0} %`)
  if (a.nCuotas > 0) partes.push(`${a.nCuotas} cuota${a.nCuotas === 1 ? '' : 's'}`)
  return partes.join(' + ') || '—'
}

// ── Lista ───────────────────────────────────────────────────────────────────
export function ListaAcuerdos({ acuerdos, hoy, onAbrir, onNuevo }: {
  acuerdos: Acuerdo[]; hoy: string; onAbrir: (a: Acuerdo) => void; onNuevo: () => void
}) {
  const [ver, setVer] = useState<'VIGENTES' | 'TODOS'>('VIGENTES')
  const [buscar, setBuscar] = useState('')
  const filas = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    return acuerdos
      .map((a) => ({ a, e: estadoAcuerdo(a, hoy) }))
      .filter(({ e }) => ver === 'TODOS' || (e.estado !== 'ANULADO' && e.estado !== 'CUMPLIDO'))
      .filter(({ a }) => !q || `${a.colono} ${a.haciendas.join(' ')} ${a.negociadoPor} ${a.facturas ?? ''}`.toLowerCase().includes(q))
  }, [acuerdos, hoy, ver, buscar])

  return (
    <>
      <div className="acu-herramientas">
        <button type="button" className="primary-button" onClick={onNuevo}>＋ Nuevo acuerdo</button>
        <select className="base-input" style={{ width: 'auto' }} value={ver} onChange={(e) => setVer(e.target.value as typeof ver)} aria-label="Qué acuerdos ver">
          <option value="VIGENTES">Vigentes</option>
          <option value="TODOS">Todos (también cumplidos y anulados)</option>
        </select>
        <input className="user-search-input" type="search" placeholder="Buscar colono o hacienda…" value={buscar}
          onChange={(e) => setBuscar(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
      </div>
      <div className="table-wrap validacion-table-wrap">
        <table className="validacion-table">
          <thead>
            <tr>
              <th>Colono</th><th>Plan</th><th>Próxima cuota</th><th className="num">Pagado</th><th className="num">Saldo</th><th>Factura</th>
            </tr>
          </thead>
          <tbody>
            {filas.map(({ a, e }) => {
              const info = ESTADOS_ACUERDO[e.estado]
              return (
                <tr key={a.id} className="cart-fila" onClick={() => onAbrir(a)}>
                  <td>
                    <b>{a.colono}</b>
                    <small className="subtle-copy acu-sub">{a.haciendas.join(' · ') || 'sin hacienda'} · negoció {a.negociadoPor}</small>
                  </td>
                  <td>{resumenPlan(a)}<small className="subtle-copy acu-sub">{pesos(a.valor)}</small></td>
                  <td>
                    {e.proxima && e.estado !== 'ANULADO' ? (
                      <>
                        <span className="acu-nowrap">{e.proxima.vence}</span>
                        <small className="subtle-copy acu-sub">{nombreCuota(e.proxima, a.nCuotas)}</small>
                        <small className="acu-sub"><ChipCuota c={e.vencidas[0] ?? e.proxima} /></small>
                      </>
                    ) : <span className={`cart-chip ${info.clase}`}>{info.titulo}</span>}
                  </td>
                  <td className="num">{pesos(a.pagado)}</td>
                  <td className="num"><strong>{e.estado === 'ANULADO' ? '—' : pesos(e.saldo)}</strong></td>
                  <td>
                    {a.facturas ?? (a.porDescontar > 0
                      ? <small className="factura-chip factura-chip--falta" title="El anticipo se descuenta de la factura final">sin factura · anticipo {pesos(a.porDescontar)}</small>
                      : <small className="subtle-copy">sin factura</small>)}
                  </td>
                </tr>
              )
            })}
            {filas.length === 0 && (
              <tr><td colSpan={6} className="validacion-empty">
                {acuerdos.length === 0
                  ? 'Todavía no hay acuerdos. Cuando Cristian acuerde con un colono un anticipo o un plazo, regístralo con «＋ Nuevo acuerdo».'
                  : 'Nada en este filtro.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ── Formulario: nuevo o editar ──────────────────────────────────────────────
export interface PrefillAcuerdo {
  colono?: string
  valor?: number | null
  haciendas?: string[]
  /** Al guardar, esta factura queda ligada al acuerdo. */
  facturaId?: string
  facturaNumero?: string
}

export function AcuerdoForm({ acuerdo, prefill, haciendasConocidas, colonosConocidos, hoy, usuario, onCerrar, onGuardado }: {
  acuerdo?: Acuerdo | null
  prefill?: PrefillAcuerdo | null
  haciendasConocidas: string[]
  colonosConocidos: string[]
  hoy: string
  usuario: string
  onCerrar: () => void
  onGuardado: (id: string, mensaje: string) => void
}) {
  const [colono, setColono] = useState(acuerdo?.colono ?? prefill?.colono ?? '')
  const [telefono, setTelefono] = useState(acuerdo?.telefono ?? '')
  const [haciendas, setHaciendas] = useState<string[]>(acuerdo?.haciendas ?? prefill?.haciendas ?? [])
  const [hacienda, setHacienda] = useState('')
  const [fecha, setFecha] = useState(acuerdo?.fecha ?? hoy)
  const [negocio, setNegocio] = useState(acuerdo?.negociadoPor ?? 'Cristian')
  const [condiciones, setCondiciones] = useState(acuerdo?.condiciones ?? '')
  const valorInicial = acuerdo?.valor ?? prefill?.valor ?? 0
  const [valor, setValor] = useState(miles(valorInicial))
  const anticipoInicial = acuerdo?.anticipo ?? 0
  const [anticipo, setAnticipo] = useState(miles(anticipoInicial))
  const [pct, setPct] = useState(anticipoInicial && valorInicial ? String(Math.round((anticipoInicial / valorInicial) * 1000) / 10) : '')
  const cuotaAnticipo = acuerdo?.cuotas.find((c) => c.anticipo)
  const [fechaAnticipo, setFechaAnticipo] = useState(cuotaAnticipo?.vence ?? acuerdo?.fecha ?? hoy)
  const normales = acuerdo?.cuotas.filter((c) => !c.anticipo) ?? []
  const [nCuotas, setNCuotas] = useState(acuerdo ? normales.length : prefill?.facturaId ? 1 : 3)
  const [primera, setPrimera] = useState(normales[0]?.vence ?? sumarDias(hoy, 30))
  const [cada, setCada] = useState(normales.length > 1 ? Math.max(1, Math.round((Date.parse(normales[1].vence) - Date.parse(normales[0].vence)) / 86_400_000)) : 30)
  // null = el plan se arma solo con los datos de arriba; con filas = lo editaron a mano.
  const [planManual, setPlanManual] = useState<Cuota[] | null>(acuerdo ? acuerdo.cuotas.map((c) => ({ ...c })) : null)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const nValor = aPesos(valor)
  const nAnticipo = aPesos(anticipo)
  const planAuto = useMemo(
    () => armarPlan({ valor: nValor, anticipo: nAnticipo, fechaAnticipo, nCuotas, primera, cadaDias: cada }),
    [nValor, nAnticipo, fechaAnticipo, nCuotas, primera, cada],
  )
  const plan = planManual ?? planAuto
  const sumaPlan = plan.reduce((s, c) => s + c.valor, 0)
  const nNormales = plan.filter((c) => !c.anticipo).length

  // Cambiar los datos de arriba vuelve a armar el plan solo.
  function auto<T>(set: (v: T) => void) { return (v: T) => { set(v); setPlanManual(null) } }

  function cambiarValor(texto: string) {
    setValor(texto); setPlanManual(null)
    const v = aPesos(texto)
    const p = Number(pct.replace(',', '.'))
    if (p > 0 && v > 0) setAnticipo(miles((v * p) / 100))
  }
  function cambiarPct(texto: string) {
    setPct(texto); setPlanManual(null)
    const p = Number(texto.replace(',', '.'))
    setAnticipo(p > 0 && nValor > 0 ? miles((nValor * Math.min(p, 100)) / 100) : '')
  }
  function cambiarAnticipo(texto: string) {
    setAnticipo(texto); setPlanManual(null)
    const a = aPesos(texto)
    setPct(a > 0 && nValor > 0 ? String(Math.round((a / nValor) * 1000) / 10) : '')
  }
  function editarFila(i: number, cambio: Partial<Cuota>) {
    setPlanManual(plan.map((c, j) => (j === i ? { ...c, ...cambio } : c)))
  }
  function agregarHacienda(nombre: string) {
    const h = nombre.trim()
    if (!h) return
    if (!haciendas.some((x) => claveHacienda(x) === claveHacienda(h))) setHaciendas([...haciendas, h.toUpperCase()])
    setHacienda('')
  }

  async function guardar() {
    setError('')
    if (!colono.trim()) return setError('Escribe con quién es el acuerdo (el colono).')
    if (!negocio.trim()) return setError('Escribe quién negoció el acuerdo.')
    const cuotas = plan.filter((c) => c.valor > 0)
    if (cuotas.length === 0) return setError('Pon el valor de la labor y las cuotas: el plan está vacío.')
    if (cuotas.some((c) => !c.vence)) return setError('Cada cuota necesita su fecha.')
    setOcupado(true)
    try {
      const id = await guardarAcuerdo(acuerdo?.id ?? null, {
        colono: colono.trim(), telefono: telefono.trim(), haciendas, fecha, negociadoPor: negocio.trim(), condiciones: condiciones.trim(),
      }, cuotas, usuario)
      let msg = acuerdo ? `Acuerdo con ${colono.trim()} actualizado.` : `Acuerdo con ${colono.trim()} registrado.`
      if (prefill?.facturaId) {
        const descontado = await ligarFacturaAcuerdo(prefill.facturaId, id, usuario)
        msg += ` La factura ${prefill.facturaNumero ?? ''} quedó en el acuerdo${descontado > 0 ? ` (anticipo descontado: ${pesos(descontado)})` : ''}.`
      }
      onGuardado(id, msg)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="modal-overlay open" onClick={() => { if (!ocupado) onCerrar() }}>
      <div className="modal-card acu-modal" onClick={(e) => e.stopPropagation()}>
        <div className="labor-detail-header">
          <div>
            <p className="eyebrow">{acuerdo ? 'Cambiar acuerdo de pago' : 'Nuevo acuerdo de pago'}{prefill?.facturaNumero ? ` · factura ${prefill.facturaNumero}` : ''}</p>
            <h3>{colono.trim() || 'Acuerdo con un colono'}</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onCerrar} disabled={ocupado} aria-label="Cerrar">&#x2715;</button>
        </div>

        <p className="eyebrow acu-paso">1 · Con quién</p>
        <div className="assignment-detail-field-grid">
          <label className="assignment-detail-field"><span>Colono / proveedor</span>
            <input id="acu-colono" list="acu-colonos" value={colono} onChange={(e) => setColono(e.target.value)} disabled={ocupado} autoFocus placeholder="Ej.: Juan Pérez" />
            <datalist id="acu-colonos">{colonosConocidos.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <label className="assignment-detail-field"><span>Teléfono (opcional)</span>
            <input id="acu-telefono" inputMode="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} disabled={ocupado} /></label>
          <label className="assignment-detail-field acu-ancho"><span>Sus haciendas (las labores que cubre el acuerdo)</span>
            <div className="acu-hacienda-add">
              <input id="acu-hacienda" list="acu-haciendas" value={hacienda} onChange={(e) => setHacienda(e.target.value)} disabled={ocupado}
                placeholder="Escribe o escoge una hacienda"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregarHacienda(hacienda) } }} />
              <button type="button" className="inline-button" disabled={ocupado || !hacienda.trim()} onClick={() => agregarHacienda(hacienda)}>Agregar</button>
            </div>
            <datalist id="acu-haciendas">{haciendasConocidas.map((h) => <option key={h} value={h} />)}</datalist>
            {haciendas.length > 0 && (
              <span className="acu-chips">
                {haciendas.map((h) => (
                  <span key={h} className="acu-chip">{h}
                    <button type="button" aria-label={`Quitar ${h}`} disabled={ocupado} onClick={() => setHaciendas(haciendas.filter((x) => x !== h))}>✕</button>
                  </span>
                ))}
              </span>
            )}
          </label>
          <label className="assignment-detail-field"><span>Negoció</span>
            <input id="acu-negocio" value={negocio} onChange={(e) => setNegocio(e.target.value)} disabled={ocupado} /></label>
          <label className="assignment-detail-field"><span>Fecha del acuerdo</span>
            <input id="acu-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} disabled={ocupado} /></label>
        </div>

        <p className="eyebrow acu-paso">2 · Cuánto y cómo paga</p>
        <div className="assignment-detail-field-grid">
          <label className="assignment-detail-field acu-ancho"><span>Valor de la labor (aproximado)</span>
            <input id="acu-valor" inputMode="numeric" value={valor} onChange={(e) => cambiarValor(e.target.value)} disabled={ocupado} placeholder="Ej.: 12.000.000"
              onBlur={() => setValor(miles(nValor))} /></label>
          <label className="assignment-detail-field"><span>Anticipo (%)</span>
            <input id="acu-pct" inputMode="decimal" value={pct} onChange={(e) => cambiarPct(e.target.value)} disabled={ocupado} placeholder="Ej.: 30" /></label>
          <label className="assignment-detail-field"><span>Anticipo ($)</span>
            <input id="acu-anticipo" inputMode="numeric" value={anticipo} onChange={(e) => cambiarAnticipo(e.target.value)} disabled={ocupado} placeholder="0 = sin anticipo" /></label>
          {nAnticipo > 0 && (
            <label className="assignment-detail-field"><span>El anticipo se paga el</span>
              <input id="acu-fecha-anticipo" type="date" value={fechaAnticipo} onChange={(e) => auto(setFechaAnticipo)(e.target.value)} disabled={ocupado} /></label>
          )}
          <label className="assignment-detail-field"><span>Cuotas{nAnticipo > 0 ? ' (después del anticipo)' : ''}</span>
            <select id="acu-ncuotas" value={nCuotas} onChange={(e) => auto(setNCuotas)(Number(e.target.value))} disabled={ocupado}>
              {[0, 1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
                <option key={n} value={n}>{n === 0 ? 'Ninguna (solo anticipo)' : n}</option>
              ))}
            </select></label>
          {nCuotas > 0 && (
            <>
              <label className="assignment-detail-field"><span>Primera cuota</span>
                <input id="acu-primera" type="date" value={primera} onChange={(e) => auto(setPrimera)(e.target.value)} disabled={ocupado} /></label>
              {nCuotas > 1 && (
                <label className="assignment-detail-field"><span>Una cada</span>
                  <select id="acu-cada" value={cada} onChange={(e) => auto(setCada)(Number(e.target.value))} disabled={ocupado}>
                    {[15, 30, 45, 60, 90].map((d) => <option key={d} value={d}>{d} días</option>)}
                  </select></label>
              )}
            </>
          )}
        </div>

        <p className="eyebrow acu-paso">3 · Así queda el plan de pagos {planManual && <small>(editado a mano · <button type="button" className="af-link" onClick={() => setPlanManual(null)} disabled={ocupado}>volver a calcular</button>)</small>}</p>
        {plan.length === 0 ? (
          <p className="subtle-copy">Escribe el valor de la labor para ver el plan.</p>
        ) : (
          <table className="acu-plan">
            <thead><tr><th>Pago</th><th>Fecha</th><th className="num">Valor</th></tr></thead>
            <tbody>
              {plan.map((c, i) => (
                <tr key={`${c.orden}-${i}`} className={c.anticipo ? 'acu-plan__anticipo' : ''}>
                  <td>{nombreCuota(c, nNormales)}</td>
                  <td><input type="date" value={c.vence} onChange={(e) => editarFila(i, { vence: e.target.value })} disabled={ocupado} aria-label={`Fecha de ${nombreCuota(c, nNormales)}`} /></td>
                  <td className="num"><input inputMode="numeric" value={miles(c.valor)} onChange={(e) => editarFila(i, { valor: aPesos(e.target.value) })} disabled={ocupado} aria-label={`Valor de ${nombreCuota(c, nNormales)}`} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={2}>Total del plan</td><td className="num"><b>{pesos(sumaPlan)}</b></td></tr></tfoot>
          </table>
        )}
        {nValor > 0 && Math.abs(sumaPlan - nValor) > 0.5 && plan.length > 0 && (
          <p className="field-hint">El plan suma {pesos(sumaPlan)} y la labor {pesos(nValor)}: revisa los valores (o «volver a calcular»).</p>
        )}
        {nAnticipo > 0 && (
          <p className="field-hint">💡 El anticipo se registra aquí cuando el colono lo pague y <b>se descuenta de la factura final</b>.</p>
        )}

        <label className="assignment-detail-field" style={{ marginTop: 10 }}><span>Lo que se acordó, en palabras (opcional)</span>
          <input id="acu-condiciones" value={condiciones} onChange={(e) => setCondiciones(e.target.value)} disabled={ocupado}
            placeholder="Ej.: paga el anticipo antes de empezar y el resto a 30, 60 y 90 días" /></label>

        {error && <p className="feedback error">{error}</p>}
        <div className="modal-footer">
          <button type="button" className="inline-button" onClick={onCerrar} disabled={ocupado}>Cancelar</button>
          <button type="button" className="primary-button" onClick={() => void guardar()} disabled={ocupado}>
            {ocupado ? 'Guardando…' : acuerdo ? 'Guardar cambios' : 'Guardar acuerdo'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Detalle ─────────────────────────────────────────────────────────────────
export function AcuerdoDetalle({ acuerdo: a, facturas, assignments, hoy, usuario, onCambio, onError, onCerrar, onEditar, onAbrirFactura }: {
  acuerdo: Acuerdo
  facturas: FacturaCartera[]
  assignments: Assignment[]
  hoy: string
  usuario: string
  onCambio: (msg: string) => Promise<void>
  onError: (m: string) => void
  onCerrar: () => void
  onEditar: () => void
  onAbrirFactura: (f: FacturaCartera) => void
}) {
  const [pagos, setPagos] = useState<Pago[]>([])
  const [fecha, setFecha] = useState(hoy)
  const [valor, setValor] = useState('')
  const [medio, setMedio] = useState('TRANSFERENCIA')
  const [referencia, setReferencia] = useState('')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [facturaLigar, setFacturaLigar] = useState('')
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => { void loadPagosAcuerdo(a.id).then(setPagos) }, [a.id, a.pagado, a.porDescontar])

  const e = estadoAcuerdo(a, hoy)
  const info = ESTADOS_ACUERDO[e.estado]
  const suyas = facturas.filter((f) => f.acuerdoId === a.id)
  const numeroFactura = (id: string | null) => facturas.find((f) => f.id === id)?.numero ?? 'la factura'
  const vencido = e.vencidas.reduce((s, c) => s + c.falta, 0)
  // Facturas que se pueden ligar: las que no tienen acuerdo y no están pagadas; primero las de sus haciendas.
  const claves = useMemo(() => new Set(a.haciendas.map(claveHacienda)), [a.haciendas])
  const facturasDeSusHaciendas = new Set(assignments.filter((x) => x.facturaId && claves.has(claveHacienda(x.haciendaName))).map((x) => x.facturaId))
  const libres = facturas
    .filter((f) => !f.acuerdoId && f.estado !== 'PAGADA')
    .sort((x, y) => Number(facturasDeSusHaciendas.has(y.id)) - Number(facturasDeSusHaciendas.has(x.id)))
  // Labores de sus haciendas: cuántas hay realizadas y cuántas faltan por facturar.
  const labores = useMemo(() => {
    const r = assignments.filter((x) => claves.has(claveHacienda(x.haciendaName)) && (x.status === 'COMPLETADA' || x.status === 'PARCIAL') && x.executedArea > 0)
    const sin = r.filter((x) => !x.facturaId)
    return { n: r.length, ha: r.reduce((s, x) => s + x.executedArea, 0), sin: sin.length, haSin: sin.reduce((s, x) => s + x.executedArea, 0) }
  }, [assignments, claves])

  async function hacer(fn: () => Promise<void>, msg: string) {
    setOcupado(true)
    try { await fn(); await onCambio(msg) } catch (err) { onError((err as Error).message) } finally { setOcupado(false) }
  }

  async function ligar() {
    const numero = numeroFactura(facturaLigar)
    setOcupado(true)
    try {
      const d = await ligarFacturaAcuerdo(facturaLigar, a.id, usuario)
      setFacturaLigar('')
      await onCambio(`Factura ${numero} ligada al acuerdo con ${a.colono}${d > 0 ? `: se le descontó el anticipo (${pesos(d)})` : ''}.`)
    } catch (err) { onError((err as Error).message) } finally { setOcupado(false) }
  }

  const sinFactura = suyas.length === 0
  const destinoPago = sinFactura
    ? 'Todavía no hay factura: el pago queda como anticipo y se descuenta de la factura final.'
    : `Se abona a la factura ${suyas.map((f) => f.numero).join(', ')} y cubre las cuotas en orden.`

  return (
    <div className="modal-overlay open" onClick={() => { if (!ocupado) onCerrar() }}>
      <div className="modal-card acu-modal" onClick={(ev) => ev.stopPropagation()}>
        <div className="labor-detail-header">
          <div>
            <p className="eyebrow">Acuerdo de pago · negoció {a.negociadoPor} · {a.fecha}</p>
            <h3>{a.colono} <span className={`cart-chip ${info.clase}`}>{info.titulo}</span></h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onCerrar} disabled={ocupado} aria-label="Cerrar">&#x2715;</button>
        </div>

        {a.anulado && <p className="cart-alerta">Anulado: {a.anuladoMotivo}</p>}

        <dl className="assignment-detail-grid">
          <div className="assignment-detail-row"><dt>Haciendas</dt><dd>{a.haciendas.join(' · ') || '—'}</dd></div>
          {a.telefono && <div className="assignment-detail-row"><dt>Teléfono</dt><dd><a href={`tel:${a.telefono}`}>{a.telefono}</a></dd></div>}
          {a.condiciones && <div className="assignment-detail-row"><dt>Lo acordado</dt><dd>{a.condiciones}</dd></div>}
          <div className="assignment-detail-row"><dt>Valor del plan</dt><dd>{pesos(a.valor)} <small className="subtle-copy">({resumenPlan(a)})</small></dd></div>
          <div className="assignment-detail-row"><dt>Pagado</dt><dd>{pesos(a.pagado)}</dd></div>
          <div className="assignment-detail-row"><dt>Saldo</dt><dd><b>{pesos(e.saldo)}</b>{vencido > 0 && <small className="acu-rojo"> · vencido {pesos(vencido)}</small>}</dd></div>
          {a.anticipo > 0 && (
            <div className="assignment-detail-row"><dt>Anticipo</dt><dd>
              {a.anticipoPagado <= 0 ? 'todavía no lo ha pagado'
                : a.porDescontar > 0 ? <>{pesos(a.anticipoPagado)} pagado · <b>se descuenta de la factura final</b></>
                : <>{pesos(a.anticipoPagado)} pagado · descontado de {a.facturas}</>}
            </dd></div>
          )}
        </dl>

        <p className="eyebrow" style={{ marginTop: 14 }}>Plan de pagos</p>
        <table className="acu-plan acu-plan--ver">
          <thead><tr><th>Pago</th><th>Fecha</th><th className="num">Valor</th><th>Estado</th></tr></thead>
          <tbody>
            {e.cuotas.map((c) => (
              <tr key={c.id ?? c.orden} className={c.estado === 'VENCIDA' ? 'acu-plan__vencida' : c.estado === 'PAGADA' ? 'acu-plan__pagada' : ''}>
                <td>{nombreCuota(c, a.nCuotas)}</td>
                <td className="nowrap">{c.vence}</td>
                <td className="num">{pesos(c.valor)}</td>
                <td><ChipCuota c={c} /></td>
              </tr>
            ))}
          </tbody>
        </table>

        {!a.anulado && e.estado !== 'CUMPLIDO' && (
          <>
            <p className="eyebrow" style={{ marginTop: 14 }}>Registrar pago</p>
            <p className="field-hint" style={{ marginTop: 0 }}>{destinoPago}</p>
            <div className="assignment-detail-field-grid">
              <label className="assignment-detail-field"><span>Fecha</span>
                <input id="acu-pago-fecha" type="date" value={fecha} max={hoy} onChange={(ev) => setFecha(ev.target.value)} disabled={ocupado} /></label>
              <label className="assignment-detail-field"><span>Valor</span>
                <input id="acu-pago-valor" inputMode="numeric" value={valor} onChange={(ev) => setValor(ev.target.value)} disabled={ocupado}
                  placeholder={e.proxima ? miles(e.proxima.falta) : '0'} />
                <span className="acu-atajos">
                  {e.proxima && (
                    <button type="button" className="af-link" disabled={ocupado} onClick={() => setValor(miles(e.proxima?.falta ?? 0))}>
                      {nombreCuota(e.proxima, a.nCuotas)} ({pesos(e.proxima.falta)})
                    </button>
                  )}
                  {vencido > 0 && e.vencidas.length > 1 && (
                    <button type="button" className="af-link" disabled={ocupado} onClick={() => setValor(miles(vencido))}>Todo lo vencido ({pesos(vencido)})</button>
                  )}
                </span></label>
              <label className="assignment-detail-field"><span>Medio</span>
                <select id="acu-pago-medio" value={medio} onChange={(ev) => setMedio(ev.target.value)} disabled={ocupado}>
                  {MEDIOS.map((m) => <option key={m}>{m}</option>)}
                </select></label>
              <label className="assignment-detail-field"><span>Referencia</span>
                <input id="acu-pago-ref" value={referencia} onChange={(ev) => setReferencia(ev.target.value)} disabled={ocupado} /></label>
              <label className="assignment-detail-field acu-ancho"><span>Comprobante (opcional)</span>
                <input id="acu-pago-archivo" type="file" accept="application/pdf,image/jpeg,image/png,image/webp"
                  onChange={(ev) => setArchivo(ev.target.files?.[0] ?? null)} disabled={ocupado} /></label>
            </div>
            <button type="button" className="primary-button" disabled={ocupado || !(aPesos(valor) > 0) || !fecha}
              onClick={() => void hacer(async () => {
                const liviano = archivo ? (await aligerarDocumento(archivo)).archivo : null
                await registrarPago({ acuerdoId: a.id, fecha, valor: aPesos(valor), medio, referencia, creadoPor: usuario }, liviano)
                setValor(''); setReferencia(''); setArchivo(null)
              }, `Pago de ${pesos(aPesos(valor))} registrado al acuerdo con ${a.colono}${sinFactura ? ' (anticipo: se descuenta de la factura final)' : ''}.`)}>
              {ocupado ? 'Guardando…' : 'Registrar pago'}
            </button>
          </>
        )}

        <p className="eyebrow" style={{ marginTop: 14 }}>Pagos</p>
        {pagos.length === 0 && <p className="subtle-copy">Sin pagos todavía.</p>}
        <ul className="cart-pagos">
          {pagos.map((p) => (
            <li key={p.id} className={p.anulado ? 'cart-pago--anulado' : ''}>
              <span><b>{pesos(p.valor)}</b> · {p.fecha} · {p.medio ?? ''}{p.referencia ? ` · ${p.referencia}` : ''}
                {' '}{p.anticipo
                  ? <small className="factura-chip">{p.facturaId ? `anticipo · descontado de ${numeroFactura(p.facturaId)}` : 'anticipo · se descuenta de la factura final'}</small>
                  : p.facturaId && <small className="subtle-copy">a {numeroFactura(p.facturaId)}</small>}
                {p.anulado && <small> — ANULADO: {p.anuladoMotivo}</small>}</span>
              {!p.anulado && (
                <span className="cart-pago-acc">
                  <button type="button" className="af-link" disabled={ocupado} onClick={() => {
                    const m = window.prompt('¿Por qué se anula este pago? (queda registrado)')
                    if (m && m.trim()) void hacer(() => anularPago(p.id, m, usuario), 'Pago anulado.')
                  }}>Anular</button>
                </span>
              )}
            </li>
          ))}
        </ul>

        <p className="eyebrow" style={{ marginTop: 14 }}>Factura</p>
        {suyas.length === 0 && <p className="subtle-copy">Todavía no tiene factura. Cuando la hagas en Facturación con labores de sus haciendas, la app ofrece ligarla a este acuerdo; o lígala aquí.</p>}
        {suyas.length > 0 && <ul className="cart-pagos">
          {suyas.map((f) => (
            <li key={f.id}>
              <span>
                <button type="button" className="af-link" onClick={() => onAbrirFactura(f)}><b>{f.numero}</b></button>
                {' '}· {pesos(f.valor)}{f.anticipo > 0 && <> · anticipo descontado {pesos(f.anticipo)}</>} · saldo <b>{pesos(f.saldo)}</b>
              </span>
              {!a.anulado && (
                <span className="cart-pago-acc">
                  <button type="button" className="af-link" disabled={ocupado}
                    onClick={() => { if (window.confirm(`¿Quitar la factura ${f.numero} de este acuerdo? Si tenía el anticipo descontado, el anticipo vuelve al acuerdo.`)) void hacer(async () => { await ligarFacturaAcuerdo(f.id, null, usuario) }, `Factura ${f.numero} fuera del acuerdo.`) }}>
                    Quitar
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>}
        {!a.anulado && libres.length > 0 && (
          <div className="acu-ligar">
            <select className="base-input" value={facturaLigar} onChange={(ev) => setFacturaLigar(ev.target.value)} disabled={ocupado} aria-label="Factura para ligar">
              <option value="">Ligar una factura…</option>
              {libres.map((f) => (
                <option key={f.id} value={f.id}>{facturasDeSusHaciendas.has(f.id) ? '★ ' : ''}{f.numero} · {f.cliente ?? ''} · {f.fecha} · {pesos(f.valor)}</option>
              ))}
            </select>
            <button type="button" className="inline-button" disabled={ocupado || !facturaLigar} onClick={() => void ligar()}>
              Ligar
            </button>
          </div>
        )}

        {a.haciendas.length > 0 && (
          <p className="subtle-copy" style={{ marginTop: 12 }}>
            🚜 En sus haciendas: {labores.n} labor{labores.n === 1 ? '' : 'es'} realizada{labores.n === 1 ? '' : 's'} ({labores.ha.toLocaleString('es-CO', { maximumFractionDigits: 1 })} ha)
            {labores.sin > 0 && <> · <b>{labores.sin} sin facturar</b> ({labores.haSin.toLocaleString('es-CO', { maximumFractionDigits: 1 })} ha)</>}
          </p>
        )}

        {!a.anulado && (
          <div className="acu-acciones">
            <button type="button" className="inline-button" disabled={ocupado}
              onClick={() => {
                const m = window.prompt(`¿Por qué se anula el acuerdo con ${a.colono}? (queda registrado)`)
                if (m && m.trim()) void hacer(() => anularAcuerdo(a.id, m, usuario), `Acuerdo con ${a.colono} anulado.`)
              }}>Anular acuerdo</button>
            <button type="button" className="inline-button" disabled={ocupado} onClick={onEditar}>✎ Cambiar el acuerdo</button>
          </div>
        )}
      </div>
    </div>
  )
}
