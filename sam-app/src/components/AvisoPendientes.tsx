import { useCallback, useEffect, useState } from 'react'
import { db } from '../lib/db'
import { useAppData } from '../context/AppDataContext'
import { OP_LABEL, resumenOperacion, type InsumoOpKind } from '../lib/outboxInsumos'
import { fmtFechaHora } from '../lib/fechas'

/**
 * Aviso de lo que se registró sin señal y todavía no ha subido.
 *
 * Sin esto el supervisor no tiene forma de saber que le quedan cosas por
 * enviar: la pantalla se ve igual con la cola vacía que con diez despachos
 * dentro. Y el problema que reportó fue justamente ese — creía que los
 * registros se perdían.
 *
 * Se muestra solo cuando hay algo pendiente; con la cola vacía no ocupa
 * espacio ni genera ruido.
 *
 * 🔴 **Y tiene que dejar SALIR de ahí.** Hasta el 3-sep-2026 era de solo
 * lectura: decía «Entrega directa · TypeError: Failed to fetch» y nada más.
 * Genaro tuvo tres registros atascados ocho días (26, 27 y 28 de agosto) sin
 * poder ver a qué máquina eran ni cuántos galones, o sea sin poder volverlos a
 * registrar a mano. La frase «nada de esto se pierde» era cierta en el sentido
 * literal —el dato seguía en el equipo— y falsa en el único que importa: no
 * había forma de sacarlo. Ahora se ve el contenido, se puede reintentar, y se
 * puede quitar el que ya se registró por otro lado.
 */
export function AvisoPendientes() {
  const { isOnline, outboxCount, syncOutbox, setInfo, setError } = useAppData()
  const [items, setItems] = useState<{
    id: number; kind: string; cuando: string; error?: string; resumen: string
  }[]>([])
  const [abierto, setAbierto] = useState(false)
  const [reintentando, setReintentando] = useState(false)
  const [porQuitar, setPorQuitar] = useState<number | null>(null)

  const revisar = useCallback(async () => {
    const todos = await db.outbox.where('status').anyOf(['pending', 'error']).toArray()
    setItems(
      todos
        .filter((i) => i.type === 'INSUMO')
        .map((i) => ({
          id: i.id!,
          kind: i.insumoOp?.kind ?? '',
          cuando: i.queuedAt,
          error: i.status === 'error' ? i.errorMessage : undefined,
          resumen: resumenOperacion(i.insumoOp?.kind as InsumoOpKind, i.insumoOp?.payload),
        }))
        .sort((a, b) => a.cuando.localeCompare(b.cuando)),
    )
  }, [])

  // `outboxCount` cambia al sincronizar; revisar de nuevo mantiene el detalle
  // al día sin necesidad de sondear.
  useEffect(() => { void revisar() }, [revisar, outboxCount, isOnline])

  async function reintentar() {
    setReintentando(true)
    setError('')
    try {
      await syncOutbox()
      await revisar()
    } catch {
      setError('No se pudo enviar. Revisa la señal e intenta otra vez.')
    } finally {
      setReintentando(false)
    }
  }

  /**
   * Quitar de la cola algo que YA quedó registrado por otro camino.
   *
   * ⚠️ Es lo único de esta pantalla que destruye un dato, así que pide un
   * segundo toque y dice exactamente qué se pierde. Sin esta salida, un
   * registro que el servidor sí recibió pero cuya respuesta no llegó se queda
   * en la cola para siempre — y el día que suba, duplica.
   */
  async function quitar(id: number) {
    try {
      await db.outbox.delete(id)
      await revisar()
      setInfo('Quitado de la cola. Verifica que sí esté en Reportes.')
    } catch {
      setError('No se pudo quitar.')
    } finally {
      setPorQuitar(null)
    }
  }

  // Sin señal se avisa aunque no haya nada en cola: el supervisor tiene que
  // saber que lo que ve —stock, catálogo, solicitudes— es de la última vez que
  // hubo cobertura, no de este momento.
  if (items.length === 0 && isOnline) return null

  if (items.length === 0) {
    return (
      <div className="pend-aviso pend-aviso--offline">
        <div className="pend-aviso__head" style={{ cursor: 'default' }}>
          <span className="pend-aviso__icono" aria-hidden>⏸</span>
          <span className="pend-aviso__txt">
            <strong>Sin señal</strong>
            <small>Puedes seguir trabajando: lo que registres se envía solo cuando vuelva.</small>
          </span>
        </div>
      </div>
    )
  }

  const conError = items.filter((i) => i.error)

  return (
    <div className={`pend-aviso${conError.length ? ' pend-aviso--error' : !isOnline ? ' pend-aviso--offline' : ''}`}>
      <button type="button" className="pend-aviso__head" onClick={() => setAbierto(!abierto)} aria-expanded={abierto}>
        <span className="pend-aviso__icono" aria-hidden>{isOnline ? '↑' : '⏸'}</span>
        <span className="pend-aviso__txt">
          <strong>
            {items.length} registro{items.length === 1 ? '' : 's'} sin enviar
          </strong>
          <small>
            {conError.length > 0
              ? `${conError.length} necesita${conError.length === 1 ? '' : 'n'} revisión · toca para ver`
              : isOnline
                ? 'Enviando…'
                : 'Se envían solos cuando haya señal'}
          </small>
        </span>
        <span className="pend-aviso__chevron" aria-hidden>{abierto ? '▴' : '▾'}</span>
      </button>

      {abierto && (
        <div className="pend-aviso__lista">
          {items.map((i) => (
            <div key={i.id} className="pend-aviso__row">
              <span>
                {OP_LABEL[i.kind as InsumoOpKind] ?? i.kind}
                {/* Lo que de verdad sirve: a qué máquina y cuánto. Con esto se
                    puede volver a registrar a mano sin adivinar. */}
                {i.resumen && <b className="pend-aviso__que">{i.resumen}</b>}
                <small>{fmtFechaHora(i.cuando)}</small>
              </span>
              {i.error && <span className="pend-aviso__err">{i.error}</span>}

              {porQuitar === i.id ? (
                <span className="pend-aviso__confirmar">
                  <b>¿Ya quedó registrado?</b>
                  <span>Se borra del equipo y no se vuelve a intentar.</span>
                  <span className="pend-aviso__botones">
                    <button type="button" className="danger-button" onClick={() => void quitar(i.id)}>
                      Sí, quitarlo
                    </button>
                    <button type="button" className="inline-button" onClick={() => setPorQuitar(null)}>
                      Cancelar
                    </button>
                  </span>
                </span>
              ) : (
                <button type="button" className="pend-aviso__quitar" onClick={() => setPorQuitar(i.id)}>
                  Ya lo registré a mano · quitar
                </button>
              )}
            </div>
          ))}

          <div className="pend-aviso__botones">
            <button type="button" className="primary-button" onClick={() => void reintentar()}
                    disabled={reintentando || !isOnline}>
              {reintentando ? 'Enviando…' : '↻ Reintentar ahora'}
            </button>
          </div>

          <p className="pend-aviso__pie">
            {isOnline
              ? 'Si uno lleva días fallando, anota lo que dice arriba, regístralo a mano y quítalo.'
              : 'Nada de esto se pierde: queda guardado en el equipo hasta que suba.'}
          </p>
        </div>
      )}
    </div>
  )
}

export default AvisoPendientes
