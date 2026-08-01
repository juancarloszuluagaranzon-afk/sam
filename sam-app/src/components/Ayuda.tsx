import { useState, type ReactNode } from 'react'

/**
 * El texto que explica una pantalla, guardado detrás de un botoncito.
 *
 * Estas explicaciones sirven —y mucho— la primera vez. Pero el que entra
 * quince veces al día ya se las sabe, y en un celular ocupan media pantalla:
 * hay que rodar para llegar a lo que se viene a ver. La ayuda no puede
 * estorbarle al que ya no la necesita.
 *
 * Cerrada por defecto: quien la quiera, la abre.
 */
export function Ayuda({ children }: { children: ReactNode }) {
  const [abierta, setAbierta] = useState(false)

  return (
    <div className="ayuda">
      <button
        type="button"
        className={`ayuda__btn${abierta ? ' is-open' : ''}`}
        onClick={() => setAbierta(!abierta)}
        aria-expanded={abierta}
      >
        <span aria-hidden>ⓘ</span> {abierta ? 'Ocultar' : 'Info'}
      </button>
      {abierta && <div className="ayuda__texto">{children}</div>}
    </div>
  )
}

export default Ayuda
