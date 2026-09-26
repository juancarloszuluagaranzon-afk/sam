import { useEffect, useState } from 'react'
import { corriendoInstalada, esIOS } from './llaveDueno'

/**
 * «Instalar en mi celular» para el dueño de la tierra (25-sep-2026): que la finca
 * quede como una app, con su ícono, sin tener que buscar el enlace cada vez.
 *
 * - Android / Chrome: el navegador ofrece instalar (`beforeinstallprompt`); el botón
 *   lo dispara.
 * - iPhone: Safari no tiene ese botón; se explica el camino (Compartir → Agregar a
 *   inicio). La dirección conserva la llave para que el ícono abra la finca.
 * - Ya instalada (abierta desde el ícono) o si dijo «ahora no», no vuelve a salir.
 */
interface EventoInstalar extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const OCULTO = 'sam:af-instalar-oculto'

export function InstalarApp({ nombreFinca }: { nombreFinca: string }) {
  const [evento, setEvento] = useState<EventoInstalar | null>(null)
  const [oculto, setOculto] = useState(() => {
    try { return corriendoInstalada() || window.localStorage.getItem(OCULTO) === '1' } catch { return corriendoInstalada() }
  })
  const [instalada, setInstalada] = useState(false)

  useEffect(() => {
    const guardar = (e: Event) => { e.preventDefault(); setEvento(e as EventoInstalar) }
    const lista = () => { setInstalada(true); setEvento(null) }
    window.addEventListener('beforeinstallprompt', guardar)
    window.addEventListener('appinstalled', lista)
    return () => {
      window.removeEventListener('beforeinstallprompt', guardar)
      window.removeEventListener('appinstalled', lista)
    }
  }, [])

  if (oculto) return null
  if (instalada) {
    return <div className="af-instalar"><p>✓ Listo: <b>{nombreFinca}</b> quedó en su celular. Ábrala desde el ícono.</p></div>
  }

  function cerrar() {
    try { window.localStorage.setItem(OCULTO, '1') } catch { /* nada */ }
    setOculto(true)
  }

  return (
    <div className="af-instalar">
      <div>
        <b>📲 Deje su finca en el celular</b>
        {evento ? (
          <p>Se instala como una app: queda el ícono en su pantalla de inicio y abre directo en {nombreFinca}.</p>
        ) : esIOS() ? (
          <p>
            En Safari toque <b>Compartir</b> <span aria-hidden="true">⬆️</span> (el cuadrito con la flecha, abajo) y luego
            {' '}<b>«Agregar a inicio»</b>. Queda el ícono de {nombreFinca} en su pantalla de inicio.
          </p>
        ) : (
          <p>En el menú del navegador (⋮) toque <b>«Instalar app»</b> o <b>«Agregar a la pantalla de inicio»</b>.</p>
        )}
      </div>
      <div className="af-acciones">
        {evento && (
          <button type="button" className="primary-button" onClick={async () => {
            await evento.prompt()
            const r = await evento.userChoice
            if (r.outcome === 'accepted') setInstalada(true)
            setEvento(null)
          }}>Instalar en mi celular</button>
        )}
        <button type="button" className="af-link" onClick={cerrar}>Ahora no</button>
      </div>
    </div>
  )
}
