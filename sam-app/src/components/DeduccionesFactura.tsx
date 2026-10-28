import { useEffect, useMemo, useRef, useState } from 'react'
import type { UserProfile } from '../domain/sam'
import {
  CONCEPTOS_REPETIBLES, etiquetaDeduccion, excedeValor, propuestaDeducciones, redondear2, reglasEfectivas,
  totalItems, validarItem,
  type ConceptoDeduccion, type ItemDeduccion, type ReglaDeduccion,
} from '../lib/deduccionesCartera'
import { fmtFechaHora } from '../lib/fechas'
import {
  TIPOS_CLIENTE, agregarObservacion, anularDeduccion, aplicarDeducciones, asignarClientesFactura,
  loadDeducciones, loadObservaciones, pesos,
  type ClienteFact, type Deduccion, type FacturaCartera, type Observacion,
} from '../services/carteraApi'
import SearchableSelect from './SearchableSelect'
import './carteraContable.css'

/**
 * CARTERA CONTABLE (Ola 2, 27-oct-2026) — las tres secciones que se abren dentro
 * del detalle de una factura en Cartera:
 *
 *   Quién         → a quién se le facturó y quién paga (pueden ser distintos).
 *   Deducciones   → retefuente, reteICA y demás: bajan el saldo, pero NO son un pago.
 *   Observaciones → la bitácora de la factura; no se edita, se agrega.
 *
 * La lógica vive en `lib/deduccionesCartera` (probada aparte) y las escrituras en
 * `services/carteraApi`: aquí solo se muestra y se arma el formulario.
 */

const miles = (n: number) => Math.round(n).toLocaleString('es-CO')

/** Un valor escrito a mano: acepta coma decimal o punto (de miles o decimal). */
function aNumero(texto: string): number {
  const limpio = texto.replace(/[^\d.,]/g, '')
  if (!limpio) return 0
  if (limpio.includes(',')) return Number(limpio.replace(/\./g, '').replace(',', '.')) || 0
  const partes = limpio.split('.')
  // Sin coma: un último punto con 1 o 2 dígitos es decimal; si no, es separador de miles.
  if (partes.length > 1 && /^\d{1,2}$/.test(partes[partes.length - 1])) {
    return Number(`${partes.slice(0, -1).join('')}.${partes[partes.length - 1]}`) || 0
  }
  return Number(limpio.replace(/\./g, '')) || 0
}

const aPorcentaje = (texto: string) => Number(texto.replace(',', '.')) || 0

function tituloTipo(tipo: string): string {
  return TIPOS_CLIENTE.find((t) => t.id === tipo)?.titulo ?? tipo
}

// ── QUIÉN: a quién se le facturó y quién paga ───────────────────────────────
export function SeccionClientesFactura({ factura, clientes, usuario, onCambio, onError }: {
  factura: FacturaCartera
  clientes: ClienteFact[]
  usuario: string
  onCambio: (msg: string) => Promise<void>
  onError: (m: string) => void
}) {
  const [facturadoA, setFacturadoA] = useState(factura.facturadoAId ?? '')
  const [pagador, setPagador] = useState(factura.pagadorId ?? '')
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    setFacturadoA(factura.facturadoAId ?? '')
    setPagador(factura.pagadorId ?? '')
  }, [factura.id, factura.facturadoAId, factura.pagadorId])

  // Solo los activos… más el que ya esté asignado, aunque lo hayan desactivado.
  const opciones = useMemo(
    () => clientes
      .filter((c) => c.activo || c.id === factura.facturadoAId || c.id === factura.pagadorId)
      .map((c) => ({ value: c.id, label: c.nombre, rightLabel: tituloTipo(c.tipo) })),
    [clientes, factura.facturadoAId, factura.pagadorId],
  )

  const cambió = facturadoA !== (factura.facturadoAId ?? '') || pagador !== (factura.pagadorId ?? '')

  async function guardar() {
    setOcupado(true)
    try {
      await asignarClientesFactura(factura.id, facturadoA || null, pagador || null, usuario)
      await onCambio('Clientes de la factura actualizados.')
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  if (clientes.length === 0) {
    return <p className="cc-vacio">Todavía no hay clientes: créalos en la pestaña Clientes.</p>
  }

  return (
    <div className="cc-seccion">
      {/* div y no label: un clic en una opción subiría al label y reabriría la lista. */}
      <div className="cc-campo">
        <span>Facturado a</span>
        <SearchableSelect value={facturadoA} onChange={setFacturadoA} options={opciones} placeholder="Sin asignar" disabled={ocupado} />
      </div>
      <div className="cc-campo">
        <span>Quién paga</span>
        <SearchableSelect value={pagador} onChange={setPagador} options={opciones} placeholder="Igual al facturado" disabled={ocupado} />
      </div>
      <div className="cc-botones">
        <button type="button" className="primary-button" disabled={ocupado || !cambió} onClick={() => void guardar()}>
          {ocupado ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </div>
  )
}

// ── DEDUCCIONES: lo que se descuenta del valor sin ser un pago ──────────────
/** Una fila del bloque «Por aplicar»: la propuesta o una agregada a mano. */
interface FilaDeduccion extends ItemDeduccion {
  id: string
  marcado: boolean
  valorTexto: string
  pctTexto: string
}

export function SeccionDeduccionesFactura({ factura, conceptos, reglasPorCliente, usuario, hoy, onCambio, onError }: {
  factura: FacturaCartera
  conceptos: ConceptoDeduccion[]
  reglasPorCliente: Record<string, ReglaDeduccion[]>
  usuario: string
  hoy: string
  onCambio: (msg: string) => Promise<void>
  onError: (m: string) => void
}) {
  const [aplicadas, setAplicadas] = useState<Deduccion[]>([])
  const [items, setItems] = useState<FilaDeduccion[]>([])
  const [ocupado, setOcupado] = useState(false)
  const contador = useRef(0)

  // Se recarga al cambiar de factura y cada vez que su total deducido se mueva.
  useEffect(() => {
    let vivo = true
    void loadDeducciones(factura.id).then((d) => { if (vivo) setAplicadas(d) })
    return () => { vivo = false }
  }, [factura.id, factura.deducido])

  const vivas = useMemo(() => aplicadas.filter((d) => !d.anulado), [aplicadas])
  const yaAplicados = useMemo(() => vivas.map((d) => d.concepto), [vivas])
  const reglas = useMemo(
    () => reglasEfectivas({ pagadorId: factura.pagadorId, facturadoAId: factura.facturadoAId }, reglasPorCliente),
    [factura.pagadorId, factura.facturadoAId, reglasPorCliente],
  )
  const reglasTexto = reglas.map((r) => `${r.concepto}:${r.porcentaje}`).join(',')
  const aplicadosTexto = yaAplicados.join(',')

  const conceptoDe = (codigo: string) => conceptos.find((c) => c.codigo === codigo)

  // La propuesta se rehace sola cuando cambia el valor de la factura, las reglas del
  // cliente o lo ya aplicado. Lo que el usuario escriba a mano no la dispara.
  useEffect(() => {
    const filas = propuestaDeducciones(factura.valor, reglas, yaAplicados).map((it, i): FilaDeduccion => ({
      ...it,
      id: `p${i}`,
      marcado: true,
      valorTexto: miles(it.valor),
      pctTexto: it.porcentaje != null ? String(it.porcentaje).replace('.', ',') : '',
    }))
    setItems(filas)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factura.id, factura.valor, reglasTexto, aplicadosTexto])

  // Las vivas primero; las anuladas quedan abajo, atenuadas.
  const ordenadas = useMemo(() => [...aplicadas].sort((a, b) => Number(a.anulado) - Number(b.anulado)), [aplicadas])

  function editar(id: string, cambio: Partial<FilaDeduccion>) {
    setItems((lista) => lista.map((f) => (f.id === id ? { ...f, ...cambio } : f)))
  }

  function agregar() {
    contador.current += 1
    setItems((lista) => [...lista, {
      id: `n${contador.current}`, marcado: true, concepto: '', porcentaje: null, valor: 0,
      valorTexto: '', pctTexto: '', nota: '',
    }])
  }

  function cambiarConcepto(fila: FilaDeduccion, codigo: string) {
    const concepto = conceptoDe(codigo)
    if (concepto?.modo === 'PORCENTAJE') {
      const p = aPorcentaje(fila.pctTexto)
      const valor = p > 0 && factura.valor != null ? redondear2(factura.valor * p / 100) : 0
      editar(fila.id, { concepto: codigo, porcentaje: p > 0 ? p : null, valor, valorTexto: valor > 0 ? miles(valor) : '' })
    } else {
      editar(fila.id, { concepto: codigo, porcentaje: null })
    }
  }

  function cambiarPct(fila: FilaDeduccion, texto: string) {
    const p = aPorcentaje(texto)
    const valor = p > 0 && factura.valor != null ? redondear2(factura.valor * p / 100) : 0
    editar(fila.id, { pctTexto: texto, porcentaje: p > 0 ? p : null, valor, valorTexto: valor > 0 ? miles(valor) : '' })
  }

  async function anular(d: Deduccion) {
    const motivo = window.prompt('¿Por qué se anula esta deducción? (queda registrado)')
    if (!motivo || !motivo.trim()) return
    setOcupado(true)
    try {
      await anularDeduccion(d.id, motivo.trim(), usuario)
      await onCambio('Deducción anulada.')
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  const marcadas = items.filter((f) => f.marcado)
  const totalMarcadas = totalItems(marcadas)
  const saldoHoy = Number(factura.saldo) || 0
  const saldoDespues = redondear2(Math.max(0, saldoHoy - totalMarcadas))
  const revision = excedeValor(factura.valor, Number(factura.pagado) || 0, Number(factura.deducido) || 0, totalMarcadas)
  const hayError = marcadas.some((f) => validarItem(f, conceptoDe(f.concepto)) != null)
  const puedeAplicar = marcadas.length > 0 && !hayError && !revision.excede && !ocupado

  async function aplicar() {
    if (!puedeAplicar) return
    const cuantas = marcadas.length
    const confirmado = window.confirm(
      `¿Aplicar ${cuantas} deducci${cuantas === 1 ? 'ón' : 'ones'} por ${pesos(totalMarcadas)} a la factura ${factura.numero}?`,
    )
    if (!confirmado) return
    setOcupado(true)
    try {
      await aplicarDeducciones(factura.id, marcadas, hoy, usuario)
      await onCambio(`Deducciones aplicadas: ${pesos(totalMarcadas)}`)
      setItems((lista) => lista.filter((f) => !f.marcado))
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  const sinValor = factura.valor == null
  const porAplicar = !sinValor && (factura.estado !== 'PAGADA' || (Number(factura.saldo) || 0) > 0)
  // Conceptos que aún tienen sentido ofrecer a mano: los repetibles y los que no se han aplicado.
  const disponibles = conceptos.filter((c) => CONCEPTOS_REPETIBLES.includes(c.codigo) || !yaAplicados.includes(c.codigo))

  return (
    <div className="cc-seccion">
      {aplicadas.length === 0 ? (
        <p className="cc-vacio">Sin deducciones aplicadas.</p>
      ) : (
        <ul className="cc-lista">
          {ordenadas.map((d) => (
            <li key={d.id} className={`cc-item${d.anulado ? ' cc-item--anulada' : ''}`}>
              <div className="cc-item__cuerpo">
                <span className="cc-item__nombre">{etiquetaDeduccion(d, conceptos)}</span>
                <span className="cc-item__meta">{d.createdAt ? fmtFechaHora(d.createdAt) : d.fecha}{d.nota ? ` · ${d.nota}` : ''}</span>
                {d.anulado && <span className="cc-item__meta">ANULADA: {d.anuladoMotivo ?? 'sin motivo'}</span>}
              </div>
              <div className="cc-item__lado">
                <span className="cc-item__valor">{pesos(d.valor)}</span>
                {!d.anulado && (
                  <button type="button" className="af-link" disabled={ocupado} onClick={() => void anular(d)}>Anular</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {sinValor ? (
        <p className="cc-vacio">La factura todavía no tiene valor: ponlo en «Valor y plazo de la factura» para calcular deducciones.</p>
      ) : porAplicar && (
        <>
          <p className="cc-titulo">Por aplicar</p>
          <p className="field-hint" style={{ margin: 0 }}>Baja el saldo, pero no cuenta como dinero recibido.</p>

          {reglas.length === 0 && (
            <p className="field-hint" style={{ margin: 0 }}>
              Este cliente no tiene deducciones predeterminadas: agrégalas a mano, o defínelas en la pestaña Clientes.
            </p>
          )}

          <ul className="cc-lista">
            {items.map((fila) => {
              const concepto = conceptoDe(fila.concepto)
              // Sin concepto, «El concepto no existe» no le dice nada a quien está llenando la fila.
              const error = fila.marcado ? (fila.concepto ? validarItem(fila, concepto) : 'Escoge el concepto') : null
              const manual = fila.id.startsWith('n')

              if (manual) {
                // Su propio concepto siempre está en la lista, aunque ya no se ofrezca.
                const opcionesFila = !fila.concepto || disponibles.some((c) => c.codigo === fila.concepto)
                  ? disponibles
                  : [...disponibles, ...conceptos.filter((c) => c.codigo === fila.concepto)]
                return (
                  <li key={fila.id} className="cc-fila-manual">
                    <label className="cc-check cc-check--solo">
                      <input type="checkbox" checked={fila.marcado} aria-label="Aplicar esta deducción"
                        onChange={(e) => editar(fila.id, { marcado: e.target.checked })} disabled={ocupado} />
                    </label>
                    <select value={fila.concepto} aria-label="Concepto de la deducción" disabled={ocupado}
                      onChange={(e) => cambiarConcepto(fila, e.target.value)}>
                      <option value="">Escoge el concepto…</option>
                      {opcionesFila.map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
                    </select>
                    {concepto?.modo === 'PORCENTAJE' && (
                      <input className="cc-num cc-num--pct" inputMode="decimal" value={fila.pctTexto} placeholder="%"
                        aria-label="Porcentaje" disabled={ocupado} onChange={(e) => cambiarPct(fila, e.target.value)} />
                    )}
                    <input className="cc-num" inputMode="decimal" value={fila.valorTexto} placeholder="Valor"
                      aria-label="Valor de la deducción" disabled={ocupado}
                      onChange={(e) => editar(fila.id, { valorTexto: e.target.value, valor: aNumero(e.target.value) })} />
                    <input className="cc-num cc-nota" value={fila.nota ?? ''} placeholder="Nota (opcional)"
                      aria-label="Nota" disabled={ocupado}
                      onChange={(e) => editar(fila.id, { nota: e.target.value })} />
                    <button type="button" className="cc-boton-quitar" aria-label="Quitar esta deducción" title="Quitar"
                      disabled={ocupado} onClick={() => setItems((lista) => lista.filter((x) => x.id !== fila.id))}>✕</button>
                    {error && <p className="cc-error cc-error--fila">{error}</p>}
                  </li>
                )
              }

              return (
                <li key={fila.id} className="cc-item">
                  <label className="cc-check">
                    <input type="checkbox" checked={fila.marcado} onChange={(e) => editar(fila.id, { marcado: e.target.checked })} disabled={ocupado} />
                    <span>{etiquetaDeduccion(fila, conceptos)}</span>
                  </label>
                  <input className="cc-num" inputMode="decimal" value={fila.valorTexto} aria-label="Valor de la deducción"
                    disabled={ocupado} onChange={(e) => editar(fila.id, { valorTexto: e.target.value, valor: aNumero(e.target.value) })} />
                  {error && <p className="cc-error cc-error--fila">{error}</p>}
                </li>
              )
            })}
          </ul>

          {marcadas.length > 0 && (
            <div className="cc-resumen">
              <div className="cc-resumen__fila"><span>Saldo hoy</span><strong>{pesos(saldoHoy)}</strong></div>
              <div className="cc-resumen__fila"><span>Deducciones marcadas</span><strong>{pesos(totalMarcadas)}</strong></div>
              <div className="cc-resumen__fila cc-resumen__fila--total"><span>Saldo después</span><strong>{pesos(saldoDespues)}</strong></div>
            </div>
          )}
          {revision.excede && <p className="cc-error">{revision.mensaje}</p>}

          <div className="cc-botones">
            <button type="button" className="inline-button" onClick={agregar} disabled={ocupado || disponibles.length === 0}>
              ＋ Otra deducción
            </button>
            <button type="button" className="primary-button" disabled={!puedeAplicar} onClick={() => void aplicar()}>
              {ocupado ? 'Aplicando…' : marcadas.length === 0 ? 'Aplicar deducciones'
                : `Aplicar ${marcadas.length} deducci${marcadas.length === 1 ? 'ón' : 'ones'} · ${pesos(totalMarcadas)}`}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── OBSERVACIONES: la bitácora de la factura ────────────────────────────────
export function SeccionObservacionesFactura({ factura, usuarios, usuario, onCambio, onError }: {
  factura: FacturaCartera
  usuarios: UserProfile[]
  usuario: string
  onCambio: (msg: string) => Promise<void>
  onError: (m: string) => void
}) {
  const [observaciones, setObservaciones] = useState<Observacion[]>([])
  const [texto, setTexto] = useState('')
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    let vivo = true
    void loadObservaciones(factura.id).then((o) => { if (vivo) setObservaciones(o) })
    return () => { vivo = false }
  }, [factura.id, factura.nObservaciones])

  const nombre = (id: string) => usuarios.find((u) => u.id === id)?.name ?? id

  async function agregar() {
    const limpio = texto.trim()
    if (!limpio) return
    setOcupado(true)
    try {
      await agregarObservacion(factura.id, limpio, usuario)
      setTexto('')
      await onCambio('Observación agregada.')
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="cc-seccion">
      <p className="field-hint" style={{ margin: 0 }}>Las observaciones no se editan: si hubo un error, agrega una nueva.</p>
      {observaciones.length === 0 ? (
        <p className="cc-vacio">Sin observaciones todavía.</p>
      ) : (
        <ul className="cc-obs">
          {observaciones.map((o) => (
            <li key={o.id} className="cc-obs__item">
              <p className="cc-obs__texto">{o.texto}</p>
              <span className="cc-obs__meta">{nombre(o.creadoPor)} · {fmtFechaHora(o.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
      <label className="cc-campo">
        <span>Nueva observación</span>
        <textarea rows={3} maxLength={1000} value={texto} disabled={ocupado}
          placeholder="¿Qué hay que dejar anotado de esta factura?"
          onChange={(e) => setTexto(e.target.value)} />
      </label>
      <div className="cc-botones">
        <button type="button" className="inline-button" disabled={ocupado || !texto.trim()} onClick={() => void agregar()}>
          {ocupado ? 'Guardando…' : 'Agregar observación'}
        </button>
      </div>
    </div>
  )
}
