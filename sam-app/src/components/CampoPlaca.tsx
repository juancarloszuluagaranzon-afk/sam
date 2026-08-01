import { useEffect, useId, useMemo, useState } from 'react'
import { normalizarPlaca } from '../lib/texto'

/** Placas que ya se han escrito en este equipo. */
const CACHE_KEY = 'sam:placas-usadas'
const MAX = 20

function leerCache(): string[] {
  try {
    const crudo = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '[]')
    return Array.isArray(crudo) ? crudo.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Guarda la placa de primera en la lista, sin repetirla. */
export function recordarPlaca(placa: string): void {
  const p = normalizarPlaca(placa)
  if (!p) return
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify([p, ...leerCache().filter((x) => x !== p)].slice(0, MAX)))
  } catch {
    /* almacenamiento lleno: la sugerencia es un lujo, no se rompe el registro */
  }
}

/**
 * Campo de placa: se escribe libre, con sugerencias de lo ya usado.
 *
 * Antes salía de un catálogo cerrado y había que dar de alta el vehículo antes
 * de poder tanquearlo — en la bomba, a las seis de la mañana, eso es un muro.
 * Ahora se digita, y las placas que ya pasaron por este equipo se ofrecen como
 * sugerencia; a la segunda vez el conductor solo la toca.
 *
 * Lo que se escribe queda en MAYÚSCULA y sin espacios ni guiones, para que
 * "abc 123" y "ABC-123" no terminen siendo dos vehículos distintos.
 */
export function CampoPlaca({
  value,
  onChange,
  disabled,
  sugerenciasExtra = [],
  placeholder = 'ABC123',
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  /** Placas conocidas de otra fuente (el catálogo, si todavía se usa). */
  sugerenciasExtra?: string[]
  placeholder?: string
  autoFocus?: boolean
}) {
  const listaId = useId()
  const [cache, setCache] = useState<string[]>([])

  useEffect(() => { setCache(leerCache()) }, [])

  const sugerencias = useMemo(() => {
    const vistas = new Set<string>()
    // Primero las de este equipo: son las que de verdad usa quien está mirando.
    return [...cache, ...sugerenciasExtra.map(normalizarPlaca)]
      .filter((p) => p && !vistas.has(p) && vistas.add(p))
  }, [cache, sugerenciasExtra])

  return (
    <>
      <input
        type="text"
        inputMode="text"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        list={sugerencias.length ? listaId : undefined}
        value={value}
        onChange={(e) => onChange(normalizarPlaca(e.target.value))}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
      />
      {sugerencias.length > 0 && (
        <datalist id={listaId}>
          {sugerencias.map((p) => <option key={p} value={p} />)}
        </datalist>
      )}
    </>
  )
}

export default CampoPlaca
