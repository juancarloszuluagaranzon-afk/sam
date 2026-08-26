import { useEffect, useState } from 'react'
import { loadHorometros } from '../services/tallerApi'
import {
  revisarHorometro, guardarReferencias, referenciaDe, leerReferencias,
} from '../lib/horometro'

/**
 * Avisa cuando el horómetro digitado no cuadra con la última lectura buena.
 *
 * 🔴 **No toca el guardado.** Es un `<p>` debajo del campo y nada más: si esto
 * fallara, el operario cierra su labor igual. Se hizo así a propósito — cerrar
 * la labor es por donde la gente cobra, y la app lleva semanas estable.
 *
 * La referencia se trae UNA vez por sesión y queda espejada en el equipo, así
 * que sin señal sigue avisando con el último dato conocido. Si no hay ninguno,
 * no dice nada: inventar una alarma sin con qué comparar es peor que callarse.
 */

/** Se carga una sola vez por sesión, no una por cada campo en pantalla. */
let cargando: Promise<void> | null = null

function asegurarReferencias(): Promise<void> {
  if (cargando) return cargando
  cargando = (async () => {
    try {
      const lista = await loadHorometros()
      if (!lista.length) return
      const refs: Record<string, number> = {}
      for (const e of lista) if (e.horometro > 0) refs[e.codigo] = e.horometro
      if (Object.keys(refs).length) guardarReferencias(refs)
    } catch {
      // Sin señal se sigue con lo que haya en el espejo. Nunca es un error
      // visible: el aviso es una ayuda, no un requisito.
    }
  })()
  return cargando
}

export function AvisoHorometro({
  equipoCodigo,
  valor,
}: {
  equipoCodigo?: string | null
  /** Lo que hay en el input, tal cual (texto). */
  valor: string | number | null | undefined
}) {
  const [listo, setListo] = useState(() => Object.keys(leerReferencias()).length > 0)

  useEffect(() => {
    let vivo = true
    void asegurarReferencias().then(() => { if (vivo) setListo(true) })
    return () => { vivo = false }
  }, [])

  const n = Number(valor)
  if (!listo || !equipoCodigo || !Number.isFinite(n) || n <= 0) return null

  const r = revisarHorometro(n, referenciaDe(equipoCodigo))
  if (r.ok) return null

  return (
    <p className="aviso-horometro" role="status">
      <span aria-hidden>⚠️</span> {r.mensaje}
    </p>
  )
}

export default AvisoHorometro
