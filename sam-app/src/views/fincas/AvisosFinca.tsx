import { useEffect, useState } from 'react'
import { claveAvisos, desuscribirAvisos, mensajeDeError, probarAviso, suscribirAvisos } from '../../services/fincasApi'
import { corriendoInstalada, esIOS } from './llaveDueno'

/**
 * «🔔 Avisos» para el dueño de la tierra (25-sep-2026): una notificación al
 * celular cuando se termina una labor en su finca, aunque no tenga la app abierta.
 *
 * - Android: funciona en el navegador o instalada.
 * - iPhone: SOLO instalada en la pantalla de inicio (iOS 16.4+). En Safari se le
 *   explica que primero la instale.
 * - 🔴 El permiso se pide DENTRO del toque del botón, antes de cualquier espera:
 *   Safari no lo muestra si se pide después de ir al servidor.
 */
type Estado = 'cargando' | 'no-soportado' | 'instalar-primero' | 'bloqueado' | 'apagado' | 'activo'

function base64aBytes(b64: string): Uint8Array {
  const relleno = '='.repeat((4 - (b64.length % 4)) % 4)
  const s = atob((b64 + relleno).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}

export function AvisosFinca({ llave, nombreFinca }: { llave: string; nombreFinca: string }) {
  const [estado, setEstado] = useState<Estado>('cargando')
  const [sub, setSub] = useState<PushSubscription | null>(null)
  const [clave, setClave] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState('')
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    let vivo = true
    void (async () => {
      const soporta = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
      if (!soporta) { if (vivo) setEstado(esIOS() && !corriendoInstalada() ? 'instalar-primero' : 'no-soportado'); return }
      if (Notification.permission === 'denied') { if (vivo) setEstado('bloqueado'); return }
      // La llave pública se trae de una vez: al tocar el botón ya está a la mano.
      claveAvisos().then((c) => { if (vivo) setClave(c) }).catch(() => { /* se reintenta al activar */ })
      const reg = await navigator.serviceWorker.getRegistration()
      const s = reg ? await reg.pushManager.getSubscription() : null
      if (!vivo) return
      setSub(s)
      setEstado(s ? 'activo' : 'apagado')
    })()
    return () => { vivo = false }
  }, [])

  async function activar() {
    setMensaje('')
    // Primero el permiso (en el mismo toque), después todo lo demás.
    const permiso = await Notification.requestPermission()
    if (permiso !== 'granted') {
      setEstado(permiso === 'denied' ? 'bloqueado' : 'apagado')
      return
    }
    setOcupado(true)
    try {
      const c = clave ?? await claveAvisos()
      if (!c) throw new Error('Los avisos todavía no están configurados. Avísele a AgroServicios Morales.')
      const reg = await navigator.serviceWorker.ready
      const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64aBytes(c) as BufferSource })
      await suscribirAvisos(llave, s.toJSON(), navigator.userAgent)
      setSub(s); setEstado('activo')
      setMensaje('✓ Listo. Le llegará un aviso cada vez que se termine una labor en su finca.')
    } catch (e) {
      setMensaje(`No se pudieron activar: ${mensajeDeError(e)}`)
    } finally { setOcupado(false) }
  }

  async function probar() {
    if (!sub) return
    setOcupado(true); setMensaje('')
    try {
      const ok = await probarAviso(llave, sub.endpoint)
      setMensaje(ok ? 'Enviado: en unos segundos le llega el aviso de prueba.' : 'No se pudo enviar la prueba. Desactive y vuelva a activar los avisos.')
    } catch (e) { setMensaje(mensajeDeError(e)) } finally { setOcupado(false) }
  }

  async function desactivar() {
    if (!sub) return
    setOcupado(true); setMensaje('')
    try {
      await desuscribirAvisos(llave, sub.endpoint).catch(() => { /* igual se quita del celular */ })
      await sub.unsubscribe()
      setSub(null); setEstado('apagado')
      setMensaje('Avisos desactivados en este celular.')
    } finally { setOcupado(false) }
  }

  if (estado === 'cargando' || estado === 'no-soportado') return null

  return (
    <div className="af-avisos">
      <div>
        <b>🔔 Avisos de su finca</b>
        {estado === 'activo' && <p>Activos en este celular: le llega un aviso cuando se termina una labor en {nombreFinca}.</p>}
        {estado === 'apagado' && <p>Reciba un aviso en el celular cada vez que se termine una labor en {nombreFinca}, aunque no tenga la app abierta.</p>}
        {estado === 'instalar-primero' && <p>En iPhone los avisos llegan a la app instalada: primero déjela en su pantalla de inicio (arriba) y ábrala desde el ícono.</p>}
        {estado === 'bloqueado' && <p>Los avisos están bloqueados para esta app. Actívelos en los Ajustes del celular → Notificaciones.</p>}
        {mensaje && <p className="af-avisos__msg">{mensaje}</p>}
      </div>
      <div className="af-acciones">
        {estado === 'apagado' && <button type="button" className="primary-button" disabled={ocupado} onClick={() => void activar()}>Activar avisos</button>}
        {estado === 'activo' && (
          <>
            <button type="button" className="inline-button" disabled={ocupado} onClick={() => void probar()}>Probar aviso</button>
            <button type="button" className="af-link" disabled={ocupado} onClick={() => void desactivar()}>Desactivar</button>
          </>
        )}
      </div>
    </div>
  )
}
