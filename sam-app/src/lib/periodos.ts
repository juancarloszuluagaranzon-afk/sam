/**
 * Los filtros de periodo del tablero, en un solo sitio.
 *
 * 🔴 **Existe porque el cliente pidió que «Insumos y materiales» tuviera los
 * filtros que tiene Operación general.** Copiar las seis píldoras al otro
 * archivo habría funcionado el primer día y habría durado hasta que alguien
 * corrigiera la quincena en uno solo: dos pantallas del mismo tablero diciendo
 * rangos distintos para la misma palabra es peor que no tener el filtro.
 *
 * El rango se calcula sobre el día de **Bogotá**, no sobre el reloj del
 * equipo: un celular con la zona horaria mal puesta cambiaría de «hoy» a las
 * siete de la noche, en plena jornada.
 */

export type Periodo = 'HOY' | 'AYER' | 'PRIMERA' | 'SEGUNDA' | 'MES' | 'RANGO'

export const PERIODOS: { value: Periodo; label: string }[] = [
  { value: 'HOY', label: 'Hoy' },
  { value: 'AYER', label: 'Ayer' },
  { value: 'PRIMERA', label: '1ra quinc.' },
  { value: 'SEGUNDA', label: '2da quinc.' },
  { value: 'MES', label: 'Mes' },
  { value: 'RANGO', label: 'Rango' },
]

/** Hoy en zona Bogotá (`yyyy-mm-dd`), sin depender del reloj del equipo. */
export function hoyBogota(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())
}

/**
 * El rango de fechas de cada píldora. `RANGO` devuelve el día de hoy porque
 * ahí manda lo que el usuario escriba en los dos campos.
 */
export function rangoDe(p: Periodo, hoy: string): { desde: string; hasta: string } {
  if (p === 'AYER') {
    const d = new Date(`${hoy}T12:00:00`)
    d.setDate(d.getDate() - 1)
    const ayer = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return { desde: ayer, hasta: ayer }
  }
  const [y, m] = hoy.split('-')
  const fin = `${y}-${m}-${String(new Date(Number(y), Number(m), 0).getDate()).padStart(2, '0')}`
  if (p === 'PRIMERA') return { desde: `${y}-${m}-01`, hasta: `${y}-${m}-15` }
  if (p === 'SEGUNDA') return { desde: `${y}-${m}-16`, hasta: fin }
  if (p === 'MES') return { desde: `${y}-${m}-01`, hasta: fin }
  return { desde: hoy, hasta: hoy }
}

/** Un solo día: el gal/ha de un día es ruidoso porque un tanqueo dura varios. */
export function esUnSoloDia(p: Periodo): boolean {
  return p === 'HOY' || p === 'AYER'
}
