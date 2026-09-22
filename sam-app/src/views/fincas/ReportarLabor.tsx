import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CtxFincas } from './FincasView'
import { mensajeDeError } from '../../services/fincasApi'
import {
  avisarPendientes, enviarOEncolarReporte, reportesPendientes, sincronizarReportes,
  EVENTO_PENDIENTES, type ReportePendiente,
} from '../../lib/outboxFincas'
import { avanceLabor, cicloAbiertoDe, fmtCant } from '../../lib/fincas'
import { fmtFechaHora } from '../../lib/fechas'


type Gps = { estado: 'buscando' } | { estado: 'ok'; lat: number; lng: number; precision: number } | { estado: 'no'; motivo: string }

/**
 * Reportar una labor desde el campo. La prueba va completa: foto obligatoria,
 * ubicación del celular y —al guardar— la hora del SERVIDOR, no la del aparato.
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
  const [gps, setGps] = useState<Gps>({ estado: 'buscando' })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [listo, setListo] = useState('')
  // La id del reporte se fija al empezar y se mantiene en los reintentos: si la
  // señal se cae a mitad de camino y el reporte sí llegó, reintentar NO lo duplica
  // (la base devuelve el mismo). Se cambia solo cuando el reporte queda guardado.
  const [idReporte, setIdReporte] = useState(() => crypto.randomUUID())
  const [pendientes, setPendientes] = useState<ReportePendiente[]>([])
  const [enviandoCola, setEnviandoCola] = useState(false)

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
  useEffect(() => {
    if (!('geolocation' in navigator)) { setGps({ estado: 'no', motivo: 'este celular no da ubicación' }); return }
    navigator.geolocation.getCurrentPosition(
      (p) => setGps({ estado: 'ok', lat: p.coords.latitude, lng: p.coords.longitude, precision: Math.round(p.coords.accuracy) }),
      (e) => setGps({ estado: 'no', motivo: e.code === 1 ? 'no se dio permiso de ubicación' : 'no se pudo tomar la ubicación' }),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    )
  }, [])
  useEffect(() => () => { if (vista) URL.revokeObjectURL(vista) }, [vista])

  const fincas = d.fincas.filter((f) => f.activa && d.suertes.some((s) => s.fincaId === f.id && cicloAbiertoDe(s.id, d.ciclos)))
  const suertes = d.suertes.filter((s) => s.fincaId === fincaId && s.activa && cicloAbiertoDe(s.id, d.ciclos))
  const ciclo = suerteId ? cicloAbiertoDe(suerteId, d.ciclos) : null
  const labores = ciclo ? d.labores.filter((l) => l.cicloId === ciclo.id && l.estado !== 'ANULADA' && l.estado !== 'TERMINADA') : []
  const labor = labores.find((l) => l.id === laborId)
  const avance = labor ? avanceLabor(labor, d.reportes) : null
  const n = Number(cantidad.replace(',', '.'))
  const misReportes = useMemo(() => d.reportes.filter((r) => r.reportadoPor === usuario).slice(0, 8), [d.reportes, usuario])

  if (!puedeReportar) return <p className="subtle-copy">Su usuario no reporta labores de fincas.</p>

  const problemas = [
    !labor && 'Escoja finca, suerte y labor.',
    labor && !(n > 0) && 'Escriba la cantidad hecha.',
    labor && avance && esHectarea(labor.unidad) && n > avance.restante + 0.001 && `Solo quedan ${fmtCant(avance.restante)} ${labor.unidad} por reportar en esta labor.`,
    ciclo && fecha < ciclo.fechaCorte && `La fecha no puede ser antes del corte (${ciclo.fechaCorte}).`,
    fecha > hoy && 'La fecha no puede ser después de hoy.',
    !foto && 'Tome la foto de la labor: sin foto no hay reporte.',
  ].filter(Boolean) as string[]

  async function enviar() {
    if (problemas.length || !labor || !foto) return
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
      refrescarPendientes(); avisarPendientes()
      if (enviado) await recargar()
    } catch (e) { setError(mensajeDeError(e)) } finally { setGuardando(false) }
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
      <div className="af-card">
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
              if (l) { const a = avanceLabor(l, d.reportes); setCantidad(a.restante > 0 ? String(Math.round(a.restante * 100) / 100) : '') }
            }}>
              <option value="">Escoja…</option>
              {labores.map((l) => { const a = avanceLabor(l, d.reportes); return (
                <option key={l.id} value={l.id}>{l.labor.toLowerCase()} · faltan {fmtCant(a.restante)} {l.unidad}</option>
              ) })}
            </select>
          </label>
          <label>Cantidad hecha {labor ? `(${labor.unidad})` : ''}
            <input id="af-rep-cantidad" inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="0" />
          </label>
          <label>Día en que se hizo
            <input id="af-rep-fecha" type="date" value={fecha} max={hoy} min={ciclo?.fechaCorte} onChange={(e) => setFecha(e.target.value)} />
          </label>
          <label className="af-form__ancho">Foto de la labor (obligatoria)
            <input id="af-rep-foto" type="file" accept="image/*" capture="environment" onChange={(e) => {
              const f = e.target.files?.[0] ?? null
              setFoto(f); setVista(f ? URL.createObjectURL(f) : null)
            }} />
          </label>
          {vista && <img className="af-foto af-foto--grande" src={vista} alt="foto de la labor" />}
          <p className={`af-gps af-gps--${gps.estado}`}>
            {gps.estado === 'buscando' ? '⌖ Tomando la ubicación…'
              : gps.estado === 'ok' ? `⌖ Ubicación tomada (±${gps.precision} m)`
              : `⌖ Sin ubicación: ${gps.motivo}. El reporte sale marcado así.`}
          </p>
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

      {pendientes.length > 0 && (
        <div className="af-card af-card--espera">
          <h3>⏳ Esperando señal ({pendientes.length})</h3>
          <p className="af-nota" style={{ marginTop: 0 }}>
            Están guardados en este celular, con su foto. Salen solos cuando haya cobertura: no los vuelva a registrar.
          </p>
          <ul className="af-lista">
            {pendientes.map((p) => (
              <li key={p.outboxId} className="af-mov">
                <span className="af-foto af-foto--vacia">📷</span>
                <span>
                  <b>{p.etiqueta}</b>
                  <small>
                    hecha el {p.fecha} · guardada {fmtFechaHora(p.queuedAt)}
                    {p.estado === 'error' && p.errorMessage ? ` · no salió: ${mensajeDeError({ message: p.errorMessage })}` : ''}
                  </small>
                </span>
                <span className={`af-chip ${p.estado === 'error' ? 'af-chip--mal' : 'af-chip--ojo'}`}>
                  {p.estado === 'error' ? 'no salió' : 'por enviar'}
                </span>
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
                  <img className="af-foto" src={r.fotoUrl} alt="evidencia" loading="lazy" />
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

