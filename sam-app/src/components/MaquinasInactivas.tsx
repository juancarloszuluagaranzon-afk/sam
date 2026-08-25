import { useCallback, useEffect, useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { loadEquipmentTodos, setEquipmentActivo, loadEquipment } from '../services/samApi'

/**
 * Las máquinas apagadas, con su botón para volver a prenderlas.
 *
 * **Por qué existe.** `loadEquipment` —el que alimenta todos los selectores de
 * la app— filtra por `activo = true`. Sin esta lista, desactivar una máquina
 * sería un viaje sin vuelta: desaparece del listado y no queda desde dónde
 * reactivarla, salvo entrando a la base de datos.
 *
 * Se carga sola y solo cuando hay alguna; si están todas activas no ocupa
 * espacio en pantalla.
 */
export function MaquinasInactivas({ recargarKey = 0 }: { recargarKey?: number }) {
  const { busy, setBusy, setError, setInfo, setEquipment } = useAppData()
  const [apagadas, setApagadas] = useState<Array<{ code: string; name: string }>>([])

  const cargar = useCallback(async () => {
    const todas = await loadEquipmentTodos()
    setApagadas(todas.filter((e) => !e.active).map((e) => ({ code: e.code, name: e.name })))
  }, [])

  useEffect(() => { void cargar() }, [cargar, recargarKey])

  async function activar(codigo: string, nombre: string) {
    setBusy(true); setError('')
    try {
      await setEquipmentActivo(codigo, true)
      setInfo(`${nombre} volvió a estar disponible.`)
      const refrescado = await loadEquipment()
      setEquipment(refrescado.data)
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo activar la máquina.')
    } finally { setBusy(false) }
  }

  if (apagadas.length === 0) return null

  return (
    <div className="maquinas-apagadas">
      <h4>
        Desactivadas ({apagadas.length})
        <span className="field-optional"> · no aparecen en los selectores, pero conservan su historial</span>
      </h4>
      <div className="maquinas-apagadas__lista">
        {apagadas.map((m) => (
          <div key={m.code} className="maquinas-apagadas__item">
            <div>
              <strong>{m.name}</strong>
              <span className="field-optional"> {m.code}</span>
            </div>
            <button type="button" className="inline-button" disabled={busy}
                    onClick={() => void activar(m.code, m.name)}>
              Activar
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default MaquinasInactivas
