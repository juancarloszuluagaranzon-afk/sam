import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Aísla el fallo de una pantalla para que no tumbe la aplicación entera.
 *
 * 🔴 **Por qué existe.** Hasta hoy no había ninguna: un error de dibujo en
 * cualquier pantalla dejaba TODA la app en blanco, con la barra y el menú
 * incluidos. Le pasó al cliente con el tablero de movimientos, y ya había pasado
 * antes con un chunk que no cargó.
 *
 * La diferencia entre las dos situaciones es enorme para quien está en campo:
 * una pantalla que dice «esto se cayó, vuelve a intentar» deja usar el resto del
 * aplicativo — cerrar la labor, registrar el tanqueo, lo que estaba haciendo. Una
 * pantalla en blanco no deja hacer nada y parece que se dañó todo.
 *
 * ⚠️ No arregla el error: lo contiene y lo muestra. El detalle técnico queda
 * plegado para poder pedírselo a quien reporte el problema, porque «se puso todo
 * blanco» no alcanza para arreglar nada.
 */
interface Props {
  children: ReactNode
  /** Nombre de la pantalla, para que el aviso diga cuál falló. */
  nombre?: string
}

interface State {
  error: Error | null
}

export class PantallaSegura extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Queda en la consola para el diagnóstico; el usuario ve el mensaje de abajo.
    console.error('[PantallaSegura]', this.props.nombre ?? '', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <section className="panel-card">
        <div className="panel-title">
          <h2>Esta pantalla no se pudo mostrar</h2>
        </div>
        <p>
          {this.props.nombre
            ? <>Algo falló al dibujar <strong>{this.props.nombre}</strong>.</>
            : 'Algo falló al dibujar esta pantalla.'}{' '}
          <strong>El resto del aplicativo sigue funcionando</strong>: puede seguir
          trabajando con normalidad desde el menú.
        </p>
        <div className="modal-footer" style={{ justifyContent: 'flex-start' }}>
          <button type="button" className="primary-button" onClick={() => this.setState({ error: null })}>
            Volver a intentar
          </button>
          <button type="button" className="inline-button" onClick={() => window.location.reload()}>
            Recargar la aplicación
          </button>
        </div>
        <details style={{ marginTop: 14 }}>
          <summary className="subtle-copy" style={{ cursor: 'pointer' }}>
            Detalle técnico (para reportarlo)
          </summary>
          <pre
            style={{
              marginTop: 8, padding: 10, borderRadius: 8, overflowX: 'auto',
              fontSize: '0.74rem', lineHeight: 1.45,
              background: 'var(--color-bg-soft, #f2f5f0)',
            }}
          >
            {error.message}
          </pre>
        </details>
      </section>
    )
  }
}

export default PantallaSegura
