import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

// Polling agresivo + auto-fallback corto para que TODOS los dispositivos
// converjan a la misma version rapido tras un deploy. Antes era 5min /
// 30s; bajamos a 2min / 15s asi un push a main llega a la flota en menos
// de 3 minutos sin que nadie tenga que hacer nada.
const CHECK_INTERVAL_MS = 2 * 60 * 1000
const AUTO_APPLY_DELAY_MS = 15000

export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      const check = () => {
        if (registration.installing) return
        if (!navigator.onLine) return
        registration.update().catch(() => {})
      }
      window.setInterval(check, CHECK_INTERVAL_MS)
      const onVisible = () => {
        if (document.visibilityState === 'visible') check()
      }
      document.addEventListener('visibilitychange', onVisible)
    },
  })

  useEffect(() => {
    if (!needRefresh) return
    const id = window.setTimeout(() => {
      void updateServiceWorker(true)
    }, AUTO_APPLY_DELAY_MS)
    return () => window.clearTimeout(id)
  }, [needRefresh, updateServiceWorker])

  if (!needRefresh) return null

  return (
    <div className="update-banner" role="status" aria-live="polite">
      <div className="update-banner__content">
        <strong>Hay una versión nueva</strong>
        <span>Toca para actualizar. Es rápido.</span>
      </div>
      <div className="update-banner__actions">
        <button
          type="button"
          className="update-banner__dismiss"
          onClick={() => setNeedRefresh(false)}
          aria-label="Más tarde"
        >
          Más tarde
        </button>
        <button
          type="button"
          className="update-banner__primary"
          onClick={() => void updateServiceWorker(true)}
        >
          Actualizar
        </button>
      </div>
    </div>
  )
}
