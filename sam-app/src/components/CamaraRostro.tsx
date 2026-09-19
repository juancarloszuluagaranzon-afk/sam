import { useEffect, useRef, useState } from 'react'
import {
  cargarMotor, leerCara, cuadroBueno, PruebaVida, fotoMini, esRepetida, problemaMuestras,
  MUESTRAS_ENROLAMIENTO,
} from '../lib/rostro'

export interface ResultadoCamara {
  /** Una muestra al marcar; cinco al registrar la cara. */
  descriptores: number[][]
  foto: string | null
  /** 'parpadeo,giro' si pasó la prueba de vida. */
  pruebas: string
}

/**
 * La cámara frontal, con la prueba de vida y la toma de la cara.
 *
 * 🔴 Guía con UNA instrucción a la vez («parpadea», «gira la cabeza», «quédate
 * quieto») y toma la foto sola: nada de botón de disparar. Quien marca a las
 * seis de la mañana no tiene que encuadrar nada.
 *
 * 🔴 Nunca deja a la persona sin salida. A los 45 s sin lograrlo ofrece
 * reintentar o —al marcar— dejar la marcación para que la revise el jefe.
 *
 * ⚠️ `playsInline` + `muted`: sin eso Safari de iPhone abre el video en pantalla
 * completa o no lo reproduce. Y la cámara se APAGA al cerrar (se detienen los
 * tracks), o el celular sigue con la luz de la cámara prendida.
 */
export function CamaraRostro({
  modo, onListo, onCancelar, onSinCara,
}: {
  modo: 'registrar' | 'marcar'
  onListo: (r: ResultadoCamara) => void
  onCancelar: () => void
  /** Solo al marcar: dejarla para revisión sin cara reconocida (con la foto del momento). */
  onSinCara?: (foto: string | null) => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [texto, setTexto] = useState('Preparando la cámara…')
  const [detalle, setDetalle] = useState('La primera vez descarga el reconocedor (7 MB). Después abre al instante.')
  const [progreso, setProgreso] = useState(0)
  const [atascado, setAtascado] = useState(false)
  const [error, setError] = useState('')
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    let vivo = true
    let stream: MediaStream | null = null
    let reloj: number | undefined
    const vida = new PruebaVida()
    const muestras: number[][] = []
    let foto: string | null = null
    let ultimaMuestra = 0
    const inicio = Date.now()
    setAtascado(false); setError(''); setProgreso(0)

    const detener = () => {
      if (reloj) window.clearTimeout(reloj)
      stream?.getTracks().forEach((t) => t.stop())
    }

    async function arrancar() {
      try {
        const [s] = await Promise.all([
          navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false,
          }),
          cargarMotor(),
        ])
        stream = s
        if (!vivo || !video.current) { detener(); return }
        video.current.srcObject = s
        await video.current.play().catch(() => undefined)
        setDetalle('')
        bucle()
      } catch (e) {
        const n = (e as { name?: string })?.name
        setError(n === 'NotAllowedError'
          ? 'La app no tiene permiso de usar la cámara. Actívalo en los permisos del navegador y vuelve a intentar. Si abriste el enlace desde WhatsApp, ábrelo en Chrome.'
          : n === 'NotFoundError'
            ? 'Este teléfono no tiene cámara frontal disponible.'
            : `No se pudo abrir la cámara o cargar el reconocedor (${(e as Error)?.message ?? n ?? 'error'}). Revisa la señal y reintenta.`)
      }
    }

    async function bucle() {
      if (!vivo || !video.current) return
      try {
        if (Date.now() - inicio > 45_000) { setAtascado(true); return }
        const v = video.current
        if (!vida.completa) {
          const l = await leerCara(v)
          vida.actualizar(l)
          const malo = l.caras !== 1 ? cuadroBueno(l) : null
          setTexto(malo ?? vida.instruccion())
          setProgreso(vida.parpadeo ? (vida.giro ? 0.5 : 0.25) : 0)
        } else {
          const l = await leerCara(v, true)
          const malo = cuadroBueno(l)
          if (malo || !l.descriptor) {
            setTexto(malo ?? 'Quédate quieto, mirando de frente.')
          } else if (modo === 'marcar') {
            onListo({ descriptores: [l.descriptor], foto: fotoMini(v, l.caja), pruebas: vida.pruebas })
            detener(); return
          // Una muestra cada ~0,7 s (AgroControl): la persona alcanza a mover un
          // poco la cara y las cinco no salen idénticas — el servidor las rechaza.
          } else if (Date.now() - ultimaMuestra > 700 && !esRepetida(l.descriptor, muestras)) {
            muestras.push(l.descriptor)
            ultimaMuestra = Date.now()
            if (!foto) foto = fotoMini(v, l.caja)
            setProgreso(0.5 + (0.5 * muestras.length) / MUESTRAS_ENROLAMIENTO)
            setTexto(`Muy bien, quédate quieto… ${muestras.length} de ${MUESTRAS_ENROLAMIENTO}`)
            if (muestras.length >= MUESTRAS_ENROLAMIENTO) {
              const p = problemaMuestras(muestras)
              if (p) { setError(p); detener(); return }
              onListo({ descriptores: muestras, foto, pruebas: vida.pruebas })
              detener(); return
            }
          }
        }
      } catch {
        // Un cuadro que falla no es un error: se intenta el siguiente.
      }
      reloj = window.setTimeout(() => void bucle(), 150)
    }

    void arrancar()
    return () => { vivo = false; detener() }
    // `intento` reinicia todo: cámara, prueba de vida y muestras.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intento, modo])

  return (
    <div className="modal-overlay open">
      <div className="modal-card rostro-camara">
        <div className="labor-detail-header">
          <div>
            <p className="eyebrow">{modo === 'registrar' ? 'Registrar mi cara' : 'Marcar con la cara'}</p>
            <h3>{error ? 'No se pudo' : atascado ? 'No lo logramos' : texto}</h3>
          </div>
          <button type="button" className="modal-close-btn" onClick={onCancelar} aria-label="Cerrar">✕</button>
        </div>

        <div className="rostro-camara__marco">
          <video ref={video} playsInline muted autoPlay className="rostro-camara__video" />
          <div className="rostro-camara__guia" aria-hidden="true" />
        </div>
        <div className="rostro-camara__barra" aria-hidden="true">
          <span style={{ width: `${Math.round(progreso * 100)}%` }} />
        </div>
        {detalle && !error && <p className="subtle-copy">{detalle}</p>}
        {error && <p className="mov-alerta">{error}</p>}

        {(atascado || error) && (
          <div className="rostro-camara__acciones">
            <button type="button" className="primary-button" onClick={() => setIntento((n) => n + 1)}>Intentar de nuevo</button>
            {modo === 'marcar' && onSinCara && (
              <button type="button" className="inline-button" onClick={() => onSinCara(video.current ? fotoMini(video.current) : null)}>
                Marcar igual — que lo revise el jefe
              </button>
            )}
          </div>
        )}
        {atascado && (
          <p className="subtle-copy">
            Consejos: busca luz de frente (no a contraluz), quítate la gorra o las gafas oscuras, y sostén el
            teléfono a la altura de la cara.
          </p>
        )}
      </div>
    </div>
  )
}
