import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

const CHECK_INTERVAL_MS = 5 * 60 * 1000

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
    }, 30000)
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
