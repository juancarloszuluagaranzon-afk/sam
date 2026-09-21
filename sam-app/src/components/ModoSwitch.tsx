/**
 * Los DOS inicios de la app de ASM (22-sep-2026): la operación de la maquinaria y
 * la administración de fincas. Pedido del cliente: «un módulo adicional teniendo
 * dos inicios, uno para la operación de la maquinaria y otro para esto».
 *
 * Solo lo ven dueño, administración y supervisores (los que trabajan en los dos).
 * Recuerda el último que se usó en ese celular.
 */
export type Modo = 'maquinaria' | 'fincas'

const LLAVE = 'sam:modo'

export function leerModo(): Modo {
  try { return window.localStorage.getItem(LLAVE) === 'fincas' ? 'fincas' : 'maquinaria' } catch { return 'maquinaria' }
}
export function guardarModo(m: Modo) {
  try { window.localStorage.setItem(LLAVE, m) } catch { /* sin almacenamiento: igual cambia en pantalla */ }
}

export function ModoSwitch({ modo, onCambiar }: { modo: Modo; onCambiar: (m: Modo) => void }) {
  return (
    <div className="modo-switch" role="tablist" aria-label="Inicio">
      <button type="button" role="tab" aria-selected={modo === 'maquinaria'} onClick={() => onCambiar('maquinaria')}>
        <span aria-hidden="true">🚜</span> Maquinaria
      </button>
      <button type="button" role="tab" aria-selected={modo === 'fincas'} onClick={() => onCambiar('fincas')}>
        <span aria-hidden="true">🌱</span> Fincas
      </button>
    </div>
  )
}
