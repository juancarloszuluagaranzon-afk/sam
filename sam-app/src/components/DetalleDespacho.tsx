import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAppData } from '../context/AppDataContext'
import { loadSolicitudPorId, loadCombustiblePorId } from '../services/samApi'
import type { InsumoKardex, CombustibleExterno, SolicitudInsumo } from '../domain/sam'
import { fmtFechaHoraLarga as fmtFecha, fmtLapso } from '../lib/fechas'
import { fmtCantidad } from '../lib/cantidad'

/**
 * El formulario de una entrega, tal como se llenó.
 *
 * El kardex dice qué salió y de dónde, pero no a quién: el operario, la
 * evidencia, el horómetro y el aval viven en la solicitud. Sin esto la pregunta
 * de siempre —"¿quién recibió esos 40 ganchos y ya lo confirmó?"— no tiene
 * respuesta en pantalla.
 *
 * Vive aquí y no dentro de una pantalla porque se abre desde varias: el reporte
 * de consumo, el detalle de una máquina, el de un insumo y el tablero de
 * Inicio. Escribirlo cuatro veces era garantizar que se desincronizaran.
 *
 * Se le pasa el movimiento de kardex (o el tanqueo) y él resuelve lo demás: si
 * la pantalla que lo abre ya tiene la entrega cargada, se la pasa y se ahorra
 * la consulta; si no, la busca sola.
 */
export function DetalleDespacho({
  mov,
  tq: tqDado,
  entrega: entregaDada,
  onClose,
}: {
  mov?: InsumoKardex
  tq?: CombustibleExterno
  /** La entrega ya resuelta, cuando quien abre el modal la tiene a mano. */
  entrega?: SolicitudInsumo
  onClose: () => void
}) {
  const { insumos, sortedEquipment, users } = useAppData()
  const [entrega, setEntrega] = useState<SolicitudInsumo | undefined>(entregaDada)
  const [tq, setTq] = useState<CombustibleExterno | undefined>(tqDado)
  const [buscando, setBuscando] = useState(false)

  // Un movimiento de kardex apunta con `referencia` a una entrega O a un
  // tanqueo (el abastecimiento en sede sale de la principal, así que sí deja
  // huella). No se sabe cuál hasta preguntar.
  useEffect(() => {
    const ref = mov?.referencia
    if (!ref || entregaDada || tqDado) return
    let vivo = true
    setBuscando(true)
    void (async () => {
      const e = await loadSolicitudPorId(ref)
      if (!vivo) return
      if (e) { setEntrega(e); setBuscando(false); return }
      const t = await loadCombustiblePorId(ref)
      if (!vivo) return
      setTq(t ?? undefined)
      setBuscando(false)
    })()
    return () => { vivo = false }
  }, [mov?.referencia, entregaDada, tqDado])

  const insumoInfo = useMemo(() => {
    const m = new Map<string, { nombre: string; unidad: string }>()
    insumos.forEach((i) => m.set(i.id, { nombre: i.nombre, unidad: i.unidad }))
    return m
  }, [insumos])
  const equipoNombre = useMemo(() => {
    const m = new Map<string, string>()
    sortedEquipment.forEach((e) => m.set(e.code, e.name))
    return m
  }, [sortedEquipment])
  const userName = useMemo(() => {
    const m = new Map<string, string>()
    users.forEach((u) => m.set(u.id, u.name))
    return m
  }, [users])

  const e = entrega
  const insumoIdVer = mov?.insumoId ?? tq?.insumoId ?? ''
  const infoVer = insumoInfo.get(insumoIdVer)
  const equipoVer = mov?.equipoCodigo ?? tq?.equipoCodigo ?? ''
  const fotos = e?.evidenciaUrls ?? (tq?.tirillaUrl ? [tq.tirillaUrl] : [])
  const espera = e?.entregadoEn ? fmtLapso(e.createdAt, e.entregadoEn) : ''

  const Dato = ({ k, v }: { k: string; v: ReactNode }) => (
    <div className="desp-det__fila"><span>{k}</span><strong>{v}</strong></div>
  )

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal-card" onClick={(ev) => ev.stopPropagation()} style={{ maxWidth: 'min(520px, calc(100vw - 32px))' }}>
        <div className="labor-detail-header">
          <div>
            <p className="eyebrow">
              {tq ? (tq.origen === 'SEDE' ? 'Abastecimiento en sede' : 'Tanqueo en estación') : 'Entrega'}
            </p>
            <h3>🚜 {equipoNombre.get(equipoVer) ?? equipoVer}</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Cerrar">&#x2715;</button>
        </div>

        <div className="desp-det">
          {/* Qué se entregó — TODOS los ítems del despacho, no solo el de la
              fila que se tocó. */}
          <p className="ins-res__lbl">Qué se entregó</p>
          {e && e.items.length > 0 ? (
            e.items.map((it, idx) => (
              <Dato key={idx}
                k={it.insumoNombre ?? insumoInfo.get(it.insumoId ?? '')?.nombre ?? 'Insumo'}
                v={`${fmtCantidad(it.cantidadDespachada ?? it.cantidad, it.unidad)} ${it.unidad ?? ''}`} />
            ))
          ) : (
            <Dato k={infoVer?.nombre ?? 'Combustible'}
              v={`${fmtCantidad(mov?.cantidad ?? tq?.galones ?? 0, infoVer?.unidad ?? 'galón')} ${infoVer?.unidad ?? 'galón'}`} />
          )}

          <p className="ins-res__lbl" style={{ marginTop: 12 }}>Quién</p>
          {e ? (
            <>
              <Dato k="Recibió" v={e.operarioNombre ?? userName.get(e.operarioId) ?? e.operarioId} />
              <Dato k="Entregó" v={e.despachadoPor ? (userName.get(e.despachadoPor) ?? e.despachadoPor) : '—'} />
            </>
          ) : tq ? (
            <Dato k="Registró" v={tq.registradoNombre ?? '—'} />
          ) : (
            <Dato k="Registró" v={mov?.creadoPor ? (userName.get(mov.creadoPor) ?? mov.creadoPor) : '—'} />
          )}

          <p className="ins-res__lbl" style={{ marginTop: 12 }}>Cuándo</p>
          {e && <Dato k={e.origen === 'DIRECTA' ? 'Entregado' : 'Lo pidió'} v={fmtFecha(e.createdAt)} />}
          {e?.entregadoEn && e.origen !== 'DIRECTA' && (
            <Dato k="Se lo entregaron" v={
              <>{fmtFecha(e.entregadoEn)}{espera && <> <small>· {espera} de espera</small></>}</>
            } />
          )}
          {!e && <Dato k={tq?.origen === 'SEDE' ? 'Abastecido' : 'Tanqueado'} v={fmtFecha(tq?.createdAt ?? mov?.createdAt ?? '')} />}

          {(e?.horometro != null || tq?.horometro != null) && (
            <>
              <p className="ins-res__lbl" style={{ marginTop: 12 }}>Máquina</p>
              <Dato k="Horómetro" v={e?.horometro ?? tq?.horometro} />
            </>
          )}
          {tq && (
            <>
              {tq.origen === 'SEDE' && <Dato k="Salió de" v="Bodega principal" />}
              {tq.estacion && <Dato k="Estación" v={tq.estacion} />}
              {tq.factura && <Dato k="N° tirilla" v={tq.factura} />}
              {tq.valor != null && tq.valor > 0 && <Dato k="Valor" v={`$${tq.valor.toLocaleString('es-CO')}`} />}
            </>
          )}
          {(e?.nota || tq?.nota) && (
            <>
              <p className="ins-res__lbl" style={{ marginTop: 12 }}>Nota</p>
              <p className="subtle-copy" style={{ margin: 0 }}>{e?.nota ?? tq?.nota}</p>
            </>
          )}

          {/* El aval: sin esto no se sabe si el operario reconoció lo que
              recibió, que es lo que sostiene el cobro. */}
          {e && (
            <>
              <p className="ins-res__lbl" style={{ marginTop: 12 }}>Aval del operario</p>
              {e.confirmadoEn ? (
                <>
                  <Dato k={e.conforme === false ? '⚠️ Reportó diferencia' : '✔ Confirmado'} v={fmtFecha(e.confirmadoEn)} />
                  {e.confirmacionNota && <p className="subtle-copy" style={{ margin: 0 }}>{e.confirmacionNota}</p>}
                </>
              ) : (
                <p className="subtle-copy" style={{ margin: 0 }}>⏳ Todavía no lo ha confirmado.</p>
              )}
            </>
          )}
          {/* El tanqueo a una máquina también lo confirma el operario. */}
          {tq?.operarioNombre && (
            <>
              <p className="ins-res__lbl" style={{ marginTop: 12 }}>Aval del operario</p>
              <Dato k="Recibió" v={tq.operarioNombre} />
              {tq.confirmadoEn ? (
                <>
                  <Dato k={tq.conforme === false ? '⚠️ Reportó un problema' : '✔ Confirmado'} v={fmtFecha(tq.confirmadoEn)} />
                  {tq.confirmacionNota && <p className="subtle-copy" style={{ margin: 0 }}>{tq.confirmacionNota}</p>}
                </>
              ) : (
                <p className="subtle-copy" style={{ margin: 0 }}>⏳ Todavía no lo ha confirmado.</p>
              )}
            </>
          )}
          {tq && (
            <>
              <p className="ins-res__lbl" style={{ marginTop: 12 }}>Aval del analista</p>
              <p className="subtle-copy" style={{ margin: 0 }}>
                {tq.estado === 'PENDIENTE' ? '⏳ Pendiente de aval.'
                  : tq.estado === 'RECHAZADO' ? '✖ Rechazado.'
                  : `✔ Avalado${tq.revisadoNombre ? ` por ${tq.revisadoNombre}` : ''}${tq.revisadoEn ? ` · ${fmtFecha(tq.revisadoEn)}` : ''}`}
              </p>
            </>
          )}

          {buscando && !e && !tq && <p className="muted-text" style={{ margin: '10px 0 0' }}>Buscando el detalle…</p>}

          {fotos.length > 0 && (
            <>
              <p className="ins-res__lbl" style={{ marginTop: 12 }}>Evidencia</p>
              <div className="desp-det__fotos">
                {fotos.map((u, i) => (
                  <a key={i} href={u} target="_blank" rel="noreferrer">
                    <img src={u} alt={`evidencia ${i + 1}`} className="flota-foto-thumb" />
                  </a>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default DetalleDespacho
