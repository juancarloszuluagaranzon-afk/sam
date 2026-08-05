import { useEffect, useMemo, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { editarDespacho, eliminarDespacho } from '../services/samApi'
import { ultimoHorometro } from '../services/chequeoApi'
import type { SolicitudInsumo } from '../domain/sam'
import { SearchableSelect } from './SearchableSelect'
import { fmtFechaHoraLarga } from '../lib/fechas'
import { fmtCantidad, stepDe, normalizarCantidad } from '../lib/cantidad'

/**
 * Corregir un despacho ya entregado: fecha, máquina, horómetro y cantidades.
 *
 * Existe porque el registro y el hecho no ocurren al mismo tiempo. El supervisor
 * entrega a las 6 de la mañana en el lote y registra a las 4 de la tarde cuando
 * vuelve a tener señal; se equivoca de máquina entre dos que están juntas; anota
 * 20 galones donde eran 25. Sin esto, el reporte queda mal para siempre y la
 * única salida era pedirle a alguien que tocara la base de datos.
 *
 * Lo que se corrige es el hecho, no se le agrega un movimiento encima: ver
 * `editarDespacho` en samApi.
 *
 * El horómetro se valida contra la última lectura buena de ESA máquina, igual
 * que en el chequeo diario. Pesa en el informe semanal, que calcula las horas
 * trabajadas restando el horómetro de una entrega contra el de la siguiente.
 */

/** `datetime-local` necesita `YYYY-MM-DDTHH:mm` en hora local, no un ISO en UTC. */
function aInputLocal(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function EditarDespachoModal({
  entrega,
  onClose,
  onGuardado,
}: {
  entrega: SolicitudInsumo
  onClose: () => void
  onGuardado: () => void
}) {
  const { session, sortedEquipment, insumos, setInsumos, setError, setInfo } = useAppData()

  // Solo los ítems que se pueden apuntar en la BD. `id` e `insumoId` están
  // tipados como opcionales pero siempre llegan; el filtro es para no arrastrar
  // un `undefined` hasta el update.
  const editables = useMemo(
    () => entrega.items.filter((it): it is typeof it & { id: string; insumoId: string } =>
      Boolean(it.id && it.insumoId)),
    [entrega.items],
  )

  const [fecha, setFecha] = useState(aInputLocal(entrega.entregadoEn ?? entrega.createdAt))
  const [equipo, setEquipo] = useState(entrega.equipoCodigo ?? '')
  const [horometro, setHorometro] = useState(
    entrega.horometro == null ? '' : String(entrega.horometro))
  const [ultimoH, setUltimoH] = useState<number | null>(null)
  const [cantidades, setCantidades] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {}
    entrega.items.forEach((it) => {
      if (it.id) m[it.id] = String(it.cantidadDespachada ?? it.cantidad ?? 0)
    })
    return m
  })
  const [guardando, setGuardando] = useState(false)
  // Eliminar va en dos pasos a propósito: borra movimientos de inventario y
  // devuelve stock, así que no puede colgar de un solo toque descuidado.
  const [borrando, setBorrando] = useState(false)
  const [motivoBorrado, setMotivoBorrado] = useState('')

  // La ultima lectura buena de la maquina, para validar contra ella. Se recarga
  // al cambiar de maquina: la referencia es de ESA maquina, no de la anterior.
  useEffect(() => {
    if (!equipo) { setUltimoH(null); return }
    let vivo = true
    void ultimoHorometro(equipo).then((h) => { if (vivo) setUltimoH(h) })
    return () => { vivo = false }
  }, [equipo])

  const opcionesEquipo = useMemo(
    () => sortedEquipment.map((e) => ({ value: e.code, label: e.name })),
    [sortedEquipment],
  )
  const unidadDe = useMemo(() => {
    const m = new Map<string, string>()
    insumos.forEach((i) => m.set(i.id, i.unidad))
    return m
  }, [insumos])

  /**
   * Avisa cuando el número no puede ser cierto PARA UN REGISTRO PASADO.
   *
   * ⚠️ La regla NO es la misma que en el chequeo diario, y confundirlas produce
   * avisos en falso. En el chequeo se teclea la lectura de HOY, así que un valor
   * menor al último es sospechoso. Aquí se corrige una entrega VIEJA, y que su
   * horómetro sea menor al de hoy es lo normal — la máquina siguió andando.
   *
   * Lo que sí es imposible en un registro pasado: que supere la lectura actual
   * de la máquina. Y sigue valiendo el dedazo de magnitud (un dígito de más),
   * que es el otro patrón real. No bloquea: avisa.
   */
  const avisoHorometro = useMemo(() => {
    const h = Number(horometro)
    if (!horometro || !Number.isFinite(h) || ultimoH == null) return ''
    if (h > ultimoH) {
      return `Esta máquina va hoy en ${ultimoH.toLocaleString('es-CO')}. Una entrega pasada no puede tener una lectura mayor.`
    }
    // Un orden de magnitud distinto es el dedazo clásico: sobra o falta un dígito.
    if (h > 0 && Math.floor(Math.log10(h)) !== Math.floor(Math.log10(ultimoH))) {
      return `La máquina va en ${ultimoH.toLocaleString('es-CO')}. ${h.toLocaleString('es-CO')} tiene otra cantidad de dígitos — ¿anotaste las horas trabajadas?`
    }
    return ''
  }, [horometro, ultimoH])

  // Solo se guarda si de verdad cambió algo: una edición vacía dejaría una fila
  // de auditoría que no dice nada.
  const hayCambios = useMemo(() => {
    if (equipo !== (entrega.equipoCodigo ?? '')) return true
    if (fecha !== aInputLocal(entrega.entregadoEn ?? entrega.createdAt)) return true
    if (horometro !== (entrega.horometro == null ? '' : String(entrega.horometro))) return true
    return editables.some((it) => {
      const antes = Number(it.cantidadDespachada ?? it.cantidad ?? 0)
      return normalizarCantidad(Number(cantidades[it.id] ?? 0)) !== antes
    })
  }, [equipo, fecha, horometro, cantidades, entrega, editables])

  async function guardar() {
    if (!fecha) { setError('La fecha no puede quedar vacía.'); return }
    setGuardando(true)
    setError('')
    try {
      const actualizados = await editarDespacho({
        solicitudId: entrega.id,
        entregadoEn: new Date(fecha).toISOString(),
        equipoCodigo: equipo || undefined,
        horometro: horometro === '' ? null : Number(horometro),
        bodegaId: entrega.bodegaId,
        editadoPor: session?.id,
        items: editables.map((it) => ({
          itemId: it.id,
          insumoId: it.insumoId,
          cantidadDespachada: normalizarCantidad(Number(cantidades[it.id] ?? 0)),
        })),
      })
      // El stock cambió: refrescar el catálogo en memoria o los selectores
      // seguirían validando contra un número viejo.
      if (actualizados.length) {
        setInsumos(insumos.map((i) => actualizados.find((a) => a.id === i.id) ?? i))
      }
      setInfo('Despacho corregido. Los reportes ya usan la fecha nueva.')
      onGuardado()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la corrección')
    } finally {
      setGuardando(false)
    }
  }

  async function eliminar() {
    if (!motivoBorrado.trim()) { setError('Escribe por qué se elimina.'); return }
    setGuardando(true)
    setError('')
    try {
      const actualizados = await eliminarDespacho({
        solicitudId: entrega.id,
        motivo: motivoBorrado.trim(),
        eliminadoPor: session?.id,
      })
      if (actualizados.length) {
        setInsumos(insumos.map((i) => actualizados.find((a) => a.id === i.id) ?? i))
      }
      setInfo(entrega.origen === 'DIRECTA'
        ? 'Despacho eliminado. El material volvió al inventario.'
        : 'Despacho eliminado. El material volvió al inventario y la solicitud quedó pendiente de despachar.')
      onGuardado()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar el despacho')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}
           style={{ maxWidth: 'min(520px, calc(100vw - 32px))' }}>
        <div className="labor-detail-header">
          <div>
            <p className="eyebrow">Corregir despacho</p>
            <h3>✏️ {entrega.operarioNombre ?? 'Entrega'}</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Cerrar">&#x2715;</button>
        </div>

        {/* Suelto, no plegado: dentro de un modal el texto es la instrucción del
            momento, no un letrero permanente. */}
        <p className="subtle-copy" style={{ marginTop: 0 }}>
          La fecha en que se <strong>registró</strong> no se toca — queda como auditoría.
          Lo que cambies aquí es la fecha en que <strong>ocurrió</strong>, que es la que
          usan los informes y el cruce de información.
        </p>

        <div className="form-grid">
          <label className="field">
            <span>¿Cuándo se entregó de verdad?</span>
            <input type="datetime-local" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </label>

          <label className="field">
            <span>Máquina</span>
            <SearchableSelect value={equipo} onChange={setEquipo} options={opcionesEquipo}
                              placeholder="Elegir máquina" />
          </label>

          <label className="field">
            <span>
              Horómetro
              {ultimoH != null && (
                <small style={{ marginLeft: 6, opacity: .75 }}>
                  última lectura {ultimoH.toLocaleString('es-CO')}
                </small>
              )}
            </span>
            <input type="number" min={0} step="0.1" inputMode="decimal"
                   value={horometro} onChange={(e) => setHorometro(e.target.value)}
                   placeholder="El número de la máquina" />
          </label>
        </div>

        {avisoHorometro && <p className="chq__aviso">⚠ {avisoHorometro}</p>}

        <p className="ins-res__lbl" style={{ marginTop: 14 }}>Cantidades entregadas</p>
        {editables.map((it) => {
          const unidad = it.unidad || unidadDe.get(it.insumoId) || ''
          const antes = Number(it.cantidadDespachada ?? it.cantidad ?? 0)
          const ahora = Number(cantidades[it.id] ?? 0)
          return (
            <label key={it.id} className="field" style={{ marginBottom: 8 }}>
              <span>
                {it.insumoNombre || 'Insumo'}
                {ahora !== antes && (
                  <small style={{ marginLeft: 6, opacity: .75 }}>
                    antes {fmtCantidad(antes, unidad)} {unidad}
                  </small>
                )}
              </span>
              <input
                type="number" min={0} step={stepDe(unidad)} inputMode="decimal"
                value={cantidades[it.id] ?? ''}
                onChange={(e) => setCantidades({ ...cantidades, [it.id]: e.target.value })}
              />
            </label>
          )
        })}

        <p className="subtle-copy" style={{ fontSize: '.82rem' }}>
          Se registró el {fmtFechaHoraLarga(entrega.createdAt)}. Toda corrección queda
          guardada con tu nombre.
        </p>

        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose} disabled={guardando}>
            Cancelar
          </button>
          <button type="button" className="primary-button" onClick={() => void guardar()}
                  disabled={guardando || !hayCambios}>
            {guardando ? 'Guardando…' : 'Guardar corrección'}
          </button>
        </div>

        {/* Eliminar vive abajo y detrás de un paso más: no es una corrección,
            es deshacer un hecho. Devuelve material al inventario. */}
        <div className="desp-borrar">
          {!borrando ? (
            <button type="button" className="link-danger" onClick={() => setBorrando(true)} disabled={guardando}>
              🗑 Este despacho no debió existir — eliminarlo
            </button>
          ) : (
            <>
              <p className="desp-borrar__aviso">
                Se borran los movimientos de inventario y <strong>el material vuelve
                a tu bodega</strong>. {entrega.origen === 'DIRECTA'
                  ? 'La entrega queda cancelada.'
                  : 'La solicitud vuelve a quedar pendiente de despachar, porque el operario sigue necesitando el material.'}
                {' '}Queda guardado quién lo eliminó y por qué.
              </p>
              <label className="field">
                <span>¿Por qué se elimina?</span>
                <input type="text" value={motivoBorrado} autoFocus
                       placeholder="Ej: se registró en la máquina equivocada"
                       onChange={(e) => setMotivoBorrado(e.target.value)} />
              </label>
              <div className="modal-actions">
                <button type="button" className="secondary-button"
                        onClick={() => { setBorrando(false); setMotivoBorrado('') }} disabled={guardando}>
                  Mejor no
                </button>
                <button type="button" className="danger-button" onClick={() => void eliminar()}
                        disabled={guardando || !motivoBorrado.trim()}>
                  {guardando ? 'Eliminando…' : 'Sí, eliminar'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default EditarDespachoModal
