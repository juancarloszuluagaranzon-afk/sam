import { useEffect, useRef, useState } from 'react'
import { useAppData } from '../context/AppDataContext'

// Distancia (px) que el dedo debe arrastrar hacia abajo desde la parte superior
// para disparar el refresh al soltar.
const TRIGGER_PX = 75
// Tope visual al que se puede arrastrar (impide tirones absurdos).
const MAX_PULL_PX = 140
// Factor de amortiguacion: mover el dedo X px solo desplaza X*DAMPING el banner,
// asi se siente "elastico" como en iOS.
const DAMPING = 0.5

// Pull-to-refresh global. Se monta una sola vez en el shell de la app y escucha
// gestos tactiles del documento. Cuando el usuario arrastra hacia abajo desde
// el tope de la pagina, muestra un banner y al soltar ejecuta `forceSync()` del
// AppDataContext (= mismo efecto que "Forzar sync ahora" en el DiagnosticModal).
export function PullToRefresh() {
  const { forceSync } = useAppData()
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const startYRef = useRef<number | null>(null)
  const armedRef = useRef(false)

  useEffect(() => {
    function isInsideModal(target: EventTarget | null): boolean {
      const el = target as HTMLElement | null
      if (!el) return false
      // Cualquier overlay/modal/sheet existente en la app: si el toque empieza
      // ahi, NO interceptar — el usuario probablemente esta scrolleando dentro
      // del modal o moviendo un sheet. `.avz-shell` = visor de mapas a pantalla
      // completa: arrastrar el mapa hacia abajo NO debe disparar el sync (el
      // banner salia a cada rato mientras se navegaba el plano).
      return !!el.closest(
        '.modal-overlay, .diagnostic-card, .labor-detail-modal, .more-sheet, .side-menu, .pin-modal, .avz-shell',
      )
    }

    function onTouchStart(e: TouchEvent) {
      if (isRefreshing) return
      if (window.scrollY > 0) return
      if (isInsideModal(e.target)) return
      startYRef.current = e.touches[0].clientY
      armedRef.current = true
    }

    function onTouchMove(e: TouchEvent) {
      if (!armedRef.current || startYRef.current === null || isRefreshing) return
      const currentY = e.touches[0].clientY
      const delta = currentY - startYRef.current
      if (delta <= 0) {
        // Scrolling back up — cancelar el pull en curso
        if (pullDistance !== 0) setPullDistance(0)
        armedRef.current = false
        return
      }
      if (window.scrollY > 0) {
        armedRef.current = false
        setPullDistance(0)
        return
      }
      const pull = Math.min(delta * DAMPING, MAX_PULL_PX)
      setPullDistance(pull)
      // Suprimir scroll nativo solo cuando ya hay arrastre significativo, para
      // no interferir con scroll vertical normal.
      if (pull > 8 && e.cancelable) {
        e.preventDefault()
      }
    }

    function endPull(triggered: boolean) {
      armedRef.current = false
      startYRef.current = null
      setPullDistance(0)
      if (triggered && !isRefreshing) {
        setIsRefreshing(true)
        void forceSync().finally(() => {
          setIsRefreshing(false)
        })
      }
    }

    function onTouchEnd() {
      if (!armedRef.current && pullDistance === 0) return
      const shouldTrigger = pullDistance >= TRIGGER_PX
      endPull(shouldTrigger)
    }

    function onTouchCancel() {
      endPull(false)
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('touchcancel', onTouchCancel, { passive: true })

    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchCancel)
    }
  }, [pullDistance, isRefreshing, forceSync])

  const visible = pullDistance > 0 || isRefreshing
  if (!visible) return null

  const armedToTrigger = pullDistance >= TRIGGER_PX
  const label = isRefreshing
    ? 'Sincronizando…'
    : armedToTrigger
      ? 'Suelta para sincronizar'
      : 'Desliza hacia abajo'
  const offset = isRefreshing ? 28 : Math.min(pullDistance, MAX_PULL_PX)

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 0,
        left: '50%',
        transform: `translateX(-50%) translateY(${offset}px)`,
        zIndex: 9100,
        background: armedToTrigger || isRefreshing ? '#1a6b3a' : '#3f7a4f',
        color: '#fff',
        padding: '8px 18px',
        borderRadius: '0 0 18px 18px',
        fontSize: 13,
        fontWeight: 500,
        boxShadow: '0 4px 10px rgba(0,0,0,.18)',
        transition: isRefreshing ? 'transform 0.18s ease-out, background 0.18s' : 'background 0.18s',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      {isRefreshing ? <span>↻ {label}</span> : <span>↓ {label}</span>}
    </div>
  )
}
