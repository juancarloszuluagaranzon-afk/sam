/**
 * Visor de una foto a pantalla completa.
 *
 * En la lista la pieza se reconoce por una miniatura de 56 px; para comprobar
 * que de verdad es la pieza correcta —el número de parte grabado, la forma del
 * rodamiento— hay que poder verla grande. Y en el celular, grande es la pantalla
 * entera: por eso el fondo oscuro y nada más alrededor.
 *
 * Usa `modal-overlay open`, como todas las ventanas del app, para que el botón
 * «atrás» del celular la cierre sola (`activarCapasAutomaticas` de `lib/atras.ts`
 * busca el botón con `aria-label="Cerrar"`). Los estilos viven en
 * `views/taller/piezas.css`.
 */
export function FotoVisor({ src, titulo, onClose }: {
  src: string
  /** Nombre de la pieza: es el texto que oye quien usa lector de pantalla. */
  titulo?: string
  onClose: () => void
}) {
  return (
    <div
      className="modal-overlay open pieza-visor"
      role="dialog"
      aria-modal="true"
      aria-label={titulo ? `Foto de ${titulo}` : 'Foto'}
      onClick={onClose}
    >
      <button type="button" className="pieza-visor__cerrar" onClick={onClose} aria-label="Cerrar">
        &#x2715;
      </button>
      <img
        className="pieza-visor__img"
        src={src}
        alt={titulo ?? 'Foto'}
        loading="lazy"
        decoding="async"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}

export default FotoVisor
