// Fuente ÚNICA de ingenios/compradores. Antes esta lista estaba duplicada en 6
// archivos (BulkMaestroModal, RegistrarLaborModal, MaestrosTab, OperatorView,
// SupervisorView y el mapa INGENIO_NAMES de samApi) y se desincronizaban (unos
// decían "Mayaguez", otros "Mayagüez"). Peor: agregar un comprador nuevo obligaba
// a tocar los 6 → si se olvidaba uno, el cargue masivo lo rechazaba ("ingenio
// inválido") aunque el resto de la app sí lo conociera. Ahora se agrega AQUÍ y ya.
export interface Ingenio {
  id: string
  nombre: string
}

export const INGENIOS: Ingenio[] = [
  { id: 'risaralda', nombre: 'Ingenio Risaralda' },
  { id: 'pichichi', nombre: 'Ingenio Pichichi' },
  { id: 'mayaguez', nombre: 'Ingenio Mayagüez' },
  { id: 'san_carlos', nombre: 'Ingenio San Carlos' },
  { id: 'riopaila', nombre: 'Ingenio Riopaila' },
  { id: 'trapiche_lucerna', nombre: 'Trapiche Lucerna' },
]

// Mapa id → nombre legible (para mostrar el nombre en vez del id crudo).
export const INGENIO_NAMES: Record<string, string> = Object.fromEntries(
  INGENIOS.map((i) => [i.id, i.nombre]),
)
