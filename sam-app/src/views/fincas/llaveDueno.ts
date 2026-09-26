import { SESSION_KEY } from '../../context/AppDataContext'
import { guardarLlaveDueno, leerLlaveDueno } from '../../services/fincasApi'

/**
 * iPhone/iPad. 🔴 En iOS la app que se agrega a la pantalla de inicio NO comparte
 * lo guardado en Safari: la llave guardada al abrir el enlace no existe para ella,
 * y el ícono abriría el ingreso del personal en vez de la finca. Por eso en iOS la
 * llave se queda en la dirección: «Agregar a inicio» guarda la dirección completa.
 * (En Android la app instalada sí comparte lo del navegador: ahí basta guardarla.)
 */
export function esIOS(): boolean {
  const ua = navigator.userAgent || ''
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

/** ¿La app corre instalada (desde el ícono), no en una pestaña del navegador? */
export function corriendoInstalada(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true
  } catch { return false }
}

/**
 * ¿Hay que abrir la vista del dueño? 1) Enlace recién abierto (`#finca=<llave>`):
 * se guarda y —salvo en iOS— se quita de la barra de direcciones (para que no
 * quede a la vista ni en una captura). 2) Ya lo había abierto en este celular (o
 * la instaló como app): solo si nadie del personal tiene sesión abierta en él.
 */
export function tomarLlaveDueno(): string | null {
  const m = window.location.hash.match(/^#finca=([0-9a-f]{64})$/i)
  if (m) {
    guardarLlaveDueno(m[1])
    if (!esIOS()) {
      try { window.history.replaceState(null, '', window.location.pathname + window.location.search) } catch { /* nada */ }
    }
    return m[1]
  }
  const guardada = leerLlaveDueno()
  if (!guardada) return null
  try { if (window.localStorage.getItem(SESSION_KEY)) return null } catch { /* sin almacenamiento */ }
  return guardada
}

/**
 * Deja la instalación a la medida del dueño: el nombre de SU finca en el ícono y,
 * en iOS, un manifiesto cuyo inicio es el enlace con su llave (si Safari lo usa,
 * el ícono abre la finca; si no, usa la dirección actual, que también la lleva).
 */
export function prepararInstalacionDueno(llave: string, nombreFinca: string) {
  const corto = nombreFinca.length > 14 ? nombreFinca.slice(0, 14).trim() : nombreFinca
  document.title = `${nombreFinca} · AgroMorales`
  let meta = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]')
  if (!meta) { meta = document.createElement('meta'); meta.name = 'apple-mobile-web-app-title'; document.head.appendChild(meta) }
  meta.content = corto
  if (!esIOS()) return
  const inicio = `${window.location.origin}/#finca=${llave}`
  const manifiesto = {
    id: `/finca/${llave.slice(0, 12)}`, name: `${nombreFinca} · AgroMorales`, short_name: corto,
    start_url: inicio, scope: `${window.location.origin}/`, display: 'standalone',
    background_color: '#f5f5f0', theme_color: '#1a6b3a',
    icons: [
      { src: `${window.location.origin}/pwa-192x192.png`, sizes: '192x192', type: 'image/png' },
      { src: `${window.location.origin}/pwa-512x512.png`, sizes: '512x512', type: 'image/png' },
    ],
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(manifiesto)], { type: 'application/manifest+json' }))
  let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
  if (!link) { link = document.createElement('link'); link.rel = 'manifest'; document.head.appendChild(link) }
  link.href = url
}
