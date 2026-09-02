import { useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import { Ayuda } from '../components/Ayuda'
import { fmtFechaHora } from '../lib/fechas'
import { enviarOEncolar } from '../lib/outboxInsumos'
import {
  nuevoFolio, crearCaso, SEVERIDAD_LABEL, SEVERIDAD_ICONO,
  type Severidad, type TipoCaso,
} from '../services/soporteApi'

/**
 * Reportar una falla de la app — la pantalla del operario.
 *
 * 🔴 **Un toque es un reporte válido.** La única pregunta es si puede seguir
 * trabajando, y eso él lo sabe sin pensar. Todo lo demás —la foto, el texto— es
 * opcional y se agrega después, ya con el caso creado.
 *
 * Es la lección del flujo de solicitudes de insumos, que existe y en un mes se
 * usó 7 veces contra 404 entregas directas: **perdió contra el camino informal**.
 * Aquí el rival es el WhatsApp, y al WhatsApp no se le gana pidiendo más datos.
 *
 * 🔴 **No se le pregunta la prioridad.** Él sabe si está parado; no sabe el
 * impacto en la operación. Pedirle que clasifique termina con todo en «urgente»,
 * que es lo mismo que no tener prioridades.
 *
 * ⚠️ **En ninguna parte hay un número de horas.** No hay notificaciones push, así
 * que prometer «respondemos en una hora» es prometer lo que no se puede cumplir.
 * Lo que sí se promete es el ORDEN: quien está parado va de primero, y eso se
 * cumple en la bandeja, no en un texto.
 */
export function ReportarView({ onListo, pantalla, errorMensaje }: {
  /** Se llama con el folio ya creado, para mostrar el acuse. */
  onListo: (folio: string) => void
  /** Desde qué pantalla se reportó. Lo llena quien abre esta vista. */
  pantalla?: string
  /** Si el caso nace de una pantalla caída, el error viaja solo. */
  errorMensaje?: string
}) {
  const { session, setError } = useAppData()
  const [enviando, setEnviando] = useState<Severidad | 'peticion' | null>(null)

  async function reportar(severidad: Severidad, tipo?: TipoCaso) {
    if (!session || enviando) return
    setEnviando(tipo === 'peticion' ? 'peticion' : severidad)
    setError('')
    const folio = nuevoFolio(session.id)
    const payload = {
      folio,
      creadoPor: session.id,
      creadoPorNombre: session.name,
      rolCreador: session.role,
      origen: 'app' as const,
      severidad,
      tipo,
      creadoEnDispositivo: new Date().toISOString(),
      pantalla,
      appVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : undefined,
      errorMensaje,
    }
    try {
      // Por la COLA: el operario reporta justo cuando algo le falló, y muchas
      // veces lo que falló fue la señal. Un reporte que exige conexión no sirve.
      await enviarOEncolar('SOPORTE', payload, async () => { await crearCaso(payload) })
      onListo(folio)
    } catch {
      setError('No se pudo registrar el caso. Intenta otra vez.')
    } finally {
      setEnviando(null)
    }
  }

  const OPCIONES: Severidad[] = ['parado', 'con_problemas', 'puede_esperar']

  return (
    <section className="panel-card">
      <div className="panel-title">
        <h2>Cuéntanos qué pasó</h2>
      </div>

      <Ayuda>
        <p>
          <strong>Esto lo ven dos personas de soporte, de lunes a sábado entre las 6 de
          la mañana y las 6 de la tarde.</strong>
        </p>
        <p>Si marcaste que no puedes seguir, tu caso se pone de primero en la lista.</p>
        <p>No prometemos arreglarlo de una: te decimos qué hacer mientras tanto.</p>
        <p>
          Aunque estés sin señal, tu reporte queda guardado y se manda solo cuando
          vuelva.
        </p>
      </Ayuda>

      <p className="reportar-pregunta">¿Puedes seguir trabajando?</p>

      <div className="reportar-opciones">
        {OPCIONES.map((sev) => (
          <button
            key={sev}
            type="button"
            className={`reportar-opcion reportar-opcion--${sev}`}
            onClick={() => void reportar(sev)}
            disabled={enviando !== null}
          >
            <span className="reportar-opcion__icono" aria-hidden>{SEVERIDAD_ICONO[sev]}</span>
            <span className="reportar-opcion__txt">
              {enviando === sev ? 'Registrando…' : SEVERIDAD_LABEL[sev]}
            </span>
          </button>
        ))}
      </div>

      {/* La petición entra por su propia puerta: si una idea cayera en la misma
          bolsa que las fallas, envenenaría el conteo de "casos abiertos" y la
          "edad del más viejo" — y esos dos números son los que dicen si el
          soporte va bien. */}
      <button
        type="button"
        className="reportar-idea"
        onClick={() => void reportar('puede_esperar', 'peticion')}
        disabled={enviando !== null}
      >
        {enviando === 'peticion' ? 'Registrando…' : 'Tengo una idea para mejorar la app'}
      </button>
    </section>
  )
}

/**
 * El acuse: el número del caso, de una, aunque no haya señal.
 *
 * 🔴 Sin un número visible, un reporte hecho sin señal se siente como que no
 * quedó — y el operario lo vuelve a mandar, o se va al WhatsApp. Por eso el folio
 * lo arma el celular y no la base.
 */
export function AcuseCaso({ folio, cuando, onCerrar }: {
  folio: string
  cuando: string
  onCerrar: () => void
}) {
  return (
    <section className="panel-card">
      <div className="panel-title"><h2>Listo, tu caso quedó registrado</h2></div>
      <p className="acuse-folio">{folio}</p>
      <p className="subtle-copy">{fmtFechaHora(cuando)}</p>
      <p>
        Aunque estés sin señal <strong>ya quedó guardado</strong>; se manda solo cuando
        haya señal. Puedes agregarle una foto o contarnos más desde <strong>Mis
        reportes</strong>.
      </p>
      <button type="button" className="primary-button" onClick={onCerrar}>
        Entendido
      </button>
    </section>
  )
}

export default ReportarView
