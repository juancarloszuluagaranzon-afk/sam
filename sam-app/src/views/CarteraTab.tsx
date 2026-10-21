import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { Ayuda } from '../components/Ayuda'
import { abrirArchivo } from '../services/facturacionApi'
import { aligerarDocumento } from '../lib/pdfLigero'
import { datosSiigo, siigoConectado, traerEstadoSiigo, verPdfSiigo, type DatosSiigo } from '../services/siigoApi'
import {
  ESTADOS_CARTERA, actualizarFactura, anularPago, claveHacienda, estadoAcuerdo, infoEstado, ligarFacturaAcuerdo,
  loadAcuerdos, loadCartera, loadPagos, nombreCuota, pesos, registrarPago,
  type Acuerdo, type EstadoCartera, type FacturaCartera, type Pago,
} from '../services/carteraApi'
import { AcuerdoDetalle, AcuerdoForm, ListaAcuerdos, type PrefillAcuerdo } from '../components/AcuerdosCartera'

/**
 * CARTERA (2-oct-2026) — la revisa Viviana. Cada factura con su vencimiento
 * (30 días desde la fecha de la factura), días de cartera y de mora, saldo y
 * pagos. Clasificación: al día ≤30 · vencida 31–60 · crítica 61–180 ·
 * otras medidas >180 · pagada. Ver `services/carteraApi` y la migración 20261002170000.
 *
 * ACUERDOS DE PAGO (21-oct-2026, migración 20261021120000): con los colonos que
 * negocian con Cristian (anticipo + cuotas). Una factura ligada a un acuerdo vence
 * según su plan (la próxima cuota) y el anticipo se descuenta de ella.
 */
export function CarteraTab() {
  const { session, todayKey, assignments, setError, setInfo } = useAppData()
  const [facturas, setFacturas] = useState<FacturaCartera[]>([])
  const [acuerdos, setAcuerdos] = useState<Acuerdo[]>([])
  const [cargando, setCargando] = useState(true)
  const [vista, setVista] = useState<'FACTURAS' | 'ACUERDOS'>('FACTURAS')
  const [filtro, setFiltro] = useState<EstadoCartera | 'PENDIENTES' | 'TODAS' | 'CON_ACUERDO' | 'ALERTAS_COBRO'>('PENDIENTES')
  const [buscar, setBuscar] = useState('')
  const [abierta, setAbierta] = useState<FacturaCartera | null>(null)
  const [acuerdoAbierto, setAcuerdoAbierto] = useState<Acuerdo | null>(null)
  // El formulario: nuevo (acuerdo null) o para cambiar uno; prefill = desde una factura.
  const [form, setForm] = useState<{ acuerdo: Acuerdo | null; prefill?: PrefillAcuerdo } | null>(null)

  const recargar = useCallback(async (abrirAcuerdo?: string) => {
    const [f, ac] = await Promise.all([loadCartera(), loadAcuerdos()])
    setFacturas(f)
    setAcuerdos(ac)
    setAbierta((a) => (a ? f.find((x) => x.id === a.id) ?? null : null))
    setAcuerdoAbierto((a) => ac.find((x) => x.id === (abrirAcuerdo ?? a?.id)) ?? null)
    setCargando(false)
  }, [])
  useEffect(() => {
    let vivo = true
    void Promise.all([loadCartera(), loadAcuerdos()]).then(([f, ac]) => {
      if (vivo) { setFacturas(f); setAcuerdos(ac); setCargando(false) }
    })
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

  // Cuotas de los acuerdos: las vencidas y las que vencen esta semana.
  const cuotasAviso = useMemo(() => {
    const vencidas: { texto: string; falta: number }[] = []
    const pronto: { texto: string; falta: number }[] = []
    for (const a of acuerdos) {
      if (a.anulado) continue
      for (const c of estadoAcuerdo(a, todayKey).cuotas) {
        if (c.estado === 'VENCIDA') vencidas.push({ falta: c.falta, texto: `${a.colono} (${nombreCuota(c, a.nCuotas).toLowerCase()}, ${c.dias} d)` })
        else if (c.estado === 'PRONTO') pronto.push({ falta: c.falta, texto: `${a.colono} (${c.vence})` })
      }
    }
    return { vencidas, pronto }
  }, [acuerdos, todayKey])
  const vigentes = acuerdos.filter((a) => { const e = estadoAcuerdo(a, todayKey).estado; return e !== 'ANULADO' && e !== 'CUMPLIDO' }).length
  const colonosConocidos = useMemo(() => [...new Set(acuerdos.map((a) => a.colono))].sort(), [acuerdos])
  // Haciendas para escoger en el acuerdo: primero las de proveedores.
  const haciendasConocidas = useMemo(() => {
    const prov = new Set<string>()
    const otras = new Set<string>()
    for (const x of assignments) {
      const h = claveHacienda(x.haciendaName ?? '')
      if (h) (x.cliente === 'proveedores' ? prov : otras).add(h)
    }
    return [...[...prov].sort(), ...[...otras].filter((h) => !prov.has(h)).sort()]
  }, [assignments])

  function abrirAcuerdoDeFactura(f: FacturaCartera) {
    const a = acuerdos.find((x) => x.id === f.acuerdoId)
    if (!a) return
    setAbierta(null); setVista('ACUERDOS'); setAcuerdoAbierto(a)
  }
  function nuevoAcuerdoDeFactura(f: FacturaCartera) {
    const haciendas = [...new Set(assignments.filter((x) => x.facturaId === f.id).map((x) => claveHacienda(x.haciendaName ?? '')).filter(Boolean))]
    setAbierta(null)
    setForm({ acuerdo: null, prefill: { colono: '', valor: f.saldo ?? f.valor, haciendas, facturaId: f.id, facturaNumero: f.numero } })
  }

  const lista = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    return facturas
      .filter((f) => {
        if (filtro === 'TODAS') return true
        if (filtro === 'PENDIENTES') return f.estado !== 'PAGADA'
        if (filtro === 'CON_ACUERDO') return !!f.acuerdoId
        if (filtro === 'ALERTAS_COBRO') return f.estado !== 'PAGADA' && (f.estado === 'CRITICA' || f.estado === 'OTRAS_MEDIDAS' || f.diasMora > 0)
        return f.estado === filtro
      })
      .filter((f) => !q || `${f.numero} ${f.cliente ?? ''} ${f.razonSocial ?? ''} ${f.colono ?? ''}`.toLowerCase().includes(q))
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
        <p><a href="/manuales/manual-facturacion.html#cartera" target="_blank" rel="noopener">📖 Ver el manual completo de Facturación y Cartera</a></p>
        <p>Cada factura vence a los <b>30 días</b> de su fecha; después corren los <b>días de mora</b>. Al día ≤30 · vencida 31–60 · crítica 61–180 · otras medidas &gt;180.</p>
        <p>Toca una factura para ver sus labores, registrar abonos o ligarla a un acuerdo de pago. Un pago no se borra: se anula diciendo por qué.</p>
        <p><b>🤝 Acuerdos de pago</b>: lo que Cristian acuerda con un colono (anticipo + cuotas). El anticipo se registra en el acuerdo y <b>se descuenta de la factura final</b> cuando la factura se liga. Una factura con acuerdo vence según su plan (la próxima cuota).</p>
      </Ayuda>

      {alertas.length > 0 && (
        <div className="cart-alerta" role="alert">
          ⚠ <b>{alertas.length} factura(s) en cartera crítica</b> ({pesos(alertas.reduce((s, f) => s + (f.saldo ?? 0), 0))}):{' '}
          {alertas.slice(0, 4).map((f) => `${f.numero} (${f.diasCartera} d)`).join(' · ')}{alertas.length > 4 ? '…' : ''}
        </div>
      )}

      {cuotasAviso.vencidas.length > 0 && (
        <button type="button" className="cart-alerta acu-alerta" onClick={() => setVista('ACUERDOS')}>
          ⚠ <b>{cuotasAviso.vencidas.length} cuota(s) vencida(s) de acuerdos</b> ({pesos(cuotasAviso.vencidas.reduce((s, c) => s + c.falta, 0))}):{' '}
          {cuotasAviso.vencidas.slice(0, 3).map((c) => c.texto).join(' · ')}{cuotasAviso.vencidas.length > 3 ? '…' : ''}
        </button>
      )}
      {cuotasAviso.pronto.length > 0 && (
        <button type="button" className="cart-alerta cart-alerta--acuerdo acu-alerta" onClick={() => setVista('ACUERDOS')}>
          📅 <b>{cuotasAviso.pronto.length} cuota(s) vencen esta semana</b> ({pesos(cuotasAviso.pronto.reduce((s, c) => s + c.falta, 0))}):{' '}
          {cuotasAviso.pronto.slice(0, 3).map((c) => c.texto).join(' · ')}{cuotasAviso.pronto.length > 3 ? '…' : ''}
        </button>
      )}

      <div className="realizadas-seg acu-vistas" role="tablist">
        <button type="button" role="tab" aria-selected={vista === 'FACTURAS'} className={`realizadas-seg__btn${vista === 'FACTURAS' ? ' is-active' : ''}`} onClick={() => setVista('FACTURAS')}>
          Facturas ({pendientes.length} por cobrar)
        </button>
        <button type="button" role="tab" aria-selected={vista === 'ACUERDOS'} className={`realizadas-seg__btn${vista === 'ACUERDOS' ? ' is-active' : ''}`} onClick={() => setVista('ACUERDOS')}>
          🤝 Acuerdos de pago ({vigentes})
        </button>
      </div>

      {vista === 'ACUERDOS' ? (
        <ListaAcuerdos acuerdos={acuerdos} hoy={todayKey} onAbrir={setAcuerdoAbierto} onNuevo={() => setForm({ acuerdo: null })} />
      ) : (<>
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
          <option value="ALERTAS_COBRO">🚨 Alertas de cobro</option>
          <option value="CON_ACUERDO">🤝 Con acuerdo de pago</option>
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
                  <td>{f.cliente ?? '—'}{f.colono && <small className="acu-sub">🤝 {f.colono}</small>}</td>
                  <td className="nowrap">{f.fecha}</td>
                  <td className="nowrap">{f.vence}{f.acuerdoId && f.estado !== 'PAGADA' && <small className="subtle-copy acu-sub">cuota del acuerdo</small>}</td>
                  <td className="num">{f.diasCartera}</td>
                  <td className="num">{f.diasMora > 0 ? f.diasMora : '—'}</td>
                  <td>
                    <span className={`cart-chip ${e.clase}`}>{e.titulo}</span>
                  </td>
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
      </>)}

      {abierta && session && (
        <DetalleFactura
          factura={abierta}
          acuerdos={acuerdos}
          haciendas={[...new Set(assignments.filter((x) => x.facturaId === abierta.id).map((x) => x.haciendaName ?? ''))]}
          usuario={session.id}
          hoy={todayKey}
          onVer={ver}
          onCambio={async (msg) => { setInfo(msg); await recargar() }}
          onError={setError}
          onCerrar={() => setAbierta(null)}
          onAbrirAcuerdo={abrirAcuerdoDeFactura}
          onNuevoAcuerdo={nuevoAcuerdoDeFactura}
        />
      )}
      {acuerdoAbierto && session && (
        <AcuerdoDetalle
          acuerdo={acuerdoAbierto}
          facturas={facturas}
          assignments={assignments}
          hoy={todayKey}
          usuario={session.id}
          onCambio={async (msg) => { setInfo(msg); await recargar() }}
          onError={setError}
          onCerrar={() => setAcuerdoAbierto(null)}
          onEditar={() => { setForm({ acuerdo: acuerdoAbierto }); setAcuerdoAbierto(null) }}
          onAbrirFactura={(f) => { setAcuerdoAbierto(null); setVista('FACTURAS'); setAbierta(f) }}
        />
      )}
      {form && session && (
        <AcuerdoForm
          acuerdo={form.acuerdo}
          prefill={form.prefill}
          haciendasConocidas={haciendasConocidas}
          colonosConocidos={colonosConocidos}
          hoy={todayKey}
          usuario={session.id}
          onCerrar={() => setForm(null)}
          onGuardado={(id, msg) => {
            setForm(null); setInfo(msg); setVista('ACUERDOS')
            void recargar(id)
          }}
        />
      )}
    </section>
  )
}

function DetalleFactura({ factura: f, acuerdos, haciendas, usuario, hoy, onVer, onCambio, onError, onCerrar, onAbrirAcuerdo, onNuevoAcuerdo }: {
  factura: FacturaCartera; acuerdos: Acuerdo[]; haciendas: string[]; usuario: string; hoy: string
  onVer: (path: string | null) => void; onCambio: (msg: string) => Promise<void>; onError: (m: string) => void; onCerrar: () => void
  onAbrirAcuerdo: (f: FacturaCartera) => void; onNuevoAcuerdo: (f: FacturaCartera) => void
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
  const [acuerdoLigar, setAcuerdoLigar] = useState('')
  const acuerdo = acuerdos.find((a) => a.id === f.acuerdoId) ?? null
  // Para ligar: los acuerdos vigentes; primero los de las haciendas de esta factura.
  const clavesFactura = new Set(haciendas.map(claveHacienda))
  const deSusHaciendas = (a: Acuerdo) => a.haciendas.some((h) => clavesFactura.has(claveHacienda(h)))
  const ligables = acuerdos
    .filter((a) => !a.anulado && estadoAcuerdo(a, hoy).estado !== 'CUMPLIDO')
    .sort((x, y) => Number(deSusHaciendas(y)) - Number(deSusHaciendas(x)))

  useEffect(() => { void loadPagos(f.id).then(setPagos) }, [f.id, f.pagado])
  const n = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'))
  const e = infoEstado(f.estado)

  async function hacer(fn: () => Promise<void>, msg: string) {
    setOcupado(true)
    try { await fn(); await onCambio(msg) } catch (err) { onError((err as Error).message) } finally { setOcupado(false) }
  }

  async function ligar(acuerdoId: string | null) {
    setOcupado(true)
    try {
      const d = await ligarFacturaAcuerdo(f.id, acuerdoId, usuario)
      const a = acuerdos.find((x) => x.id === acuerdoId)
      await onCambio(acuerdoId
        ? `Factura ${f.numero} ligada al acuerdo con ${a?.colono ?? ''}${d > 0 ? `: se le descontó el anticipo (${pesos(d)})` : ''}.`
        : `Factura ${f.numero} fuera del acuerdo.`)
      setAcuerdoLigar('')
    } catch (err) { onError((err as Error).message) } finally { setOcupado(false) }
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
          <div className="assignment-detail-row"><dt>Vence</dt><dd>{f.vence} {f.acuerdoId && f.estado !== 'PAGADA' ? '(próxima cuota del acuerdo)' : `(${f.plazoDias} días)`}</dd></div>
          <div className="assignment-detail-row"><dt>Días de cartera</dt><dd>{f.diasCartera}{f.estado === 'PAGADA' ? ' (al pagarse)' : ''}</dd></div>
          <div className="assignment-detail-row"><dt>Días de mora</dt><dd>{f.diasMora}</dd></div>
          <div className="assignment-detail-row"><dt>Labores</dt><dd>{f.nLineas} · {f.cantidad.toLocaleString('es-CO', { maximumFractionDigits: 2 })}</dd></div>
          <div className="assignment-detail-row"><dt>Valor</dt><dd>{pesos(f.valor)}</dd></div>
          <div className="assignment-detail-row"><dt>Pagado</dt><dd>{pesos(f.pagado)}{f.anticipo > 0 && <small className="subtle-copy"> (incluye anticipo descontado {pesos(f.anticipo)})</small>}</dd></div>
          <div className="assignment-detail-row"><dt>Saldo</dt><dd><b>{pesos(f.saldo)}</b></dd></div>
        </dl>
        {f.archivoPath && <button type="button" className="af-link" onClick={() => onVer(f.archivoPath)}>📄 Abrir la factura</button>}
        {/* 🤝 ACUERDO DE PAGO (colonos): el plan manda el vencimiento y el anticipo se descuenta aquí. */}
        {acuerdo && (
          <div className="taller-aviso acu-en-factura">
            <p style={{ margin: 0 }}>
              🤝 Va por el <b>acuerdo con {acuerdo.colono}</b> (negoció {acuerdo.negociadoPor}).
              {f.anticipo > 0 ? <> Anticipo descontado: <b>{pesos(f.anticipo)}</b>.</> : acuerdo.anticipo > 0 && acuerdo.anticipoPagado <= 0 ? ' El anticipo aún no está pagado.' : ''}
            </p>
            <p style={{ margin: '6px 0 0', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <button type="button" className="af-link" disabled={ocupado} onClick={() => onAbrirAcuerdo(f)}>Ver el acuerdo y sus cuotas</button>
              <button type="button" className="af-link" disabled={ocupado}
                onClick={() => { if (window.confirm(`¿Quitar la factura ${f.numero} del acuerdo? Si tenía el anticipo descontado, el anticipo vuelve al acuerdo.`)) void ligar(null) }}>
                Quitar del acuerdo
              </button>
            </p>
          </div>
        )}
        <p className="eyebrow" style={{ marginTop: 14 }}>Pagos</p>
        {pagos.length === 0 && <p className="subtle-copy">Sin pagos todavía.</p>}
        <ul className="cart-pagos">
          {pagos.map((p) => (
            <li key={p.id} className={p.anulado ? 'cart-pago--anulado' : ''}>
              <span><b>{pesos(p.valor)}</b> · {p.fecha} · {p.medio ?? ''}{p.referencia ? ` · ${p.referencia}` : ''}
                {p.anticipo && <> <small className="factura-chip">anticipo del acuerdo</small></>}
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
                  placeholder={f.saldo != null ? Math.round(f.saldo).toLocaleString('es-CO') : '0'} />
                {f.saldo != null && f.saldo > 0 && (
                  <button type="button" className="af-link" style={{ alignSelf: 'flex-start' }} disabled={ocupado}
                    onClick={() => setValor(Math.round(f.saldo ?? 0).toLocaleString('es-CO'))}>
                    Todo el saldo ({pesos(f.saldo)})
                  </button>
                )}</label>
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

        <details className="cart-plegable">
          <summary>Valor y plazo de la factura</summary>
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
        </details>

        {!acuerdo && f.estado !== 'PAGADA' && (
          <details className="cart-plegable">
            <summary>🤝 Acuerdo de pago</summary>
            <p className="field-hint" style={{ marginTop: 0 }}>Si el cliente acordó pagar con anticipo o en cuotas, liga la factura a su acuerdo: el anticipo se descuenta de ella y vence según el plan.</p>
            {ligables.length > 0 && (
              <div className="acu-ligar">
                <select className="base-input" value={acuerdoLigar} onChange={(ev) => setAcuerdoLigar(ev.target.value)} disabled={ocupado} aria-label="Acuerdo para ligar">
                  <option value="">Escoge el acuerdo…</option>
                  {ligables.map((a) => (
                    <option key={a.id} value={a.id}>{deSusHaciendas(a) ? '★ ' : ''}{a.colono} · {a.haciendas.join(', ') || 'sin hacienda'}{a.porDescontar > 0 ? ` · anticipo ${pesos(a.porDescontar)}` : ''}</option>
                  ))}
                </select>
                <button type="button" className="inline-button" disabled={ocupado || !acuerdoLigar} onClick={() => void ligar(acuerdoLigar)}>Ligar</button>
              </div>
            )}
            <button type="button" className="af-link" style={{ marginTop: 8 }} disabled={ocupado} onClick={() => onNuevoAcuerdo(f)}>＋ Hacer un acuerdo de pago nuevo para esta factura</button>
          </details>
        )}

        <SeccionSiigo factura={f} onError={onError} />
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
