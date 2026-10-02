import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { Ayuda } from '../components/Ayuda'
import { abrirArchivo } from '../services/facturacionApi'
import { aligerarDocumento } from '../lib/pdfLigero'
import { datosSiigo, siigoConectado, traerEstadoSiigo, verPdfSiigo, type DatosSiigo } from '../services/siigoApi'
import {
  ESTADOS_CARTERA, actualizarFactura, anularPago, infoEstado, loadCartera, loadPagos, pesos, registrarPago,
  type EstadoCartera, type FacturaCartera, type Pago,
} from '../services/carteraApi'

/**
 * CARTERA (2-oct-2026) — la revisa Viviana. Cada factura con su vencimiento
 * (30 días desde la fecha de la factura), días de cartera y de mora, saldo y
 * pagos. Clasificación: al día ≤30 · vencida 31–60 · crítica 61–180 ·
 * otras medidas >180 · pagada. Ver `services/carteraApi` y la migración 20261002170000.
 */
export function CarteraTab() {
  const { session, todayKey, setError, setInfo } = useAppData()
  const [facturas, setFacturas] = useState<FacturaCartera[]>([])
  const [cargando, setCargando] = useState(true)
  const [filtro, setFiltro] = useState<EstadoCartera | 'PENDIENTES' | 'TODAS'>('PENDIENTES')
  const [buscar, setBuscar] = useState('')
  const [abierta, setAbierta] = useState<FacturaCartera | null>(null)

  const recargar = useCallback(async () => {
    const f = await loadCartera()
    setFacturas(f)
    setAbierta((a) => (a ? f.find((x) => x.id === a.id) ?? null : null))
    setCargando(false)
  }, [])
  useEffect(() => {
    let vivo = true
    void loadCartera().then((f) => { if (vivo) { setFacturas(f); setCargando(false) } })
    return () => { vivo = false }
  }, [])

  const resumen = useMemo(() => {
    const out = new Map<EstadoCartera, { n: number; saldo: number }>()
    for (const f of facturas) {
      const r = out.get(f.estado) ?? { n: 0, saldo: 0 }
      r.n += 1; r.saldo += f.saldo ?? 0
      out.set(f.estado, r)
    }
    return out
  }, [facturas])
  const pendientes = facturas.filter((f) => f.estado !== 'PAGADA')
  const saldoTotal = pendientes.reduce((s, f) => s + (f.saldo ?? 0), 0)
  const alertas = facturas.filter((f) => f.estado === 'CRITICA' || f.estado === 'OTRAS_MEDIDAS')

  const lista = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    return facturas
      .filter((f) => (filtro === 'TODAS' ? true : filtro === 'PENDIENTES' ? f.estado !== 'PAGADA' : f.estado === filtro))
      .filter((f) => !q || `${f.numero} ${f.cliente ?? ''} ${f.razonSocial ?? ''}`.toLowerCase().includes(q))
  }, [facturas, filtro, buscar])

  async function ver(path: string | null) {
    if (!path) return
    try { await abrirArchivo(path) } catch (e) { setError((e as Error).message) }
  }

  return (
    <section className="panel-card">
      <div className="panel-title split">
        <h2>Cartera</h2>
        <span className="subtle-copy">
          Por cobrar: <strong>{pesos(saldoTotal)}</strong> en {pendientes.length} factura(s)
        </span>
      </div>
      <Ayuda>
        <p>Cada factura vence a los <b>30 días</b> de su fecha; después corren los <b>días de mora</b>. Al día ≤30 · vencida 31–60 · crítica 61–180 · otras medidas &gt;180.</p>
        <p>Toca una factura para ver sus labores, registrar pagos (también abonos) o poner su valor. Un pago no se borra: se anula diciendo por qué.</p>
      </Ayuda>

      {alertas.length > 0 && (
        <div className="cart-alerta" role="alert">
          ⚠ <b>{alertas.length} factura(s) en cartera crítica</b> ({pesos(alertas.reduce((s, f) => s + (f.saldo ?? 0), 0))}):{' '}
          {alertas.slice(0, 4).map((f) => `${f.numero} (${f.diasCartera} d)`).join(' · ')}{alertas.length > 4 ? '…' : ''}
        </div>
      )}

      <div className="fact-etapas">
        {ESTADOS_CARTERA.map((e) => {
          const r = resumen.get(e.id) ?? { n: 0, saldo: 0 }
          return (
            <button key={e.id} type="button" className={`fact-etapa ${e.clase}${filtro === e.id ? ' is-active' : ''}`}
              onClick={() => setFiltro(filtro === e.id ? 'PENDIENTES' : e.id)} title={e.detalle}>
              <span>{e.titulo}</span>
              <b>{r.n}</b>
              <small>{e.id === 'PAGADA' ? e.detalle : pesos(r.saldo)}</small>
            </button>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0' }}>
        <select id="cart-filtro" className="base-input" style={{ width: 'auto' }} value={filtro}
          onChange={(e) => setFiltro(e.target.value as typeof filtro)}>
          <option value="PENDIENTES">Por cobrar</option>
          <option value="TODAS">Todas</option>
          {ESTADOS_CARTERA.map((e) => <option key={e.id} value={e.id}>{e.titulo}</option>)}
        </select>
        <input className="user-search-input" type="search" placeholder="Buscar factura o cliente…" value={buscar}
          onChange={(e) => setBuscar(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
      </div>

      <div className="table-wrap validacion-table-wrap">
        <table className="validacion-table">
          <thead>
            <tr>
              <th>Factura</th><th>Cliente</th><th>Fecha</th><th>Vence</th><th className="num">Días</th><th className="num">Mora</th>
              <th>Estado</th><th className="num">Valor</th><th className="num">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((f) => {
              const e = infoEstado(f.estado)
              return (
                <tr key={f.id} className={`cart-fila${abierta?.id === f.id ? ' factura-row--sel' : ''}`} onClick={() => setAbierta(f)}>
                  <td><b>{f.numero}</b><small className="subtle-copy"> {f.razonSocial ?? ''}</small></td>
                  <td>{f.cliente ?? '—'}</td>
                  <td className="nowrap">{f.fecha}</td>
                  <td className="nowrap">{f.vence}</td>
                  <td className="num">{f.diasCartera}</td>
                  <td className="num">{f.diasMora > 0 ? f.diasMora : '—'}</td>
                  <td><span className={`cart-chip ${e.clase}`}>{e.titulo}</span></td>
                  <td className="num">{pesos(f.valor)}</td>
                  <td className="num"><strong>{f.estado === 'PAGADA' ? '—' : pesos(f.saldo)}</strong></td>
                </tr>
              )
            })}
            {lista.length === 0 && (
              <tr><td colSpan={9} className="validacion-empty">
                {cargando ? 'Cargando…' : facturas.length === 0 ? 'Todavía no hay facturas: se vinculan en Facturación.' : 'Nada en este filtro.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {abierta && session && (
        <DetalleFactura
          factura={abierta}
          usuario={session.id}
          hoy={todayKey}
          onVer={ver}
          onCambio={async (msg) => { setInfo(msg); await recargar() }}
          onError={setError}
          onCerrar={() => setAbierta(null)}
        />
      )}
    </section>
  )
}

function DetalleFactura({ factura: f, usuario, hoy, onVer, onCambio, onError, onCerrar }: {
  factura: FacturaCartera; usuario: string; hoy: string
  onVer: (path: string | null) => void; onCambio: (msg: string) => Promise<void>; onError: (m: string) => void; onCerrar: () => void
}) {
  const [pagos, setPagos] = useState<Pago[]>([])
  const [fecha, setFecha] = useState(hoy)
  const [valor, setValor] = useState('')
  const [medio, setMedio] = useState('TRANSFERENCIA')
  const [referencia, setReferencia] = useState('')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [valorFactura, setValorFactura] = useState(f.valor != null ? String(Math.round(f.valor)) : '')
  const [plazo, setPlazo] = useState(String(f.plazoDias))
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => { void loadPagos(f.id).then(setPagos) }, [f.id, f.pagado])
  const n = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'))
  const e = infoEstado(f.estado)

  async function hacer(fn: () => Promise<void>, msg: string) {
    setOcupado(true)
    try { await fn(); await onCambio(msg) } catch (err) { onError((err as Error).message) } finally { setOcupado(false) }
  }

  return (
    <div className="modal-overlay open" onClick={() => { if (!ocupado) onCerrar() }}>
      <div className="modal-card" onClick={(ev) => ev.stopPropagation()} style={{ maxWidth: 'min(560px, calc(100vw - 32px))' }}>
        <div className="labor-detail-header">
          <div>
            <p className="eyebrow">Factura · {f.razonSocial ?? ''}</p>
            <h3>{f.numero} <span className={`cart-chip ${e.clase}`}>{e.titulo}</span></h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onCerrar} disabled={ocupado} aria-label="Cerrar">&#x2715;</button>
        </div>

        <dl className="assignment-detail-grid">
          <div className="assignment-detail-row"><dt>Cliente</dt><dd>{f.cliente ?? '—'}</dd></div>
          <div className="assignment-detail-row"><dt>Fecha</dt><dd>{f.fecha}</dd></div>
          <div className="assignment-detail-row"><dt>Vence</dt><dd>{f.vence} ({f.plazoDias} días)</dd></div>
          <div className="assignment-detail-row"><dt>Días de cartera</dt><dd>{f.diasCartera}{f.estado === 'PAGADA' ? ' (al pagarse)' : ''}</dd></div>
          <div className="assignment-detail-row"><dt>Días de mora</dt><dd>{f.diasMora}</dd></div>
          <div className="assignment-detail-row"><dt>Labores</dt><dd>{f.nLineas} · {f.cantidad.toLocaleString('es-CO', { maximumFractionDigits: 2 })}</dd></div>
          <div className="assignment-detail-row"><dt>Valor</dt><dd>{pesos(f.valor)}</dd></div>
          <div className="assignment-detail-row"><dt>Pagado</dt><dd>{pesos(f.pagado)}</dd></div>
          <div className="assignment-detail-row"><dt>Saldo</dt><dd><b>{pesos(f.saldo)}</b></dd></div>
        </dl>
        {f.archivoPath && <button type="button" className="af-link" onClick={() => onVer(f.archivoPath)}>📄 Abrir la factura</button>}
        <SeccionSiigo factura={f} onError={onError} />

        <p className="eyebrow" style={{ marginTop: 14 }}>Valor y plazo</p>
        <div className="assignment-detail-field-grid">
          <label className="assignment-detail-field"><span>Valor de la factura</span>
            <input id="cart-valor-factura" inputMode="numeric" value={valorFactura} onChange={(ev) => setValorFactura(ev.target.value)} disabled={ocupado} /></label>
          <label className="assignment-detail-field"><span>Plazo (días)</span>
            <input id="cart-plazo" inputMode="numeric" value={plazo} onChange={(ev) => setPlazo(ev.target.value)} disabled={ocupado} /></label>
        </div>
        <button type="button" className="inline-button" disabled={ocupado}
          onClick={() => void hacer(() => actualizarFactura(f.id, { valor: valorFactura.trim() ? n(valorFactura) : null, plazoDias: Math.max(0, Math.round(n(plazo) || 30)) }), `Factura ${f.numero} actualizada.`)}>
          Guardar valor y plazo
        </button>

        <p className="eyebrow" style={{ marginTop: 14 }}>Pagos</p>
        {pagos.length === 0 && <p className="subtle-copy">Sin pagos todavía.</p>}
        <ul className="cart-pagos">
          {pagos.map((p) => (
            <li key={p.id} className={p.anulado ? 'cart-pago--anulado' : ''}>
              <span><b>{pesos(p.valor)}</b> · {p.fecha} · {p.medio ?? ''}{p.referencia ? ` · ${p.referencia}` : ''}
                {p.anulado && <small> — ANULADO: {p.anuladoMotivo}</small>}</span>
              <span className="cart-pago-acc">
                {p.archivoPath && <button type="button" className="af-link" onClick={() => onVer(p.archivoPath)}>Comprobante</button>}
                {!p.anulado && (
                  <button type="button" className="af-link" disabled={ocupado} onClick={() => {
                    const m = window.prompt('¿Por qué se anula este pago? (queda registrado)')
                    if (m && m.trim()) void hacer(() => anularPago(p.id, m, usuario), 'Pago anulado.')
                  }}>Anular</button>
                )}
              </span>
            </li>
          ))}
        </ul>

        {f.estado !== 'PAGADA' && (
          <>
            <p className="eyebrow" style={{ marginTop: 14 }}>Registrar pago</p>
            <div className="assignment-detail-field-grid">
              <label className="assignment-detail-field"><span>Fecha</span>
                <input id="pago-fecha" type="date" value={fecha} max={hoy} onChange={(ev) => setFecha(ev.target.value)} disabled={ocupado} /></label>
              <label className="assignment-detail-field"><span>Valor</span>
                <input id="pago-valor" inputMode="numeric" value={valor} onChange={(ev) => setValor(ev.target.value)} disabled={ocupado}
                  placeholder={f.saldo != null ? String(Math.round(f.saldo)) : '0'} /></label>
              <label className="assignment-detail-field"><span>Medio</span>
                <select id="pago-medio" value={medio} onChange={(ev) => setMedio(ev.target.value)} disabled={ocupado}>
                  <option>TRANSFERENCIA</option><option>CONSIGNACIÓN</option><option>CHEQUE</option><option>EFECTIVO</option><option>CRUCE DE CUENTAS</option>
                </select></label>
              <label className="assignment-detail-field"><span>Referencia</span>
                <input id="pago-ref" value={referencia} onChange={(ev) => setReferencia(ev.target.value)} disabled={ocupado} /></label>
              <label className="assignment-detail-field"><span>Comprobante (opcional)</span>
                <input id="pago-archivo" type="file" accept="application/pdf,image/jpeg,image/png,image/webp"
                  onChange={(ev) => setArchivo(ev.target.files?.[0] ?? null)} disabled={ocupado} /></label>
            </div>
            <button type="button" className="primary-button" disabled={ocupado || !(n(valor) > 0) || !fecha}
              onClick={() => void hacer(async () => {
                // El comprobante se reduce en el equipo antes de subir (lib/pdfLigero).
                const liviano = archivo ? (await aligerarDocumento(archivo)).archivo : null
                await registrarPago({ facturaId: f.id, fecha, valor: n(valor), medio, referencia, creadoPor: usuario }, liviano)
                setValor(''); setReferencia(''); setArchivo(null)
              }, `Pago de ${pesos(n(valor))} registrado a ${f.numero}.`)}>
              {ocupado ? 'Guardando…' : 'Registrar pago'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * La factura en SIIGO: ver su PDF oficial y traer su saldo (función del servidor
 * `siigo-factura`). Si la razón social aún no tiene credenciales, lo dice.
 */
function SeccionSiigo({ factura: f, onError }: { factura: FacturaCartera; onError: (m: string) => void }) {
  const [conectado, setConectado] = useState<boolean | null>(null)
  const [datos, setDatos] = useState<DatosSiigo | null>(null)
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => {
    let vivo = true
    void siigoConectado(f.razonSocial).then((c) => { if (vivo) setConectado(c) })
    void datosSiigo(f.id).then((d) => { if (vivo) setDatos(d) })
    return () => { vivo = false }
  }, [f.id, f.razonSocial])

  async function traer() {
    setOcupado(true)
    try { await traerEstadoSiigo(f.id); setDatos(await datosSiigo(f.id)) } catch (e) { onError((e as Error).message) } finally { setOcupado(false) }
  }
  async function verPdf() {
    try { await verPdfSiigo(f.id) } catch (e) { onError((e as Error).message) }
  }

  return (
    <div className="cart-siigo">
      <p className="eyebrow" style={{ marginTop: 14 }}>Siigo</p>
      {conectado === false ? (
        <p className="subtle-copy">Siigo todavía no está conectado para {f.razonSocial ?? 'esta razón social'}: faltan sus credenciales.</p>
      ) : (
        <>
          {datos?.siigoId && (
            <dl className="assignment-detail-grid">
              {datos.nombre && <div className="assignment-detail-row"><dt>En Siigo</dt><dd>{datos.nombre}</dd></div>}
              <div className="assignment-detail-row"><dt>Total en Siigo</dt><dd>{pesos(datos.total)}</dd></div>
              <div className="assignment-detail-row"><dt>Saldo en Siigo</dt><dd><b>{pesos(datos.saldo)}</b></dd></div>
              {datos.cufe && <div className="assignment-detail-row"><dt>CUFE</dt><dd style={{ wordBreak: 'break-all' }}>{datos.cufe}</dd></div>}
              {datos.consultadoEn && <div className="assignment-detail-row"><dt>Consultado</dt><dd>{new Date(datos.consultadoEn).toLocaleString('es-CO')}</dd></div>}
            </dl>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="inline-button" onClick={() => void verPdf()} disabled={!conectado}>📄 Ver factura en Siigo</button>
            <button type="button" className="inline-button" onClick={() => void traer()} disabled={!conectado || ocupado}>
              {ocupado ? 'Consultando…' : '🔄 Traer saldo de Siigo'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default CarteraTab
