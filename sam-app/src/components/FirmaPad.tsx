import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

/**
 * Pad de FIRMA manuscrita (comprobante). Se firma con el dedo o stylus sobre un
 * canvas. Sin librerías externas (Pointer Events nativos). Exporta la firma como
 * un JPEG pequeño (~5–20 KB) sobre fondo blanco, para no pesar en el servidor.
 *
 * Uso:
 *   const firmaRef = useRef<FirmaPadHandle>(null)
 *   <FirmaPad ref={firmaRef} onCambio={setHayFirma} />
 *   const file = await firmaRef.current?.exportar()  // File .jpg o null si vacía
 */
export interface FirmaPadHandle {
  /** Devuelve la firma como File JPEG liviano, o null si está vacía. */
  exportar: () => Promise<File | null>
  limpiar: () => void
  estaVacia: () => boolean
}

interface Props {
  /** Avisa cuando cambia si hay o no firma (para habilitar el botón Guardar). */
  onCambio?: (hayFirma: boolean) => void
  /** Alto del área de firma en px (default 180). */
  alto?: number
  disabled?: boolean
}

export const FirmaPad = forwardRef<FirmaPadHandle, Props>(function FirmaPad(
  { onCambio, alto = 180, disabled = false },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dibujando = useRef(false)
  const ultimo = useRef<{ x: number; y: number } | null>(null)
  const [vacia, setVacia] = useState(true)

  // Prepara el canvas a la resolución real del dispositivo (nítido en móvil).
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const ancho = canvas.clientWidth
    canvas.width = Math.round(ancho * dpr)
    canvas.height = Math.round(alto * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, ancho, alto)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#111111'
  }, [alto])

  function posicion(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return
    e.preventDefault()
    canvasRef.current?.setPointerCapture(e.pointerId)
    dibujando.current = true
    ultimo.current = posicion(e)
  }

  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dibujando.current || disabled) return
    e.preventDefault()
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx || !ultimo.current) return
    const p = posicion(e)
    ctx.beginPath()
    ctx.moveTo(ultimo.current.x, ultimo.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    ultimo.current = p
    if (vacia) { setVacia(false); onCambio?.(true) }
  }

  function onUp(e: React.PointerEvent<HTMLCanvasElement>) {
    dibujando.current = false
    ultimo.current = null
    try { canvasRef.current?.releasePointerCapture(e.pointerId) } catch { /* ok */ }
  }

  /**
   * 🔴 La escala se FIJA, no se acumula.
   *
   * Antes esto hacía `save()` → `setTransform(identidad)` → `restore()` →
   * `scale(dpr)`. El `restore()` ya devolvía la matriz a `scale(dpr)`, así que
   * el `scale(dpr)` de después la MULTIPLICABA: cada toque a «Limpiar» duplicaba
   * la escala. En un celular con densidad 2 pasaba de 2 a 4, y todo lo que se
   * firmara después se dibujaba al doble de coordenadas — fuera del lienzo.
   *
   * El resultado era una firma en blanco GUARDADA COMO BUENA. Medido el
   * 17-sep-2026 sobre las firmas reales de flota: dos de un conductor con CERO
   * píxeles oscuros, y la de otro conductor correcta. El conductor firmaba, no
   * le gustaba, limpiaba, volvía a firmar, y a partir de ahí no quedaba nada.
   *
   * `setTransform` fija la matriz en vez de componerla. No hay forma de que se
   * vuelva a acumular.
   */
  function fijarEscala(ctx: CanvasRenderingContext2D) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  function limpiar() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    fijarEscala(ctx)
    setVacia(true)
    onCambio?.(false)
  }

  /**
   * ¿Hay trazo de verdad en el lienzo?
   *
   * 🔴 Se miran los PÍXELES, no la bandera. `vacia` solo dice que hubo un
   * movimiento del dedo, y con la escala dañada hubo movimientos que no
   * pintaron nada: la firma salió en blanco y se guardó igual, porque el código
   * preguntaba por la bandera. Una firma es un comprobante; si no hay tinta, no
   * hay comprobante.
   *
   * El umbral de 30 píxeles descarta el toque accidental sin descartar una
   * firma corta. Si el navegador no deja leer el lienzo, se asume que SÍ hay
   * firma: mejor guardar una dudosa que perder una buena.
   */
  function tieneTinta(canvas: HTMLCanvasElement): boolean {
    try {
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return true
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let oscuros = 0
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) {
          oscuros++
          if (oscuros > 30) return true
        }
      }
      return false
    } catch {
      return true
    }
  }

  useImperativeHandle(ref, () => ({
    estaVacia: () => {
      const canvas = canvasRef.current
      return !canvas || !tieneTinta(canvas)
    },
    limpiar,
    exportar: () =>
      new Promise<File | null>((resolve) => {
        const canvas = canvasRef.current
        // Sin tinta no se sube nada. Una firma en blanco guardada como buena es
        // peor que ninguna: el comprobante existe y no prueba nada.
        if (!canvas || vacia || !tieneTinta(canvas)) { resolve(null); return }
        canvas.toBlob(
          (blob) => {
            if (!blob) { resolve(null); return }
            resolve(new File([blob], `firma-${Date.now()}.jpg`, { type: 'image/jpeg', lastModified: Date.now() }))
          },
          'image/jpeg',
          0.7,
        )
      }),
  }))

  return (
    <div className="firma-pad">
      <canvas
        ref={canvasRef}
        className="firma-pad__canvas"
        style={{ height: alto, touchAction: 'none' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        onPointerCancel={onUp}
      />
      <div className="firma-pad__foot">
        <span className="firma-pad__hint">{vacia ? 'Firma aquí con el dedo' : 'Firmado'}</span>
        <button type="button" className="inline-button" onClick={limpiar} disabled={disabled || vacia}>Limpiar</button>
      </div>
    </div>
  )
})

export default FirmaPad
