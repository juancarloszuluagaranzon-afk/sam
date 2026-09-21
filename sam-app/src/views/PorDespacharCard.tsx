import { useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { loadSolicitudes } from '../services/samApi'
import { hoyBogota } from '../lib/periodos'
import { fmtCantidad } from '../lib/cantidad'
import type { SolicitudInsumo } from '../domain/sam'

/**
 * «Por despachar»: las solicitudes de los operarios que todavía no se han
 * entregado, para PLANEAR el despacho del día siguiente.
 *
 * Pedido del cliente (21-sep-2026): «que se vean las solicitudes pendientes por
 * entregar con el fin de poder planificar los despachos… algo gerencial, simple y
 * que no sature la visual». Por eso son dos renglones y una lista plegada:
 *   1. cuántas y PARA CUÁNDO (atrasadas · hoy · mañana · después · sin fecha);
 *   2. QUÉ ALISTAR: el total por material — nunca sumando materiales distintos.
 *
 * 🔴 No sigue el filtro de periodo de la pantalla: es la cola VIVA. Una solicitud
 * de hace una semana que no se ha entregado es justo la que más importa ver, y un
 * filtro de «Hoy» la escondería.
 *
 * Pendiente = PENDIENTE (falta aprobarla) o PROGRAMADA (aprobada, falta
 * despacharla). Se dice cuál es cuál: planear un despacho de algo que nadie ha
 * aprobado es planear en el aire.
 */

type Cuando = 'atrasada' | 'hoy' | 'manana' | 'despues' | 'sinFecha'

const ORDEN: Cuando[] = ['atrasada', 'hoy', 'manana', 'despues', 'sinFecha']
const ROTULO: Record<Cuando, string> = {
  atrasada: 'atrasada', hoy: 'para hoy', manana: 'para mañana', despues: 'después', sinFecha: 'sin fecha',
}

function diaBogota(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })
}
function sumarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
function fmtCuando(iso: string): string {
  const d = new Date(iso)
  const dia = diaBogota(iso).split('-')
  const hora = d.toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return `${Number(dia[2])} ${MESES[Number(dia[1]) - 1]} · ${hora}`
}
function unidadCorta(u: string, n: number): string {
  const x = u.trim().toLowerCase()
  if (x.startsWith('gal')) return 'gal'
  if (x === 'unidad' || x === 'und') return n === 1 ? 'unidad' : 'unidades'
  return u
}

export function PorDespacharCard({ vuelta }: { vuelta: number }) {
  const { users, sortedEquipment } = useAppData()
  const [sols, setSols] = useState<SolicitudInsumo[] | null>(null)
  const [abierta, setAbierta] = useState(false)

  useEffect(() => {
    let vivo = true
    loadSolicitudes({ estados: ['PENDIENTE', 'PROGRAMADA'], limit: 300 })
      .then((s) => { if (vivo) setSols(s) })
      .catch(() => { if (vivo) setSols([]) })
    return () => { vivo = false }
  }, [vuelta])

  const nombre = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users])
  const maquina = useMemo(() => new Map(sortedEquipment.map((e) => [e.code, e.name])), [sortedEquipment])

  const datos = useMemo(() => {
    if (!sols) return null
    const hoy = hoyBogota()
    const manana = sumarDias(hoy, 1)
    const filas = sols.map((s) => {
      const dia = s.requeridoPara ? diaBogota(s.requeridoPara) : null
      const cuando: Cuando = !dia ? 'sinFecha' : dia < hoy ? 'atrasada' : dia === hoy ? 'hoy' : dia === manana ? 'manana' : 'despues'
      const diasDesdePedida = Math.max(0, Math.round((Date.parse(`${hoy}T12:00:00`) - Date.parse(`${diaBogota(s.createdAt)}T12:00:00`)) / 86400000))
      return { s, cuando, diasDesdePedida }
    }).sort((a, b) => ORDEN.indexOf(a.cuando) - ORDEN.indexOf(b.cuando)
      || (a.s.requeridoPara ?? a.s.createdAt).localeCompare(b.s.requeridoPara ?? b.s.createdAt))

    const porCuando = new Map<Cuando, number>()
    for (const f of filas) porCuando.set(f.cuando, (porCuando.get(f.cuando) ?? 0) + 1)

    // Qué alistar: una cuenta POR MATERIAL y unidad. 13 gal + 40 tornillos no es un número.
    const alistar = new Map<string, { material: string; unidad: string; cantidad: number }>()
    for (const { s } of filas) {
      for (const it of s.items) {
        const k = `${it.insumoNombre.trim().toUpperCase()}|${it.unidad}`
        const e = alistar.get(k) ?? { material: it.insumoNombre.trim(), unidad: it.unidad, cantidad: 0 }
        e.cantidad += Number(it.cantidad) || 0
        alistar.set(k, e)
      }
    }
    const porAprobar = sols.filter((s) => s.estado === 'PENDIENTE').length
    return {
      filas, porCuando, porAprobar, aprobadas: sols.length - porAprobar,
      alistar: [...alistar.values()].sort((a, b) => b.cantidad - a.cantidad),
    }
  }, [sols])

  if (!datos) return null

  return (
    <div className="dash-card pdesp">
      <div className="dash-card__head">
        <h3>Por despachar</h3>
        {datos.filas.length > 0 && (
          <button type="button" className="dash-card__link" onClick={() => setAbierta((v) => !v)}>
            {abierta ? 'Ocultar' : `Ver ${datos.filas.length === 1 ? 'la solicitud' : `las ${datos.filas.length}`}`} {abierta ? '↑' : '→'}
          </button>
        )}
      </div>

      {datos.filas.length === 0 ? (
        <p className="pdesp__vacio">✓ No hay solicitudes pendientes por entregar.</p>
      ) : (
        <>
          {/* 1 · Cuántas y para cuándo */}
          <p className="pdesp__linea">
            <strong className="pdesp__n">{datos.filas.length}</strong>
            {' '}solicitud{datos.filas.length === 1 ? '' : 'es'} sin entregar
            {ORDEN.filter((c) => datos.porCuando.get(c)).map((c) => (
              <span key={c} className={`pdesp__chip pdesp__chip--${c}`}>
                {c === 'atrasada' ? '⚠ ' : ''}{datos.porCuando.get(c)} {ROTULO[c]}{c === 'atrasada' && (datos.porCuando.get(c) ?? 0) > 1 ? 's' : ''}
              </span>
            ))}
          </p>
          <p className="pdesp__sub">
            {datos.aprobadas} aprobada{datos.aprobadas === 1 ? '' : 's'} · {datos.porAprobar} por aprobar
            {datos.porAprobar > 0 && ' — sin aprobar no se puede despachar'}
          </p>

          {/* 2 · Qué alistar */}
          <p className="pdesp__alistar">
            <span className="pdesp__lbl">Qué alistar</span>
            {datos.alistar.map((m) => (
              <span key={`${m.material}|${m.unidad}`} className="pdesp__mat">
                <b>{fmtCantidad(m.cantidad, m.unidad)}</b> {unidadCorta(m.unidad, m.cantidad)} · {m.material.toLowerCase()}
              </span>
            ))}
          </p>

          {/* 3 · La lista, plegada: se abre cuando se va a despachar */}
          {abierta && (
            <ul className="pdesp__lista">
              {datos.filas.map(({ s, cuando, diasDesdePedida }) => (
                <li key={s.id} className={cuando === 'atrasada' ? 'es-atrasada' : ''}>
                  <span className="pdesp__cuando">
                    {s.requeridoPara ? fmtCuando(s.requeridoPara)
                      : `pedida ${diasDesdePedida === 0 ? 'hoy' : diasDesdePedida === 1 ? 'ayer' : `hace ${diasDesdePedida} días`}`}
                    {cuando === 'atrasada' && <em> · atrasada</em>}
                  </span>
                  <span className="pdesp__quien">
                    <b>{nombre.get(s.operarioId) ?? s.operarioNombre ?? s.operarioId}</b>
                    {s.equipoCodigo && <> · {maquina.get(s.equipoCodigo) ?? s.equipoCodigo}</>}
                    {s.zona && <> · {s.zona}</>}
                    {s.nota && <small> · {s.nota}</small>}
                  </span>
                  <span className="pdesp__que">
                    {s.items.map((it) => `${fmtCantidad(it.cantidad, it.unidad)} ${unidadCorta(it.unidad, it.cantidad)} ${it.insumoNombre.trim().toLowerCase()}`).join(' · ')}
                  </span>
                  <span className={`pdesp__estado ${s.estado === 'PENDIENTE' ? 'es-porAprobar' : ''}`}>
                    {s.estado === 'PENDIENTE' ? 'por aprobar' : 'aprobada'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
