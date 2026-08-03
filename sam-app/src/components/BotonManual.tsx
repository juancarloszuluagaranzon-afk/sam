import { useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import type { Role } from '../domain/sam'

/**
 * El manual del rol, a un toque desde la app.
 *
 * Antes había que mandar el enlace por WhatsApp y confiar en que la persona lo
 * guardara. Al día siguiente ya no lo encontraba entre los chats. Teniéndolo
 * dentro, el que se traba en el campo lo abre en el momento en que se trabó.
 *
 * Se abre en una pestaña aparte a propósito: no se pierde lo que estaba
 * haciendo, y puede ir mirando el manual y la pantalla real a la vez.
 */

interface Manual {
  archivo: string
  titulo: string
  para: string
}

const MANUALES: Record<string, Manual> = {
  operario: { archivo: 'manual-operario.html', titulo: '📖 Guía del operario', para: 'Tu día a día en campo' },
  supervisor: { archivo: 'manual-supervisor-insumos.html', titulo: '📖 Guía del supervisor de insumos', para: 'Tu carro, entregas y tanqueos' },
  analista: { archivo: 'manual-analista-diego.html', titulo: '📖 Guía del analista de insumos', para: 'Avales, inventario y catálogos' },
  taller: { archivo: 'manual-taller.html', titulo: '🔧 Guía del taller de maquinaria', para: 'Cómo se llena la información' },
}

/** Qué manual le toca a cada rol. */
function manualesDe(rol?: Role): Manual[] {
  switch (rol) {
    case 'operador':
      return [MANUALES.operario]
    case 'supervisor_insumos':
      return [MANUALES.supervisor]
    case 'analista_insumos':
      return [MANUALES.analista, MANUALES.taller]
    // Dueño, administración y soporte ven la operación completa: les sirven
    // todos, porque a ellos les preguntan.
    case 'owner':
    case 'administracion':
    case 'soporte':
      return [MANUALES.analista, MANUALES.supervisor, MANUALES.operario, MANUALES.taller]
    default:
      return [MANUALES.operario]
  }
}

export function BotonManual({ className = 'primary-button outline', onAbrir }: {
  className?: string
  /** Para cerrar el menú lateral que lo contiene, si aplica. */
  onAbrir?: () => void
}) {
  const { session } = useAppData()
  const [eligiendo, setEligiendo] = useState(false)
  const lista = manualesDe(session?.role)

  function abrir(m: Manual) {
    window.open(`/manuales/${m.archivo}`, '_blank', 'noopener')
    setEligiendo(false)
    onAbrir?.()
  }

  // Con uno solo no hay nada que elegir: se abre directo.
  if (lista.length === 1) {
    return (
      <button type="button" className={className} onClick={() => abrir(lista[0])}>
        📖 Manual
      </button>
    )
  }

  return (
    <>
      <button type="button" className={className} onClick={() => setEligiendo(true)}>
        📖 Manuales
      </button>
      {eligiendo && (
        <div className="modal-overlay open" onClick={() => setEligiendo(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(420px, calc(100vw - 32px))' }}>
            <div className="labor-detail-header">
              <div><p className="eyebrow">Ayuda</p><h3>¿Cuál manual?</h3></div>
              <button type="button" className="modal-close-btn" onClick={() => setEligiendo(false)} aria-label="Cerrar">&#x2715;</button>
            </div>
            <div className="inv-list" style={{ marginTop: 4 }}>
              {lista.map((m) => (
                <button key={m.archivo} type="button" className="cat-row" onClick={() => abrir(m)}>
                  <span className="cat-row__val">
                    {m.titulo}
                    <small className="bod-stock__reparto">{m.para}</small>
                  </span>
                  <span className="consumo-maq__ver">abrir →</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default BotonManual
