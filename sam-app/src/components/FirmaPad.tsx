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
    ctx.scale(dpr, dpr)
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

  function limpiar() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
    ctx.scale(dpr, dpr)
    setVacia(true)
    onCambio?.(false)
  }

  useImperativeHandle(ref, () => ({
    estaVacia: () => vacia,
    limpiar,
    exportar: () =>
      new Promise<File | null>((resolve) => {
        const canvas = canvasRef.current
        if (!canvas || vacia) { resolve(null); return }
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
