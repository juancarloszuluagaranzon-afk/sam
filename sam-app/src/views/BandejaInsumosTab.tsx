import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useAppData } from '../context/AppDataContext'
import { loadSolicitudes, updateSolicitudEstado, entregarSolicitud, entregarDirecto, uploadEvidencia, bodegaDeResponsable, bodegaPrincipal, loadStockBodega } from '../services/samApi'
import type { Bodega, StockBodega } from '../domain/sam'
import { SearchableSelect } from '../components/SearchableSelect'
import { CampoLista, recordarValor } from '../components/CampoPlaca'
import { fmtFechaHora as fmtFecha, fmtLapso } from '../lib/fechas'
import { enviarOEncolar, subirOGuardarFoto, esFotoLocal } from '../lib/outboxInsumos'
import { fmtCantidad, stepDe, normalizarCantidad, redondear2 } from '../lib/cantidad'
import type { SolicitudInsumo, SolicitudEstado } from '../domain/sam'
import { Ayuda } from '../components/Ayuda'
import { TanqueoModal } from '../components/TanqueoModal'
import { SwitchEngraso } from '../components/SwitchEngraso'
import { EditarDespachoModal } from '../components/EditarDespachoModal'

/** Quién puede corregir un despacho entregado: el que despacha y el que administra. */
const PUEDEN_CORREGIR = ['supervisor_insumos', 'analista_insumos', 'owner', 'administracion']

/**
 * Bandeja de entrada de solicitudes de insumos (módulo Insumos — fase 2).
 *
 * El supervisor de insumos ve las solicitudes de los operarios y puede
 * PROGRAMARLAS (aceptar, listas para despachar en fase 3) o RECHAZARLAS con
 * motivo. El despacho real + descuento de inventario llega en la fase 3.
 */


const ESTADO_LABEL: Record<SolicitudEstado, string> = {
  PENDIENTE: 'Pendiente', PROGRAMADA: 'Programada', ENTREGADA: 'Entregada', RECHAZADA: 'Rechazada', CANCELADA: 'Cancelada',
}

export function BandejaInsumosTab() {
  const { users, session, insumos, setInsumos, sortedEquipment, busy, setBusy, setError, setInfo } = useAppData()

  // Operarios (destinatarios posibles de una entrega directa). Solo operadores:
  // son quienes tienen la tarjeta de aval para confirmar la recepción.
  const operarios = useMemo(
    () => users.filter((u) => u.active !== false && u.role === 'operador')
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })),
    [users],
  )
  const activeInsumos = useMemo(
    () => insumos.filter((i) => i.activo).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })),
    [insumos],
  )

  // Bodega desde la que despacha este usuario: su satélite si es supervisor de
  // insumos; la principal si es admin/dueño. El stock que se valida y descuenta
  // es el de ESA bodega, no el consolidado.
  const [miBodega, setMiBodega] = useState<Bodega | null>(null)
  const [stockBodega, setStockBodega] = useState<StockBodega[]>([])

  useEffect(() => {
    if (!session) return
    let vivo = true
    void (async () => {
      const b = session.role === 'supervisor_insumos'
        ? (await bodegaDeResponsable(session.id)) ?? (await bodegaPrincipal())
        : await bodegaPrincipal()
      if (!vivo) return
      setMiBodega(b)
      if (b) setStockBodega(await loadStockBodega(b.id))
    })()
    return () => { vivo = false }
  }, [session])

  /** Stock del insumo EN mi bodega (lo que realmente puedo entregar). */
  const stockMio = (insumoId: string) =>
    stockBodega.find((s) => s.insumoId === insumoId)?.stock ?? 0

  /**
   * Descuenta del stock local lo que se acaba de entregar SIN señal.
   *
   * Sin esto el supervisor seguiría viendo el carro lleno después de entregar y
   * podría despachar de más creyendo que le queda. Es una estimación local: al
   * sincronizar, el stock real llega del servidor y manda.
   */
  function descontarLocal(movs: { insumoId: string; cantidad: number }[]) {
    setStockBodega((prev) => {
      const m = new Map(prev.map((x) => [x.insumoId, x.stock]))
      for (const mv of movs) m.set(mv.insumoId, redondear2((m.get(mv.insumoId) ?? 0) - mv.cantidad))
      return prev.map((x) => ({ ...x, stock: m.get(x.insumoId) ?? x.stock }))
    })
  }

  async function refrescarStockBodega() {
    if (miBodega) setStockBodega(await loadStockBodega(miBodega.id))
  }

  const equipoNombre = useMemo(() => {
    const m = new Map<string, string>()
    sortedEquipment.forEach((e) => m.set(e.code, e.name))
    return m
  }, [sortedEquipment])
  const equipoDeOperario = (operarioId: string) => users.find((u) => u.id === operarioId)?.equipmentCode ?? ''

  const [filtro, setFiltro] = useState<'PENDIENTE' | 'PROGRAMADA' | 'ENTREGADA' | 'TODAS'>('PENDIENTE')
  const [solicitudes, setSolicitudes] = useState<SolicitudInsumo[]>([])
  const [loading, setLoading] = useState(false)
  const [tanqueoOpen, setTanqueoOpen] = useState(false)
  // Engrase: se pregunta en la entrega porque es cuando se hace. Sin elegir
  // por defecto — un descuido no debe quedar como "no engrasó".
  const [entregaEngraso, setEntregaEngraso] = useState<boolean | undefined>(undefined)
  const [dirEngraso, setDirEngraso] = useState<boolean | undefined>(undefined)
  const [rechazoTarget, setRechazoTarget] = useState<SolicitudInsumo | null>(null)
  const [corrigiendo, setCorrigiendo] = useState<SolicitudInsumo | null>(null)
  const [motivo, setMotivo] = useState('')

  // Entrega (despacho) — fase 3
  const [entregaTarget, setEntregaTarget] = useState<SolicitudInsumo | null>(null)
  const [entregaItems, setEntregaItems] = useState<{ itemId?: string; insumoId?: string; insumoNombre: string; unidad: string; cantidad: string }[]>([])
  const [entregaRuta, setEntregaRuta] = useState('')
  const [entregaEquipo, setEntregaEquipo] = useState('')
  const [entregaHorometro, setEntregaHorometro] = useState('')
  const [evidencias, setEvidencias] = useState<string[]>([])
  const [subiendoFoto, setSubiendoFoto] = useState(false)
  const fotoInputRef = useRef<HTMLInputElement>(null)

  // Entrega directa (sin solicitud previa) — la crea el supervisor.
  const [directaOpen, setDirectaOpen] = useState(false)
  const [dirOperario, setDirOperario] = useState('')
  const [dirItems, setDirItems] = useState<{ insumoId: string; cantidad: string }[]>([{ insumoId: '', cantidad: '' }])
  const [dirEquipo, setDirEquipo] = useState('')
  const [dirHorometro, setDirHorometro] = useState('')
  const [dirNota, setDirNota] = useState('')
  const [dirFotos, setDirFotos] = useState<string[]>([])
  const [dirSubiendo, setDirSubiendo] = useState(false)
  const dirFotoRef = useRef<HTMLInputElement>(null)
  const dirTempIdRef = useRef('')

  const userName = useMemo(() => {
    const m = new Map<string, string>()
    users.forEach((u) => m.set(u.id, u.name))
    return m
  }, [users])

  async function refresh() {
    setLoading(true)
    try {
      const estados = filtro === 'TODAS' ? undefined : [filtro as SolicitudEstado]
      setSolicitudes(await loadSolicitudes({ estados, limit: 100 }))
    } finally { setLoading(false) }
  }
  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro])

  async function programar(s: SolicitudInsumo) {
    setBusy(true); setError('')
    try {
      await updateSolicitudEstado(s.id, 'PROGRAMADA')
      setInfo('Solicitud programada.')
      void refresh()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo programar. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  async function confirmarRechazo() {
    if (!rechazoTarget) return
    setBusy(true); setError('')
    try {
      await updateSolicitudEstado(rechazoTarget.id, 'RECHAZADA', motivo.trim() || undefined)
      if (motivo.trim()) recordarValor('MOTIVO_RECHAZO', motivo)
      setInfo('Solicitud rechazada.')
      setRechazoTarget(null); setMotivo('')
      void refresh()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo rechazar. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  function openEntrega(s: SolicitudInsumo) {
    setEntregaTarget(s)
    setEntregaItems(s.items.map((it) => ({
      itemId: it.id, insumoId: it.insumoId, insumoNombre: it.insumoNombre, unidad: it.unidad,
      cantidad: String(it.cantidad),
    })))
    setEntregaRuta('')
    setEntregaEquipo(equipoDeOperario(s.operarioId))
    setEntregaHorometro('')
    setEntregaEngraso(undefined)
    setEvidencias([])
    setError('')
  }

  async function handleFotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const input = e.target
    if (!file || !entregaTarget) return
    if (!file.type.startsWith('image/')) { setError('Selecciona una imagen.'); input.value = ''; return }
    setSubiendoFoto(true); setError('')
    try {
      const { url, local } = await subirOGuardarFoto(entregaTarget.id, file, evidencias.length, uploadEvidencia)
      setEvidencias((prev) => [...prev, url])
      if (local) setInfo('Foto guardada en el equipo. Se sube sola cuando haya señal.')
    } catch {
      setError('No se pudo subir la foto.')
    } finally { setSubiendoFoto(false); input.value = '' }
  }

  async function confirmarEntrega() {
    if (!entregaTarget) return
    const items = entregaItems
      .map((r) => ({
        itemId: r.itemId,
        insumoId: r.insumoId,
        insumoNombre: r.insumoNombre,
        unidad: r.unidad,
        cantidadDespachada: Number(r.cantidad),
      }))
      .filter((r) => r.cantidadDespachada > 0)
    if (items.length === 0) { setError('Indica al menos una cantidad a despachar.'); return }
    if (!entregaEquipo) { setError('Selecciona la máquina a la que se carga el material.'); return }
    const horometro = Number(entregaHorometro)
    if (!entregaHorometro.trim() || isNaN(horometro) || horometro < 0) {
      setError('El horómetro de la máquina es obligatorio.'); return
    }
    setBusy(true); setError('')
    try {
      const excedido = items.find((it) => it.insumoId && it.cantidadDespachada > stockMio(it.insumoId))
      if (excedido) {
        const ins = insumos.find((i) => i.id === excedido.insumoId)
        setError(`No tienes suficiente ${ins?.nombre ?? 'insumo'} en tu bodega (${stockMio(excedido.insumoId!)} disponible).`)
        setBusy(false)
        return
      }
      const payload = {
        solicitudId: entregaTarget.id,
        despachadoPor: session?.id,
        ruta: entregaRuta.trim() || undefined,
        equipoCodigo: entregaEquipo,
        horometro,
        evidenciaUrls: evidencias,
        bodegaId: miBodega?.id,
        engraso: entregaEngraso,
        items,
      }
      const { enviado } = await enviarOEncolar('DESPACHO', payload, async () => {
        const actualizados = await entregarSolicitud(payload)
        // Refresca el stock en el contexto con los insumos devueltos.
        if (actualizados.length) {
          setInsumos((prev) => prev.map((i) => actualizados.find((a) => a.id === i.id) ?? i))
        }
      })
      if (enviado) {
        void refrescarStockBodega()
        setInfo(`Entrega registrada y descontada de ${miBodega?.nombre ?? 'la bodega'}.`)
      } else {
        descontarLocal(items.filter((it) => it.insumoId).map((it) => ({ insumoId: it.insumoId!, cantidad: it.cantidadDespachada })))
        setInfo('Entrega guardada sin señal. Se envía sola cuando haya cobertura.')
      }
      setEntregaTarget(null)
      void refresh()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo registrar la entrega. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  function openDirecta() {
    dirTempIdRef.current = `directa-${session?.id ?? 'x'}-${Date.now()}`
    setDirOperario('')
    setDirItems([{ insumoId: '', cantidad: '' }])
    setDirEquipo('')
    setDirHorometro('')
    setDirNota('')
    setDirEngraso(undefined)
    setDirFotos([])
    setError('')
    setDirectaOpen(true)
  }

  async function handleDirFoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const input = e.target
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('Selecciona una imagen.'); input.value = ''; return }
    setDirSubiendo(true); setError('')
    try {
      const { url, local } = await subirOGuardarFoto(dirTempIdRef.current, file, dirFotos.length, uploadEvidencia)
      setDirFotos((prev) => [...prev, url])
      if (local) setInfo('Foto guardada en el equipo. Se sube sola cuando haya señal.')
    } catch {
      setError('No se pudo subir la foto.')
    } finally { setDirSubiendo(false); input.value = '' }
  }

  // Cuando eligen operario, precargar su máquina por defecto.
  function onDirOperario(id: string) {
    setDirOperario(id)
    setDirEquipo(equipoDeOperario(id))
  }

  async function confirmarDirecta() {
    const operario = operarios.find((u) => u.id === dirOperario)
    if (!operario) { setError('Elige a quién le entregas.'); return }
    const items = dirItems
      .filter((r) => r.insumoId && Number(r.cantidad) > 0)
      .map((r) => {
        const ins = insumos.find((i) => i.id === r.insumoId)!
        return { insumoId: r.insumoId, insumoNombre: ins.nombre, unidad: ins.unidad, cantidad: normalizarCantidad(Number(r.cantidad), ins.unidad) }
      })
    if (items.length === 0) { setError('Agrega al menos un insumo con cantidad.'); return }
    if (!dirEquipo) { setError('Selecciona la máquina a la que se carga el material.'); return }
    const horometro = Number(dirHorometro)
    if (!dirHorometro.trim() || isNaN(horometro) || horometro < 0) { setError('El horómetro de la máquina es obligatorio.'); return }
    setBusy(true); setError('')
    try {
      const excedido = items.find((it) => it.cantidad > stockMio(it.insumoId))
      if (excedido) {
        setError(`No tienes suficiente ${excedido.insumoNombre} en tu bodega (${stockMio(excedido.insumoId)} disponible).`)
        setBusy(false)
        return
      }
      const payload = {
        operarioId: operario.id,
        operarioNombre: operario.name,
        despachadoPor: session?.id,
        equipoCodigo: dirEquipo,
        horometro,
        nota: dirNota.trim() || undefined,
        engraso: dirEngraso,
        evidenciaUrls: dirFotos,
        bodegaId: miBodega?.id,
        items,
      }
      if (dirNota.trim()) recordarValor('USO', dirNota)
      const { enviado } = await enviarOEncolar('ENTREGA_DIRECTA', payload, async () => {
        const { insumos: actualizados } = await entregarDirecto(payload)
        if (actualizados.length) {
          setInsumos((prev) => prev.map((i) => actualizados.find((a) => a.id === i.id) ?? i))
        }
      })
      if (enviado) {
        void refrescarStockBodega()
        setInfo(`Entrega directa registrada a ${operario.name}. Queda pendiente de su aval.`)
      } else {
        descontarLocal(items.map((it) => ({ insumoId: it.insumoId, cantidad: it.cantidad })))
        setInfo(`Entrega a ${operario.name} guardada sin señal. Se envía sola cuando haya cobertura.`)
      }
      setDirectaOpen(false)
      void refresh()
    } catch (err) {
      const e = err as { message?: string }
      setError(`No se pudo registrar la entrega directa. (${e?.message ?? 'error'})`)
    } finally { setBusy(false) }
  }

  const pendientesCount = solicitudes.filter((s) => s.estado === 'PENDIENTE').length

  /**
   * El analista despacha desde la PRINCIPAL, no desde un carro.
   *
   * Los supervisores ya tienen el tanqueo en "Mi bodega"; él no tiene bodega
   * satélite, así que su botón vive aquí. Solo destinos de CONSUMO (máquina y
   * vehículo): sumar a un carro es del supervisor de ese carro.
   */
  const esAnalista = session?.role === 'analista_insumos'

  return (
    <section className="panel-card">
      <div className="panel-title split">
        <h2>Bandeja de solicitudes {filtro === 'PENDIENTE' && pendientesCount > 0 ? `(${pendientesCount})` : ''}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="primary-button" onClick={openDirecta} disabled={busy}>⚡ Entrega directa</button>
          {esAnalista && (
            <button type="button" className="primary-button" onClick={() => setTanqueoOpen(true)} disabled={busy}>
              ⛽ Registrar tanqueo
            </button>
          )}
          <button type="button" className="inline-button" onClick={() => void refresh()} disabled={loading}>↻ Actualizar</button>
        </div>
      </div>
      <Ayuda>
        <p>Solicitudes de insumos de los operarios. <strong>Programa</strong> las que vas a despachar o <strong>rechaza</strong> con motivo.</p>
      </Ayuda>

      <div className="sol-filtros" role="tablist" aria-label="Filtrar solicitudes">
        {([
          { key: 'PENDIENTE', icon: '🕐', label: 'Pendientes' },
          { key: 'PROGRAMADA', icon: '📅', label: 'Programadas' },
          { key: 'ENTREGADA', icon: '✅', label: 'Entregadas' },
          { key: 'TODAS', icon: '📋', label: 'Todas' },
        ] as const).map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filtro === f.key}
            className={`sol-filtro${filtro === f.key ? ' is-active' : ''}`}
            onClick={() => setFiltro(f.key)}
          >
            <span aria-hidden>{f.icon}</span> {f.label}
            {f.key === 'PENDIENTE' && pendientesCount > 0 && <span className="sol-filtro__badge">{pendientesCount}</span>}
          </button>
        ))}
      </div>

      <div className="list-rows" style={{ marginTop: 12 }}>
        {loading ? (
          <p className="muted-text">Cargando…</p>
        ) : solicitudes.length === 0 ? (
          <p className="muted-text">No hay solicitudes {filtro === 'PENDIENTE' ? 'pendientes' : filtro === 'PROGRAMADA' ? 'programadas' : filtro === 'ENTREGADA' ? 'entregadas' : ''}.</p>
        ) : solicitudes.map((s) => {
          const nombre = s.operarioNombre ?? userName.get(s.operarioId) ?? s.operarioId
          const iniciales = nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase()
          const tone = s.estado === 'PENDIENTE' ? 'pend' : s.estado === 'PROGRAMADA' ? 'prog' : s.estado === 'RECHAZADA' ? 'rech' : 'entr'
          return (
            <article key={s.id} className={`sol-card sol-card--${tone}`}>
              <header className="sol-card__head">
                <span className="sol-card__avatar" aria-hidden>{iniciales || '?'}</span>
                <div className="sol-card__who">
                  <strong>{nombre}</strong>
                  <span>
                    {fmtFecha(s.createdAt)}{s.zona ? ` · Zona ${s.zona}` : ''}
                    {s.origen !== 'DIRECTA' && !s.entregadoEn && s.estado !== 'RECHAZADA' && (
                      <> · ⏱ lleva {fmtLapso(s.createdAt, new Date().toISOString())}</>
                    )}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                  <span className={`status-pill ${s.estado === 'PENDIENTE' ? '' : s.estado === 'PROGRAMADA' ? 'amber' : s.estado === 'RECHAZADA' ? 'red' : 'green'}`}>
                    {ESTADO_LABEL[s.estado]}
                  </span>
                  {s.origen === 'DIRECTA'
                    ? <span className="sol-origen sol-origen--dir">⚡ Entrega directa</span>
                    : <span className="sol-origen">🙋 Solicitada</span>}
                </div>
              </header>

              <ul className="sol-card__items">
                {s.items.map((it) => {
                  const desp = it.cantidadDespachada ?? it.cantidad
                  const rectificado = it.cantidadRecibida != null && it.cantidadRecibida !== desp
                  return (
                    <li key={it.id}>
                      <span className={`sol-card__qty${rectificado ? ' sol-card__qty--dif' : ''}`}>
                        {rectificado ? it.cantidadRecibida : desp} {it.unidad}
                      </span>
                      <span className="sol-card__item-name">{it.insumoNombre}</span>
                      {rectificado && <span className="sol-card__qty-orig">despachado {desp}</span>}
                      {!rectificado && it.cantidadDespachada != null && it.cantidadDespachada !== it.cantidad && (
                        <span className="sol-card__qty-orig">pidió {it.cantidad}</span>
                      )}
                    </li>
                  )
                })}
              </ul>

              {s.nota && <p className="sol-card__nota">💬 {s.nota}</p>}
              {s.motivoRechazo && <p className="sol-card__nota sol-card__nota--rechazo">✕ Rechazo: {s.motivoRechazo}</p>}

              {s.estado === 'ENTREGADA' && (
                <>
                  {/* Aval del operario: banner que cierra (o no) el ciclo de dos partes. */}
                  <div className={`sol-card__aval ${s.confirmadoEn ? (s.conforme ? 'sol-card__aval--ok' : 'sol-card__aval--dif') : 'sol-card__aval--wait'}`}>
                    {s.confirmadoEn
                      ? s.conforme
                        ? <>✔ Confirmada por el operario · {fmtFecha(s.confirmadoEn)}</>
                        : <>⚠ DIFERENCIA reportada · {fmtFecha(s.confirmadoEn)}{s.confirmacionNota ? ` — ${s.confirmacionNota}` : ''}</>
                      : <>⏳ Sin confirmar por el operario</>}
                  </div>
                  <div className="sol-card__meta">
                    {s.entregadoEn && <span title="Fecha y hora de la entrega">📦 {fmtFecha(s.entregadoEn)}</span>}
                    {/* Tiempo de respuesta: cuánto se demoró desde que la pidieron.
                        Solo tiene sentido en las SOLICITADAS — en una entrega directa
                        el supervisor la crea y la despacha en el mismo acto. */}
                    {s.origen !== 'DIRECTA' && s.entregadoEn && fmtLapso(s.createdAt, s.entregadoEn) && (
                      <span title="Tiempo de respuesta desde que la solicitó">⚡ {fmtLapso(s.createdAt, s.entregadoEn)}</span>
                    )}
                    {s.despachadoPor && <span title="Despachado por">👤 {userName.get(s.despachadoPor) ?? s.despachadoPor}</span>}
                    {s.equipoCodigo && <span title="Máquina">🚜 {equipoNombre.get(s.equipoCodigo) ?? s.equipoCodigo}</span>}
                    {s.horometro != null && <span title="Horómetro">⏱ {s.horometro}</span>}
                    {s.ruta && <span title="Ruta">🛣 {s.ruta}</span>}
                  </div>
                  {s.evidenciaUrls && s.evidenciaUrls.length > 0 && (
                    <div className="sol-card__fotos">
                      {s.evidenciaUrls.map((u, i) => (
                        <a key={i} href={u} target="_blank" rel="noreferrer">
                          <img src={u} alt={`evidencia ${i + 1}`} />
                        </a>
                      ))}
                    </div>
                  )}
                  {/* La corrección se ofrece AQUÍ porque es donde el supervisor
                      mira sus entregas. Ponerla solo en Reportes era tenerla
                      escondida de quien la necesita. */}
                  {PUEDEN_CORREGIR.includes(session?.role ?? '') && (
                    <button type="button" className="inline-button" style={{ marginTop: 8 }}
                            onClick={() => setCorrigiendo(s)}>
                      ✏️ Corregir fecha, máquina o cantidad
                    </button>
                  )}
                </>
              )}

              {(s.estado === 'PENDIENTE' || s.estado === 'PROGRAMADA') && (
                <footer className="sol-card__actions">
                  {s.estado === 'PENDIENTE' && (
                    <button type="button" className="primary-button" onClick={() => void programar(s)} disabled={busy}>Programar</button>
                  )}
                  <button type="button" className="primary-button outline" onClick={() => openEntrega(s)} disabled={busy}>📦 Entregar</button>
                  <button type="button" className="inline-button maestro-delete-btn" onClick={() => { setRechazoTarget(s); setMotivo(''); setError('') }} disabled={busy}>Rechazar</button>
                </footer>
              )}
            </article>
          )
        })}
      </div>

      {rechazoTarget && (
        <div className="modal-overlay open" onClick={() => setRechazoTarget(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(420px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Bandeja</p><h3>Rechazar solicitud</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setRechazoTarget(null)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <label>
              Motivo <span className="field-optional">(opcional)</span>
              <CampoLista tipo="MOTIVO_RECHAZO" value={motivo} onChange={setMotivo} disabled={busy} placeholder="Sin stock, no procede…" autoFocus />
            </label>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setRechazoTarget(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="release-confirm-btn" onClick={() => void confirmarRechazo()} disabled={busy}>{busy ? 'Guardando…' : 'Rechazar'}</button>
            </div>
          </div>
        </div>
      )}

      {entregaTarget && (
        <div className="modal-overlay open" onClick={() => { if (!busy && !subiendoFoto) setEntregaTarget(null) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(480px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Despacho</p><h3>📦 Entregar a {entregaTarget.operarioNombre ?? userName.get(entregaTarget.operarioId) ?? entregaTarget.operarioId}</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setEntregaTarget(null)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              Confirma la cantidad despachada por ítem. Se descuenta de {miBodega?.nombre ?? 'tu bodega'}.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {entregaItems.map((row, idx) => {
                const stock = row.insumoId ? stockMio(row.insumoId) : 0
                const excede = Number(row.cantidad) > stock
                return (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ fontSize: '0.9rem' }}>{row.insumoNombre}</strong>
                      <div className="subtle-copy" style={{ fontSize: '0.76rem', color: excede ? '#b3261e' : undefined }}>
                        En {miBodega?.nombre ?? 'mi bodega'}: {fmtCantidad(stock, row.unidad)} {row.unidad}
                        {excede ? ' · no te alcanza' : ''}
                      </div>
                    </div>
                    <input type="number" min={0} step="any" value={row.cantidad}
                      onChange={(e) => setEntregaItems((prev) => prev.map((r, i) => (i === idx ? { ...r, cantidad: e.target.value } : r)))}
                      disabled={busy} style={{ width: 90 }} />
                    <span className="subtle-copy" style={{ width: 44, fontSize: '0.78rem' }}>{row.unidad}</span>
                    {!row.itemId && (
                      <button type="button" className="inline-button" disabled={busy}
                        onClick={() => setEntregaItems((prev) => prev.filter((_, i) => i !== idx))}
                        aria-label={`Quitar ${row.insumoNombre}`}>✕</button>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Adicionales: el operario pidió una cosa y el supervisor le lleva
                otra de una. Pasa todo el tiempo, y antes tocaba hacer una
                entrega directa aparte para lo mismo. */}
            <div style={{ marginTop: 10 }}>
              <span className="subtle-copy" style={{ display: 'block', marginBottom: 4 }}>
                ¿Le vas a entregar algo más que no pidió?
              </span>
              <SearchableSelect
                value=""
                onChange={(v) => {
                  const ins = insumos.find((i) => i.id === v)
                  if (!ins || entregaItems.some((r) => r.insumoId === v)) return
                  setEntregaItems((prev) => [...prev, {
                    insumoId: ins.id, insumoNombre: ins.nombre, unidad: ins.unidad, cantidad: '',
                  }])
                }}
                options={activeInsumos
                  .filter((i) => !entregaItems.some((r) => r.insumoId === i.id))
                  .map((i) => ({
                    value: i.id,
                    label: `${i.nombre} (${i.unidad})`,
                    rightLabel: fmtCantidad(stockMio(i.id), i.unidad),
                    frecuente: i.frecuente,
                  }))}
                placeholder="+ Agregar otro insumo…"
                disabled={busy}
              />
            </div>
            <label style={{ marginTop: 10 }}>
              Horómetro de la máquina <span style={{ color: '#b3261e' }}>*</span>
              <input
                type="number" min={0} step="any" inputMode="decimal" placeholder="Lectura del horómetro"
                value={entregaHorometro}
                onChange={(e) => setEntregaHorometro(e.target.value)}
                disabled={busy}
                required
              />
            </label>
            <SwitchEngraso value={entregaEngraso} onChange={setEntregaEngraso} disabled={busy} />

            <label style={{ marginTop: 10 }}>
              Máquina (tractor) <span style={{ color: '#b3261e' }}>*</span>
              <SearchableSelect
                value={entregaEquipo}
                onChange={setEntregaEquipo}
                options={[
                  ...(entregaEquipo && !sortedEquipment.some((eq) => eq.code === entregaEquipo)
                    ? [{ value: entregaEquipo, label: equipoNombre.get(entregaEquipo) ?? entregaEquipo }]
                    : []),
                  ...sortedEquipment.map((eq) => ({ value: eq.code, label: eq.name })),
                ]}
                placeholder="Buscar máquina…"
                disabled={busy}
              />
              <span className="field-hint" style={{ fontSize: '0.76rem' }}>Por defecto el equipo del operario. El material se carga a esta máquina.</span>
            </label>
            <div style={{ marginTop: 10 }}>
              <span className="subtle-copy" style={{ display: 'block', marginBottom: 6 }}>Evidencia (fotos)</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {evidencias.map((u, i) => (
                  esFotoLocal(u)
                  ? <span key={i} className="foto-pendiente" title="Guardada en el equipo; se sube cuando haya senal">&#128247; sin subir</span>
                  : <img key={i} src={u} alt={`evidencia ${i + 1}`} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8 }} />
                ))}
                <button type="button" className="inline-button" onClick={() => fotoInputRef.current?.click()} disabled={busy || subiendoFoto}>
                  {subiendoFoto ? 'Subiendo…' : '📷 Agregar foto'}
                </button>
              </div>
              <input ref={fotoInputRef} type="file" accept="image/*" capture="environment" hidden onChange={handleFotoChange} />
            </div>
            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setEntregaTarget(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void confirmarEntrega()} disabled={busy || subiendoFoto || !entregaHorometro.trim() || !entregaEquipo}>
                {busy ? 'Guardando…' : 'Confirmar entrega'}
              </button>
            </div>
          </div>
        </div>
      )}
      {directaOpen && (
        <div className="modal-overlay open" onClick={() => { if (!busy && !dirSubiendo) setDirectaOpen(false) }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(480px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Despacho</p><h3>⚡ Entrega directa</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setDirectaOpen(false)} disabled={busy} aria-label="Cerrar">&#x2715;</button>
            </div>
            <p className="subtle-copy" style={{ marginTop: 0 }}>
              Entregas sin que el operario lo haya pedido. Igual le llega la tarjeta <strong>“¿Recibiste?”</strong> para su aval.
            </p>

            <label>
              Entregar a
              <SearchableSelect
                value={dirOperario}
                onChange={onDirOperario}
                options={operarios.map((u) => ({ value: u.id, label: u.name }))}
                placeholder="Buscar operario…"
                disabled={busy}
              />
            </label>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
              {dirItems.map((row, idx) => {
                const ins = insumos.find((i) => i.id === row.insumoId)
                const stock = row.insumoId ? stockMio(row.insumoId) : 0
                const excede = Number(row.cantidad) > stock
                return (
                  <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <SearchableSelect
                        value={row.insumoId}
                        onChange={(v) => setDirItems((prev) => prev.map((r, i) => (i === idx ? { ...r, insumoId: v } : r)))}
                        options={activeInsumos.map((i) => ({
                          value: i.id,
                          label: `${i.nombre} (${i.unidad})`,
                          rightLabel: fmtCantidad(stockMio(i.id), i.unidad),
                          frecuente: i.frecuente,
                        }))}
                        placeholder="Buscar insumo…"
                        disabled={busy}
                      />
                    </div>
                    <input
                      type="number" min={0} step={stepDe(ins?.unidad)} placeholder="Cant."
                      value={row.cantidad}
                      onChange={(e) => setDirItems((prev) => prev.map((r, i) => (i === idx ? { ...r, cantidad: e.target.value } : r)))}
                      disabled={busy} style={{ width: 80, borderColor: excede ? '#b3261e' : undefined }}
                      title={excede ? `Excede el stock (${stock})` : ''}
                    />
                    <span className="subtle-copy" style={{ width: 44, fontSize: '0.78rem' }}>{ins?.unidad ?? ''}</span>
                    {dirItems.length > 1 && (
                      <button type="button" className="modal-close-btn" onClick={() => setDirItems((prev) => prev.filter((_, i) => i !== idx))} disabled={busy} aria-label="Quitar">&#x2715;</button>
                    )}
                  </div>
                )
              })}
            </div>
            <button type="button" className="inline-button" style={{ marginTop: 8 }} onClick={() => setDirItems((prev) => [...prev, { insumoId: '', cantidad: '' }])} disabled={busy}>
              + Agregar otro insumo
            </button>

            <label style={{ marginTop: 10 }}>
              Horómetro de la máquina <span style={{ color: '#b3261e' }}>*</span>
              <input type="number" min={0} step="any" inputMode="decimal" placeholder="Lectura del horómetro" value={dirHorometro} onChange={(e) => setDirHorometro(e.target.value)} disabled={busy} />
            </label>
            <label style={{ marginTop: 10 }}>
              Máquina (tractor) <span style={{ color: '#b3261e' }}>*</span>
              <SearchableSelect
                value={dirEquipo}
                onChange={setDirEquipo}
                options={[
                  ...(dirEquipo && !sortedEquipment.some((eq) => eq.code === dirEquipo)
                    ? [{ value: dirEquipo, label: equipoNombre.get(dirEquipo) ?? dirEquipo }]
                    : []),
                  ...sortedEquipment.map((eq) => ({ value: eq.code, label: eq.name })),
                ]}
                placeholder="Buscar máquina…"
                disabled={busy}
              />
            </label>
            <SwitchEngraso value={dirEngraso} onChange={setDirEngraso} disabled={busy} />

            <label style={{ marginTop: 10 }}>
              Nota <span className="field-optional">(opcional)</span>
              <CampoLista tipo="USO" value={dirNota} onChange={setDirNota} disabled={busy} placeholder="Para qué / dónde…" />
            </label>

            <div style={{ marginTop: 10 }}>
              <span className="subtle-copy" style={{ display: 'block', marginBottom: 6 }}>Evidencia (fotos)</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {dirFotos.map((u, i) => (
                  esFotoLocal(u)
                  ? <span key={i} className="foto-pendiente" title="Guardada en el equipo; se sube cuando haya senal">&#128247; sin subir</span>
                  : <img key={i} src={u} alt={`evidencia ${i + 1}`} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8 }} />
                ))}
                <button type="button" className="inline-button" onClick={() => dirFotoRef.current?.click()} disabled={busy || dirSubiendo}>
                  {dirSubiendo ? 'Subiendo…' : '📷 Agregar foto'}
                </button>
              </div>
              <input ref={dirFotoRef} type="file" accept="image/*" capture="environment" hidden onChange={handleDirFoto} />
            </div>

            <div className="modal-footer">
              <button type="button" className="inline-button" onClick={() => setDirectaOpen(false)} disabled={busy}>Cancelar</button>
              <button type="button" className="primary-button" onClick={() => void confirmarDirecta()} disabled={busy || dirSubiendo}>
                {busy ? 'Registrando…' : 'Registrar entrega'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tanqueo del analista: sale de la principal y va a consumo. Nace
          PENDIENTE como cualquier otro, pero él NO puede avalar el suyo. */}
      {esAnalista && (
        <TanqueoModal
          open={tanqueoOpen}
          onClose={() => setTanqueoOpen(false)}
          onSaved={() => void refresh()}
          bodegaId={miBodega?.id}
          destinos={['MAQUINA', 'VEHICULO']}
        />
      )}

      {/* Corregir un despacho ya entregado. La fecha de registro queda intacta;
          lo que cambia es la fecha en que ocurrió, que es la de los reportes. */}
      {corrigiendo && (
        <EditarDespachoModal
          entrega={corrigiendo}
          onClose={() => setCorrigiendo(null)}
          onGuardado={() => { void refresh(); void refrescarStockBodega() }}
        />
      )}
    </section>
  )
}

export default BandejaInsumosTab
