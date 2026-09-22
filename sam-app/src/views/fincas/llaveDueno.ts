import { SESSION_KEY } from '../../context/AppDataContext'
import { guardarLlaveDueno, leerLlaveDueno } from '../../services/fincasApi'

/**
 * ¿Hay que abrir la vista del dueño? 1) Enlace recién abierto (`#finca=<llave>`):
 * se guarda y se quita de la barra de direcciones (para que no quede a la vista
 * ni en una captura). 2) Ya lo había abierto en este celular (o la instaló como
 * app): solo si nadie del personal tiene sesión abierta en él.
 */
export function tomarLlaveDueno(): string | null {
  const m = window.location.hash.match(/^#finca=([0-9a-f]{64})$/i)
  if (m) {
    guardarLlaveDueno(m[1])
    try { window.history.replaceState(null, '', window.location.pathname + window.location.search) } catch { /* nada */ }
    return m[1]
  }
  const guardada = leerLlaveDueno()
  if (!guardada) return null
  try { if (window.localStorage.getItem(SESSION_KEY)) return null } catch { /* sin almacenamiento */ }
  return guardada
}
