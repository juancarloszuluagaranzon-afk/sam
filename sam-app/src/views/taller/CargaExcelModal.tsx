import { useMemo, useRef, useState } from 'react'
import type { Insumo } from '../../domain/sam'
import {
  analizarFilas, descargarNoPasaron, descargarPlantillaPiezas, leerArchivoPiezas,
  type Analisis,
} from '../../lib/cargaPiezas'
import { importarPiezas, type NuevaPieza } from '../../services/piezasApi'
import { nuevoId } from './NuevaPiezaModal'
import './piezas.css'

/**
 * Carga de piezas del taller desde Excel (26-oct-2026).
 *
 * El almacén tiene más de 500 piezas y las van a cargar varias personas: teclearlas una por
 * una en el celular es la forma de que queden a medias. Aquí se sube el Excel, se revisa qué
 * quedó listo y qué se parece a algo que ya existe, y se guarda por tandas.
 *
 * Tres pasos y nada más: ARCHIVO → REVISAR → LISTO. Antes de guardar, cada fila se analiza
 * contra el catálogo: una fila parecida o con error NO se crea — se deja afuera y se puede
 * bajar a un Excel para corregirla. Las fotos no vienen en el Excel: se toman después, pieza
 * por pieza, desde el celular.
 *
 * 🔴 Guardar es IDEMPOTENTE: cada pieza trae su uuid desde el análisis (`nuevoId`), así que
 * reintentar después de un corte de señal NO crea gemelas. Por eso el arreglo de piezas se
 * arma una sola vez (`useMemo`) y se reutiliza tal cual en el reintento.
 */

interface Props {
  /** Bodega del taller donde queda la existencia de todas las piezas. */
  bodegaId: string
  /** Quién hace la carga. Va a `creadoPor` de cada pieza. */
  usuarioId?: string
  /** Catálogo actual: contra esto se detectan las parecidas. */
  existentes: Insumo[]
  onClose: () => void
  /** Se llama UNA sola vez al terminar la carga, para que la lista de atrás se recargue. */
  onTerminada: () => void
}

type Paso = 1 | 2 | 3

export function CargaExcelModal({ bodegaId, usuarioId, existentes, onClose, onTerminada }: Props) {
  const [paso, setPaso] = useState<Paso>(1)
  const [leyendo, setLeyendo] = useState(false)
  const [bajandoPlantilla, setBajandoPlantilla] = useState(false)
  const [error, setError] = useState('')
  const [analisis, setAnalisis] = useState<Analisis | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [progreso, setProgreso] = useState<{ hechas: number; total: number } | null>(null)
  const [resultado, setResultado] = useState<{ creadas: number; yaExistian: number } | null>(null)
  const inputArchivo = useRef<HTMLInputElement>(null)
  // `onTerminada` se llama UNA sola vez: la lista de atrás no necesita recargarse dos veces.
  const terminada = useRef(false)
  // Un doble toque en el celular dispara dos veces el mismo clic antes de que la pantalla se
  // vuelva a dibujar; este candado (que cambia al instante, sin esperar el dibujo) lo corta.
  const enMarcha = useRef(false)

  /**
   * Las piezas que de verdad se van a guardar. Se arman UNA vez por análisis y se reutilizan
   * tal cual si hay que reintentar: los ids ya están puestos y no se regeneran.
   */
  const piezasListas = useMemo<NuevaPieza[]>(() => {
    if (!analisis) return []
    const salida: NuevaPieza[] = []
    for (const f of analisis.filas) {
      if (f.estado === 'lista' && f.pieza) {
        salida.push({ ...f.pieza, bodegaId, creadoPor: usuarioId })
      }
    }
    return salida
  }, [analisis, bodegaId, usuarioId])

  /** Las que no se guardan: parecidas y con error. Son las que se pueden bajar y corregir. */
  const noListas = useMemo(
    () => (analisis ? analisis.filas.filter((f) => f.estado !== 'lista') : []),
    [analisis],
  )

  const totalNoPasan = analisis ? analisis.parecidas + analisis.errores : 0
  const pct = progreso && progreso.total > 0
    ? Math.min(100, Math.round((progreso.hechas / progreso.total) * 100))
    : 0

  async function elegirArchivo(file: File) {
    setError('')
    setLeyendo(true)
    try {
      const { filas, faltan } = await leerArchivoPiezas(file)
      if (faltan.length > 0) {
        setError(`Al archivo le faltan las columnas: ${faltan.join(', ')}.`)
        return
      }
      if (filas.length === 0) {
        setError('El archivo no tiene filas con datos.')
        return
      }
      const a = analizarFilas(filas, existentes, nuevoId)
      if (a.filas.length === 0) {
        setError('El archivo no tiene filas con datos.')
        return
      }
      setAnalisis(a)
      setResultado(null)
      setProgreso(null)
      setPaso(2)
    } catch (err) {
      setError((err as { message?: string })?.message || 'No se pudo leer el archivo.')
    } finally { setLeyendo(false) }
  }

  async function bajarPlantilla() {
    setError('')
    setBajandoPlantilla(true)
    try {
      await descargarPlantillaPiezas()
    } catch (err) {
      setError((err as { message?: string })?.message || 'No se pudo bajar la plantilla.')
    } finally { setBajandoPlantilla(false) }
  }

  async function bajarNoPasaron() {
    if (!analisis) return
    setError('')
    try {
      await descargarNoPasaron(analisis)
    } catch (err) {
      setError((err as { message?: string })?.message || 'No se pudo bajar el archivo.')
    }
  }

  async function guardar() {
    if (enMarcha.current || guardando || piezasListas.length === 0) return
    enMarcha.current = true
    setError('')
    setGuardando(true)
    setProgreso({ hechas: 0, total: piezasListas.length })
    try {
      const r = await importarPiezas(piezasListas, (p) => setProgreso(p))
      setResultado(r)
      if (!terminada.current) { terminada.current = true; onTerminada() }
      setPaso(3)
    } catch (err) {
      // `hechas` dice cuántas quedaron guardadas antes del corte. Con ese número la persona
      // sabe que el trabajo no se perdió y que volver a pulsar Guardar no repite nada.
      const hechas = Number((err as { hechas?: number })?.hechas) || 0
      setError(
        `Se guardaron ${hechas} de ${piezasListas.length} antes del error. ` +
        'Vuelve a pulsar Guardar: lo ya guardado no se repite.',
      )
    } finally { enMarcha.current = false; setGuardando(false) }
  }

  return (
    <div className="modal-overlay open" onClick={() => { if (!guardando) onClose() }}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 'min(560px, calc(100vw - 32px))' }}>
        <div className="labor-detail-header">
          <div>
            <p className="eyebrow">Taller</p>
            <h3>Cargar piezas desde Excel</h3>
          </div>
          {/* Mientras guarda no se cierra: a medias, la pantalla mentiría sobre lo que quedó. */}
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={guardando}>
            &#x2715;
          </button>
        </div>

        <p className="carga-pasos" aria-label={`Paso ${paso} de 3`}>
          <span className={paso === 1 ? 'carga-pasos__on' : ''} aria-current={paso === 1 ? 'step' : undefined}>1 Archivo</span>
          <span className="carga-pasos__sep" aria-hidden="true">·</span>
          <span className={paso === 2 ? 'carga-pasos__on' : ''} aria-current={paso === 2 ? 'step' : undefined}>2 Revisar</span>
          <span className="carga-pasos__sep" aria-hidden="true">·</span>
          <span className={paso === 3 ? 'carga-pasos__on' : ''} aria-current={paso === 3 ? 'step' : undefined}>3 Listo</span>
        </p>

        {/* ── PASO 1 · Archivo ────────────────────────────────────────────── */}
        {paso === 1 && (
          <>
            <p className="subtle-copy" style={{ margin: 0 }}>
              Baja la plantilla, llénala con lo que hay en el almacén y súbela. Las fotos se toman
              después, pieza por pieza, desde el celular.
            </p>
            <button type="button" className="inline-button carga-boton"
              onClick={() => void bajarPlantilla()} disabled={leyendo || bajandoPlantilla}>
              {bajandoPlantilla ? 'Bajando la plantilla…' : 'Bajar la plantilla de Excel'}
            </button>
            <button type="button" className="primary-button"
              onClick={() => inputArchivo.current?.click()} disabled={leyendo}>
              {leyendo ? 'Leyendo el archivo…' : 'Subir el archivo lleno'}
            </button>
            <input ref={inputArchivo} type="file" accept=".xlsx,.xls,.csv" hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                // Se limpia para poder subir OTRA VEZ el mismo archivo ya corregido.
                e.target.value = ''
                if (file) void elegirArchivo(file)
              }} />
            {error && <p className="pieza-error">{error}</p>}
            <p className="carga-nota">
              Columnas: nombre, estante y cantidad (obligatorias) · familia, marca, N° de parte,
              referencia y mínimo (opcionales).
            </p>
          </>
        )}

        {/* ── PASO 2 · Revisar ────────────────────────────────────────────── */}
        {paso === 2 && analisis && (
          <>
            <div className="carga-cuentas">
              <div className="carga-cuenta carga-cuenta--lista">
                <span className="carga-cuenta__n">{analisis.listas}</span>
                <span className="carga-cuenta__lbl">Listas</span>
              </div>
              <div className="carga-cuenta carga-cuenta--parecida">
                <span className="carga-cuenta__n">{analisis.parecidas}</span>
                <span className="carga-cuenta__lbl">Parecidas</span>
              </div>
              <div className="carga-cuenta carga-cuenta--error">
                <span className="carga-cuenta__n">{analisis.errores}</span>
                <span className="carga-cuenta__lbl">Con error</span>
              </div>
            </div>

            {noListas.length === 0 ? (
              <p className="carga-todo-bien">
                Las {analisis.listas} {analisis.listas === 1 ? 'fila está lista' : 'filas están listas'}:
                no hay parecidas ni errores.
              </p>
            ) : (
              <>
                <div className="carga-filas">
                  {noListas.slice(0, 100).map((f) => (
                    <div key={f.fila} className="carga-fila">
                      <div className="carga-fila__main">
                        <strong>Fila {f.fila} · {f.original.nombre || '(sin nombre)'}</strong>
                        {f.motivo && <span className="carga-fila__motivo">{f.motivo}</span>}
                      </div>
                      <span className={`carga-etq ${f.estado === 'parecida' ? 'carga-etq--parecida' : 'carga-etq--error'}`}>
                        {f.estado === 'parecida' ? 'Parecida: se omite' : 'Error: corrígela en el Excel'}
                      </span>
                    </div>
                  ))}
                </div>
                {noListas.length > 100 && (
                  <p className="carga-nota">
                    Mostrando 100 de {noListas.length}. Baja el Excel para verlas todas.
                  </p>
                )}
              </>
            )}

            {error && <p className="pieza-error">{error}</p>}

            <div className="modal-footer carga-pie">
              {guardando && progreso ? (
                // Todo lo demás queda deshabilitado y el modal no se cierra: el número que se ve
                // es lo que de verdad se ha guardado.
                <div className="carga-progreso-caja">
                  <div className="carga-progreso" role="progressbar"
                    aria-valuemin={0} aria-valuemax={progreso.total} aria-valuenow={progreso.hechas}>
                    <div className="carga-progreso__barra" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="carga-progreso__txt">Guardando… {progreso.hechas} de {progreso.total}</p>
                </div>
              ) : (
                <>
                  {/* Dos columnas SOLO cuando hay dos botones: con uno solo, a lo ancho. */}
                  <div className={`carga-acciones${analisis.listas > 0 && totalNoPasan > 0 ? ' carga-acciones--dos' : ''}`}>
                    {analisis.listas === 0 ? (
                      <p className="carga-nota">
                        No hay piezas listas para guardar. Corrige el Excel y súbelo otra vez.
                      </p>
                    ) : (
                      <button type="button" className="primary-button" onClick={() => void guardar()}>
                        Guardar las {analisis.listas} listas
                      </button>
                    )}
                    {totalNoPasan > 0 && (
                      <button type="button" className="inline-button" onClick={() => void bajarNoPasaron()}>
                        Bajar las {totalNoPasan} que no pasaron
                      </button>
                    )}
                  </div>
                  <button type="button" className="carga-enlace"
                    onClick={() => { setPaso(1); setAnalisis(null); setError('') }}>
                    Elegir otro archivo
                  </button>
                  <p className="carga-nota">
                    Se guarda por tandas de 50; si se corta la señal, lo ya guardado no se repite.
                  </p>
                </>
              )}
            </div>
          </>
        )}

        {/* ── PASO 3 · Listo ──────────────────────────────────────────────── */}
        {paso === 3 && resultado && analisis && (
          <>
            <p className="carga-listo">
              Se guardaron {resultado.creadas} {resultado.creadas === 1 ? 'pieza' : 'piezas'}
            </p>
            {resultado.yaExistian > 0 && (
              <p className="carga-nota">
                {resultado.yaExistian} {resultado.yaExistian === 1 ? 'ya estaba guardada' : 'ya estaban guardadas'}
              </p>
            )}
            {totalNoPasan > 0 && (
              <div className="carga-pendientes">
                <p className="carga-nota" style={{ margin: 0 }}>Faltan {totalNoPasan} por corregir</p>
                <button type="button" className="inline-button" onClick={() => void bajarNoPasaron()}>
                  Bajar las que no pasaron
                </button>
              </div>
            )}
            {error && <p className="pieza-error">{error}</p>}
            <div className="modal-footer carga-pie">
              <button type="button" className="primary-button" onClick={onClose}>Cerrar</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default CargaExcelModal
