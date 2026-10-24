import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CtxFincas } from './FincasView'
import { mensajeDeError } from '../../services/fincasApi'
import {
  avisarPendientes, enviarOEncolarReporte, esRechazo, quitarPendiente, reportesPendientes, sincronizarReportes,
  EVENTO_PENDIENTES, type ReportePendiente,
} from '../../lib/outboxFincas'
import {
  avanceLabor, cicloAbiertoDe, contextoReporte, fmtCant, FOTO_OBLIGATORIA, PEDIR_UBICACION, rechazosPorAtender, reportesConCola,
} from '../../lib/fincas'
import { leerRechazosAtendidos, marcarRechazoAtendido } from '../../lib/cacheFincas'
import { fmtFechaHora } from '../../lib/fechas'
import type { ReporteCampo } from '../../services/fincasApi'


type Gps =
  | { estado: 'apagada' }
  | { estado: 'buscando' }
  | { estado: 'ok'; lat: number; lng: number; precision: number }
  | { estado: 'no'; motivo: string }

/**
 * Reportar una labor desde el campo: la foto y —al guardar— la hora del SERVIDOR,
 * no la del aparato. Dos cosas APAGADAS de momento: la ubicación del celular
 * (`PEDIR_UBICACION`, 16-oct-2026: Julio reporta aunque no esté en la finca) y la
 * foto obligatoria (`FOTO_OBLIGATORIA`, 17-oct-2026: se puede reportar sin foto).
 * El reporte queda POR ACEPTAR: otra persona lo verifica antes de que cuente.
 *
 * SIN SEÑAL no se pierde nada: el reporte y su foto quedan guardados en el
 * celular y salen solos cuando vuelve la cobertura (`lib/outboxFincas`).
 */
export function ReportarLabor({ ctx }: { ctx: CtxFincas }) {
  const { datos: d, hoy, usuario, token, nombre, puedeReportar, recargar } = ctx
  const [fincaId, setFincaId] = useState('')
  const [suerteId, setSuerteId] = useState('')
  const [laborId, setLaborId] = useState('')
  const [cantidad, setCantidad] = useState('')
  const [fecha, setFecha] = useState(hoy)
  const [nota, setNota] = useState('')
  const [foto, setFoto] = useState<File | null>(null)
  const [vista, setVista] = useState<string | null>(null)
  const [gps, setGps] = useState<Gps>(PEDIR_UBICACION ? { estado: 'buscando' } : { estado: 'apagada' })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [listo, setListo] = useState('')
  // La id del reporte se fija al empezar y se mantiene en los reintentos: si la
  // señal se cae a mitad de camino y el reporte sí llegó, reintentar NO lo duplica
  // (la base devuelve el mismo). Se cambia solo cuando el reporte queda guardado.
  const [idReporte, setIdReporte] = useState(() => crypto.randomUUID())
  const [pendientes, setPendientes] = useState<ReportePendiente[]>([])
  const [enviandoCola, setEnviandoCola] = useState(false)
  // Corrigiendo un reporte RECHAZADO: su id, para darlo por atendido al reenviar.
  const [corrigiendo, setCorrigiendo] = useState<ReporteCampo | null>(null)
  const [atendidos, setAtendidos] = useState<Set<string>>(() => leerRechazosAtendidos(usuario))

  const refrescarPendientes = useCallback(() => { void reportesPendientes().then(setPendientes) }, [])
  useEffect(() => {
    refrescarPendientes()
    window.addEventListener(EVENTO_PENDIENTES, refrescarPendientes)
    window.addEventListener('online', refrescarPendientes)
    return () => {
      window.removeEventListener(EVENTO_PENDIENTES, refrescarPendientes)
      window.removeEventListener('online', refrescarPendientes)
    }
  }, [refrescarPendientes])

  // La ubicación se pide al abrir: cuando el operario termine de llenar, ya está.
  // Apagada de momento: ni se pide el permiso (el celular no pregunta nada).
  useEffect(() => {
    if (!PEDIR_UBICACION) return
    if (!('geolocation' in navigator)) { setGps({ estado: 'no', motivo: 'este celular no da ubicación' }); return }
    navigator.geolocation.getCurrentPosition(
      (p) => setGps({ estado: 'ok', lat: p.coords.latitude, lng: p.coords.longitude, precision: Math.round(p.coords.accuracy) }),
      (e) => setGps({ estado: 'no', motivo: e.code === 1 ? 'no se dio permiso de ubicación' : 'no se pudo tomar la ubicación' }),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    )
  }, [])
  useEffect(() => () => { if (vista) URL.revokeObjectURL(vista) }, [vista])

  // Lo que espera señal cuenta como POR ACEPTAR en «faltan» (si no, invita a
  // registrarlo otra vez); lo que el servidor rechazó en la cola, no.
  const cola = useMemo(() => pendientes.filter((p) => !esRechazo(p)), [pendientes])
  const noSalieron = useMemo(() => pendientes.filter((p) => esRechazo(p)), [pendientes])
  const reportes = useMemo(() => reportesConCola(d.reportes, cola), [d.reportes, cola])
  const rechazos = useMemo(() => rechazosPorAtender(d, usuario, atendidos), [d, usuario, atendidos])

  const fincas = d.fincas.filter((f) => f.activa && d.suertes.some((s) => s.fincaId === f.id && cicloAbiertoDe(s.id, d.ciclos)))
  const suertes = d.suertes.filter((s) => s.fincaId === fincaId && s.activa && cicloAbiertoDe(s.id, d.ciclos))
  const ciclo = suerteId ? cicloAbiertoDe(suerteId, d.ciclos) : null
  // Solo lo que todavía se puede reportar: una labor de una pasada ya reportada
  // completa (aceptada o por aceptar) no sale como «faltan 0».
  const labores = ciclo
    ? d.labores.filter((l) => l.cicloId === ciclo.id && l.estado !== 'ANULADA' && l.estado !== 'TERMINADA'
        && (l.repetible || avanceLabor(l, reportes).restante > 0.001))
    : []
  const labor = labores.find((l) => l.id === laborId)
  const avance = labor ? avanceLabor(labor, reportes) : null
  const n = Number(cantidad.replace(',', '.'))
  const topePasada = d.suertes.find((s) => s.id === suerteId)?.areaHa ?? labor?.cantidadPlan ?? 0
  const misReportes = useMemo(() => d.reportes.filter((r) => r.reportadoPor === usuario).slice(0, 8), [d.reportes, usuario])

  // Una sola opción = ya escogida (Riogrande es hoy la única finca): menos toques.
  const unicaFinca = fincas.length === 1 ? fincas[0].id : ''
  const unicaSuerte = suertes.length === 1 ? suertes[0].id : ''
  useEffect(() => { if (unicaFinca && !fincaId) setFincaId(unicaFinca) }, [unicaFinca, fincaId])
  useEffect(() => { if (unicaSuerte && !suerteId) setSuerteId(unicaSuerte) }, [unicaSuerte, suerteId])

  if (!puedeReportar) return <p className="subtle-copy">Su usuario no reporta labores de fincas.</p>

  const problemas = [
    !labor && 'Escoja finca, suerte y labor.',
    labor && !(n > 0) && 'Escriba la cantidad hecha.',
    labor && avance && esHectarea(labor.unidad) && !labor.repetible && n > avance.restante + 0.001 && `Solo quedan ${fmtCant(avance.restante)} ${labor.unidad} por reportar en esta labor.`,
    // Varias pasadas: el total no se topa, pero una pasada no cabe en más que la suerte.
    labor && esHectarea(labor.unidad) && labor.repetible && n > topePasada + 0.001 && `Una pasada no puede pasar de ${fmtCant(topePasada)} ha (el área de la suerte).`,
    ciclo && fecha < ciclo.fechaCorte && `La fecha no puede ser antes del corte (${ciclo.fechaCorte}).`,
    fecha > hoy && 'La fecha no puede ser después de hoy.',
    FOTO_OBLIGATORIA && !foto && 'Tome la foto de la labor: sin foto no hay reporte.',
  ].filter(Boolean) as string[]

  async function enviar() {
    if (problemas.length || !labor || (FOTO_OBLIGATORIA && !foto)) return
    setGuardando(true); setError(''); setListo('')
    const suerte = d.suertes.find((s) => s.id === suerteId)
    const finca = d.fincas.find((f) => f.id === fincaId)
    try {
      const { enviado } = await enviarOEncolarReporte({
        id: idReporte, laborId: labor.id, cantidad: n, fecha,
        lat: gps.estado === 'ok' ? gps.lat : null, lng: gps.estado === 'ok' ? gps.lng : null,
        precisionM: gps.estado === 'ok' ? gps.precision : null, nota,
        usuario,
        etiqueta: `${labor.labor.toLowerCase()} · ${fmtCant(n)} ${labor.unidad} · suerte ${suerte?.codigo ?? ''} · ${finca?.nombre ?? ''}`,
      }, foto, token)
      // La pantalla dice la verdad: «reportado» solo si de verdad llego.
      setListo(enviado
        ? `Reportado: ${fmtCant(n)} ${labor.unidad} de ${labor.labor.toLowerCase()}. Queda por aceptar.`
        : 'Sin señal: quedó guardado en este celular con su foto. Se envía solo cuando vuelva la señal; no lo vuelva a registrar.')
      setLaborId(''); setCantidad(''); setNota(''); setFoto(null); setVista(null)
      setIdReporte(crypto.randomUUID())
      // El reporte corregido reemplaza al rechazado: ese ya no sale «por corregir».
      if (corrigiendo) { marcarRechazoAtendido(usuario, corrigiendo.id); setAtendidos(leerRechazosAtendidos(usuario)); setCorrigiendo(null) }
      refrescarPendientes(); avisarPendientes()
      if (enviado) await recargar()
    } catch (e) { setError(mensajeDeError(e)) } finally { setGuardando(false) }
  }

  /** Llena el formulario con el reporte rechazado, para corregirlo y reenviarlo. */
  function corregir(r: ReporteCampo) {
    const { suerte, finca } = contextoReporte(r, d)
    if (!suerte || !finca) return
    setFincaId(finca.id); setSuerteId(suerte.id); setLaborId(r.laborId)
    setCantidad(String(r.cantidad)); setFecha(r.fecha); setNota(r.nota ?? '')
    setFoto(null); setVista(null); setError(''); setListo('')
    setCorrigiendo(r)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function noHaceFalta(r: ReporteCampo) {
    if (!window.confirm('¿Dejar este rechazo así, sin corregirlo? Deja de salir en la lista; el reporte rechazado no cuenta.')) return
    marcarRechazoAtendido(usuario, r.id); setAtendidos(leerRechazosAtendidos(usuario)); avisarPendientes()
    if (corrigiendo?.id === r.id) setCorrigiendo(null)
  }

  async function quitar(p: ReportePendiente) {
    const texto = esRechazo(p)
      ? `¿Quitar «${p.etiqueta}»? No salió y no va a salir solo. Se borra de este celular; si hay que reportarlo, vuelva a registrarlo bien.`
      : `¿Quitar «${p.etiqueta}»? Todavía no ha salido: se borra de este celular con su foto y NO se envía.`
    if (!window.confirm(texto)) return
    await quitarPendiente(p.outboxId)
    refrescarPendientes()
  }

  async function enviarCola() {
    setEnviandoCola(true); setError('')
    try {
      const enviados = await sincronizarReportes()
      refrescarPendientes(); avisarPendientes()
      if (enviados > 0) {
        setListo(`${enviados} reporte${enviados === 1 ? '' : 's'} enviado${enviados === 1 ? '' : 's'}. Queda${enviados === 1 ? '' : 'n'} por aceptar.`)
        await recargar()
      }
    } finally { setEnviandoCola(false) }
  }

  return (
    <div className="af-stack">
      <div className="af-cab"><div><p className="eyebrow">Campo</p><h2>Reportar una labor</h2></div></div>

      {/* Lo rechazado va ARRIBA (16-oct-2026): antes solo se veía bajando a «Mis
          últimos reportes», sin aviso y sin forma de corregirlo. */}
      {rechazos.length > 0 && (
        <div className="af-card af-card--espera">
          <h3>⚠ Le rechazaron {rechazos.length === 1 ? 'un reporte' : `${rechazos.length} reportes`}</h3>
          <ul className="af-lista">
            {rechazos.map((r) => {
              const { labor: l, suerte: s } = contextoReporte(r, d)
              return (
                <li key={r.id} className="af-mov">
                  {r.fotoUrl ? <img className="af-foto" src={r.fotoUrl} alt="evidencia" loading="lazy" /> : <span className="af-foto af-foto--vacia" title="sin foto">📷</span>}
                  <span>
                    <b>{l?.labor.toLowerCase()} · {fmtCant(r.cantidad)} {l?.unidad} · suerte {s?.codigo}</b>
                    <small>hecha el {r.fecha} · rechazó {nombre(r.revisadoPor ?? '')}: «{r.motivoRechazo}»</small>
                  </span>
                  <span className="af-acciones" style={{ margin: 0 }}>
                    <button type="button" className="inline-button" onClick={() => corregir(r)}>Corregir y reenviar</button>
                    <button type="button" className="inline-button" onClick={() => noHaceFalta(r)}>No hace falta</button>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="af-card">
        {corrigiendo && (
          <p className="af-nota" style={{ marginTop: 0 }}>
            ✏️ Corrigiendo el reporte rechazado («{corrigiendo.motivoRechazo}»). Revise los datos y vuelva a poner la foto —puede escogerla de la galería—.{' '}
            <button type="button" className="inline-button" onClick={() => { setCorrigiendo(null); setLaborId(''); setCantidad(''); setNota('') }}>Cancelar corrección</button>
          </p>
        )}
        {fincas.length === 0 && <p className="af-nota" style={{ marginTop: 0 }}>No hay fincas con un corte en curso para reportar. Lo inicia administración.</p>}
        <div className="af-form">
          <label>Finca
            <select id="af-rep-finca" value={fincaId} onChange={(e) => { setFincaId(e.target.value); setSuerteId(''); setLaborId('') }}>
              <option value="">Escoja…</option>
              {fincas.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
            </select>
          </label>
          <label>Suerte
            <select id="af-rep-suerte" value={suerteId} disabled={!fincaId} onChange={(e) => { setSuerteId(e.target.value); setLaborId('') }}>
              <option value="">Escoja…</option>
              {suertes.map((s) => <option key={s.id} value={s.id}>Suerte {s.codigo} · {fmtCant(s.areaHa)} ha</option>)}
            </select>
          </label>
          <label className="af-form__ancho">Labor
            <select id="af-rep-labor" value={laborId} disabled={!suerteId} onChange={(e) => {
              setLaborId(e.target.value)
              const l = labores.find((x) => x.id === e.target.value)
              if (l) { const a = avanceLabor(l, reportes); setCantidad(a.restante > 0 ? String(Math.round(a.restante * 100) / 100) : '') }
            }}>
              <option value="">Escoja…</option>
              {labores.map((l) => { const a = avanceLabor(l, reportes); return (
                <option key={l.id} value={l.id}>
                  {l.labor.toLowerCase()} · {l.repetible ? `pasada ${a.pasadaEnCurso} · ` : ''}faltan {fmtCant(a.restante)} {l.unidad}
                </option>
              ) })}
            </select>
            {fincaId && suertes.length === 0 && <small className="af-nota">Esta finca no tiene suertes con un corte en curso.</small>}
            {suerteId && labores.length === 0 && (
              <small className="af-nota">
                Esta suerte no tiene labores pendientes en el plan del corte. Si se hizo una labor que no está en el plan,
                pídale a administración que la agregue al paquete.
              </small>
            )}
          </label>
          <label>Cantidad hecha {labor ? `(${labor.unidad})` : ''}
            <input id="af-rep-cantidad" inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="0" />
          </label>
          <label>Día en que se hizo
            <input id="af-rep-fecha" type="date" value={fecha} max={hoy} min={ciclo?.fechaCorte} onChange={(e) => setFecha(e.target.value)} />
          </label>
          {/* Sin `capture`: el celular ofrece la cámara Y la galería. Con la ubicación
              apagada (PEDIR_UBICACION) Julio reporta también desde la casa, y ahí la
              foto es la que tomó en el campo. `key` vacía el campo tras cada envío. */}
          <label className="af-form__ancho">Foto de la labor {FOTO_OBLIGATORIA ? "(obligatoria)" : "(opcional por ahora)"} · tómela o escójala de la galería
            <input key={idReporte} id="af-rep-foto" type="file" accept="image/*" onChange={(e) => {
              const f = e.target.files?.[0] ?? null
              setFoto(f); setVista(f ? URL.createObjectURL(f) : null)
            }} />
          </label>
          {vista && <img className="af-foto af-foto--grande" src={vista} alt="foto de la labor" />}
          {gps.estado !== 'apagada' && (
            <p className={`af-gps af-gps--${gps.estado}`}>
              {gps.estado === 'buscando' ? '⌖ Tomando la ubicación…'
                : gps.estado === 'ok' ? `⌖ Ubicación tomada (±${gps.precision} m)`
                : `⌖ Sin ubicación: ${gps.motivo}. El reporte sale marcado así.`}
            </p>
          )}
          <label className="af-form__ancho">Nota (opcional)
            <input id="af-rep-nota" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: quedó pendiente la cabecera norte" />
          </label>
        </div>
        {error && <p className="feedback error">{error}</p>}
        {listo && <p className="af-ok">✓ {listo}</p>}
        {problemas.length > 0 && !guardando && <p className="af-nota">{problemas[0]}</p>}
        <div className="af-acciones">
          <button type="button" className="primary-button" disabled={guardando || problemas.length > 0} onClick={() => void enviar()}>
            {guardando ? 'Enviando…' : 'Enviar reporte'}
          </button>
        </div>
      </div>

      {/* 🔴 Dos listas, no una (16-oct-2026): lo que ESPERA SEÑAL sale solo; lo que
          el servidor RECHAZÓ no va a salir nunca y antes se quedaba ahí, bajo
          «salen solos», reintentándose sin fin y sin forma de quitarlo. */}
      {noSalieron.length > 0 && (
        <div className="af-card af-card--espera">
          <h3>⚠ No salieron ({noSalieron.length})</h3>
          <p className="af-nota" style={{ marginTop: 0 }}>
            El servidor no los aceptó y no van a salir solos. Lea el motivo, quítelos y, si hace falta, vuelva a registrarlos bien.
          </p>
          <ul className="af-lista">
            {noSalieron.map((p) => (
              <li key={p.outboxId} className="af-mov">
                <span className="af-foto af-foto--vacia">📷</span>
                <span>
                  <b>{p.etiqueta}</b>
                  <small>hecha el {p.fecha} · {mensajeDeError({ message: p.errorMessage ?? '' })}</small>
                </span>
                <button type="button" className="inline-button" onClick={() => void quitar(p)}>Quitar</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {cola.length > 0 && (
        <div className="af-card af-card--espera">
          <h3>⏳ Esperando señal ({cola.length})</h3>
          <p className="af-nota" style={{ marginTop: 0 }}>
            Están guardados en este celular, con su foto. Salen solos cuando haya cobertura: no los vuelva a registrar.
          </p>
          <ul className="af-lista">
            {cola.map((p) => (
              <li key={p.outboxId} className="af-mov">
                <span className="af-foto af-foto--vacia">📷</span>
                <span>
                  <b>{p.etiqueta}</b>
                  <small>
                    hecha el {p.fecha} · guardada {fmtFechaHora(p.queuedAt)}
                    {p.estado === 'error' && p.errorMessage ? ` · todavía no sale: ${mensajeDeError({ message: p.errorMessage })}` : ''}
                  </small>
                </span>
                <button type="button" className="inline-button" onClick={() => void quitar(p)}>Quitar</button>
              </li>
            ))}
          </ul>
          <div className="af-acciones">
            <button type="button" className="inline-button" disabled={enviandoCola} onClick={() => void enviarCola()}>
              {enviandoCola ? 'Enviando…' : 'Intentar enviar ahora'}
            </button>
          </div>
        </div>
      )}

      {misReportes.length > 0 && (
        <div className="af-card">
          <h3>Mis últimos reportes</h3>
          <ul className="af-lista">
            {misReportes.map((r) => {
              const l = d.labores.find((x) => x.id === r.laborId)
              return (
                <li key={r.id} className="af-mov">
                  {r.fotoUrl ? <img className="af-foto" src={r.fotoUrl} alt="evidencia" loading="lazy" /> : <span className="af-foto af-foto--vacia" title="sin foto">📷</span>}
                  <span><b>{l?.labor.toLowerCase()} · {fmtCant(r.cantidad)} {l?.unidad}</b>
                    <small>{fmtFechaHora(r.createdAt)}{r.estado === 'RECHAZADO' ? ` · rechazado por ${nombre(r.revisadoPor ?? '')}: ${r.motivoRechazo}` : ''}</small></span>
                  <span className={`af-chip ${r.estado === 'ACEPTADO' ? 'af-chip--ok' : r.estado === 'PENDIENTE' ? 'af-chip--ojo' : 'af-chip--mal'}`}>
                    {r.estado === 'PENDIENTE' ? 'por aceptar' : r.estado.toLowerCase()}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

function esHectarea(unidad: string) { return unidad.toLowerCase() === 'ha' }

