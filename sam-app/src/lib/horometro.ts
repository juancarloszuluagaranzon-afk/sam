/**
 * La revisión del horómetro al digitarlo.
 *
 * **La regla, en palabras del cliente:** entre dos lecturas seguidas de la misma
 * máquina no puede haber más de 24 horas de diferencia, *así hayan pasado tres
 * días*. Porque la máquina no está prendida todo el tiempo: si estuvo en el
 * taller, el horómetro no avanzó. El tiempo que importa es el que trabajó, y
 * nadie hace turnos de más de un día.
 *
 * ⚠️ Contra la intuición, **NO se multiplica por los días transcurridos.** Fue mi
 * primer diseño y estaba mal: le regalaba 72 horas de margen a una máquina que
 * pasó tres días parada, que es justo el caso que hay que cazar.
 *
 * **Medido en producción antes de escribirlo** (3.447 lecturas, 2.871
 * comparaciones):
 *   · el avance típico entre dos lecturas es de **3,9 horas**
 *   · el 81,7% avanza menos de 12
 *   · solo el 8,4% pasa de 24, y el 6,2% pasa de 48 — esos ya no son trabajo,
 *     son dedazos
 * O sea que 24 es seis veces el uso normal: avisa poco y cuando avisa, acierta.
 *
 * 🔴 **Avisa, no bloquea.** Un bloqueo duro habría rechazado el 13,5% de los
 * registros históricos, y entre esos hay casos legítimos: la VALTRA 9902 a la
 * que le CAMBIARON el horómetro y empezó de cero otra vez. Dejar a un operario
 * varado a las 6 a.m. frente a la máquina es peor que un dato dudoso que queda
 * marcado. El segundo toque convierte el descuido en una decisión.
 */

/** Máximo que puede avanzar un horómetro entre dos lecturas seguidas. */
export const MAX_HORAS_ENTRE_LECTURAS = 24

export type RevisionHorometro =
  | { ok: true }
  | { ok: false; tipo: 'BAJA' | 'SALTO'; mensaje: string }

function n1(v: number): string {
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(v)
}

/**
 * ¿Este horómetro tiene sentido contra el último que se registró?
 *
 * @param nuevo       lo que acaban de digitar
 * @param referencia  la última lectura BUENA de esa máquina. `null` o `0` =
 *                    no hay con qué comparar, y entonces **no se dice nada**:
 *                    sin señal o con una máquina nueva, inventar una alarma es
 *                    peor que callarse.
 */
export function revisarHorometro(
  nuevo: number,
  referencia: number | null | undefined,
): RevisionHorometro {
  if (!Number.isFinite(nuevo) || nuevo <= 0) return { ok: true }
  if (referencia == null || !Number.isFinite(referencia) || referencia <= 0) {
    return { ok: true }
  }

  // Escalas distintas: la lectura de referencia y la nueva no son comparables.
  // Pasa cuando alguien digita 54030 donde antes venía 5407 — la misma lectura
  // con y sin la décima. Eso ya lo marca el aviso de siempre; aquí se calla
  // para no dar dos alarmas por lo mismo.
  const digitos = (v: number) => Math.floor(Math.log10(v))
  if (digitos(nuevo) !== digitos(referencia)) return { ok: true }

  if (nuevo < referencia) {
    return {
      ok: false,
      tipo: 'BAJA',
      mensaje: `La última lectura de esta máquina fue ${n1(referencia)} y estás poniendo `
        + `${n1(nuevo)}: un horómetro no va para atrás. Míralo otra vez — y si le `
        + 'cambiaron el horómetro, avísale al taller.',
    }
  }

  const avance = nuevo - referencia
  if (avance > MAX_HORAS_ENTRE_LECTURAS) {
    return {
      ok: false,
      tipo: 'SALTO',
      mensaje: `Serían ${n1(avance)} horas desde la última lectura (${n1(referencia)}), `
        + 'y una máquina no trabaja más de 24 horas entre una labor y otra. '
        + 'Revisa el tablero antes de guardar.',
    }
  }

  return { ok: true }
}

// ─────────────────── La referencia, disponible sin señal ───────────────────
//
// Se guarda en `localStorage` y no en Dexie a propósito: subir la versión de
// Dexie dispara una migración, y en este proyecto esas migraciones han sido
// destructivas (limpian la caché) cada vez que hubo que arreglar un incidente.
// Para un espejo de veinticinco números no vale la pena arriesgar eso. Es el
// mismo patrón que ya usan los catálogos de listas.

const CLAVE = 'sam:horometro-ref'

/** Guarda el espejo `{ codigoDeMaquina: ultimaLecturaBuena }`. */
export function guardarReferencias(refs: Record<string, number>): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(refs))
  } catch { /* sin espacio o en modo privado: se sigue sin referencia */ }
}

/** Lee el espejo. Devuelve vacío si no hay o si está corrupto. */
export function leerReferencias(): Record<string, number> {
  try {
    const crudo = localStorage.getItem(CLAVE)
    if (!crudo) return {}
    const obj = JSON.parse(crudo) as Record<string, unknown>
    const salida: Record<string, number> = {}
    for (const [k, v] of Object.entries(obj)) {
      const n = Number(v)
      if (Number.isFinite(n) && n > 0) salida[k] = n
    }
    return salida
  } catch { return {} }
}

/** La última lectura buena de una máquina, o `null` si no se sabe. */
export function referenciaDe(codigo: string | null | undefined): number | null {
  if (!codigo) return null
  const n = leerReferencias()[codigo]
  return Number.isFinite(n) && n > 0 ? n : null
}
