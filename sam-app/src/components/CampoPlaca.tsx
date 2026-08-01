import { useEffect, useId, useMemo, useState } from 'react'
import { loadCatalogo } from '../services/samApi'
import { normalizarPlaca } from '../lib/texto'

/** Lo que ya se ha escrito en este equipo, por tipo de lista. */
const CACHE_KEY = 'sam:lista-usada'
/** Copia de la lista del servidor, para que sin señal siga sugiriendo. */
const ESPEJO_KEY = 'sam:lista-servidor'
const MAX = 20

function leer(clave: string, tipo: string): string[] {
  try {
    const crudo = JSON.parse(localStorage.getItem(`${clave}:${tipo}`) ?? '[]')
    return Array.isArray(crudo) ? crudo.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function guardar(clave: string, tipo: string, valores: string[]): void {
  try {
    localStorage.setItem(`${clave}:${tipo}`, JSON.stringify(valores))
  } catch {
    /* almacenamiento lleno: la sugerencia es un lujo, no se rompe el registro */
  }
}

/** Deja el valor de primero en lo usado en este equipo, sin repetirlo. */
export function recordarValor(tipo: string, valor: string): void {
  const v = valor.trim().toUpperCase()
  if (!v) return
  guardar(CACHE_KEY, tipo, [v, ...leer(CACHE_KEY, tipo).filter((x) => x !== v)].slice(0, MAX))
}

/** Compatibilidad: la placa es la lista 'PLACA' como cualquier otra. */
export function recordarPlaca(placa: string): void {
  recordarValor('PLACA', normalizarPlaca(placa))
}

/**
 * Sugerencias de una lista: primero lo que se escribió en este equipo, después
 * lo que tiene cargado el catálogo.
 *
 * La lista del servidor se espeja en el equipo. Sin eso, el supervisor sin
 * señal —que es la mitad del día— se quedaría sin ninguna sugerencia.
 */
export function useSugerencias(tipo: string): string[] {
  const [delServidor, setDelServidor] = useState<string[]>(() => leer(ESPEJO_KEY, tipo))
  const [delEquipo, setDelEquipo] = useState<string[]>(() => leer(CACHE_KEY, tipo))

  useEffect(() => {
    setDelEquipo(leer(CACHE_KEY, tipo))
    setDelServidor(leer(ESPEJO_KEY, tipo))
    let vivo = true
    void loadCatalogo(tipo).then((vs) => {
      if (!vivo || vs.length === 0) return
      const valores = vs.map((v) => v.valor)
      setDelServidor(valores)
      guardar(ESPEJO_KEY, tipo, valores)
    })
    return () => { vivo = false }
  }, [tipo])

  return useMemo(() => {
    const vistas = new Set<string>()
    return [...delEquipo, ...delServidor].filter((v) => v && !vistas.has(v) && vistas.add(v))
  }, [delEquipo, delServidor])
}

/**
 * Campo de texto con sugerencias de una lista de catálogo.
 *
 * Sugiere, no obliga. La lista se carga en Insumos → Catálogos, pero si
 * aparece una bomba nueva a las seis de la mañana se escribe y ya; después se
 * agrega a la lista con calma. Obligar a dar de alta el valor antes de poder
 * registrar era un muro en pleno campo.
 */
export function CampoLista({
  tipo,
  value,
  onChange,
  disabled,
  placeholder,
  normalizar = (v) => v.toLocaleUpperCase('es-CO'),
  autoFocus,
}: {
  /** Qué lista alimenta las sugerencias: 'ESTACION', 'PLACA', 'USO'… */
  tipo: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  placeholder?: string
  normalizar?: (v: string) => string
  autoFocus?: boolean
}) {
  const listaId = useId()
  const sugerencias = useSugerencias(tipo)

  return (
    <>
      <input
        type="text"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        list={sugerencias.length ? listaId : undefined}
        value={value}
        onChange={(e) => onChange(normalizar(e.target.value))}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
      />
      {sugerencias.length > 0 && (
        <datalist id={listaId}>
          {sugerencias.map((v) => <option key={v} value={v} />)}
        </datalist>
      )}
    </>
  )
}

/**
 * La placa: igual que cualquier lista, pero sin espacios ni guiones.
 *
 * En campo escriben "abc 123", "ABC-123" y "abc123" para el mismo carro; se
 * normaliza a `ABC123` para que no terminen siendo tres vehículos.
 */
export function CampoPlaca({
  value, onChange, disabled, placeholder = 'ABC123', autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  placeholder?: string
  autoFocus?: boolean
}) {
  return (
    <CampoLista
      tipo="PLACA"
      value={value}
      onChange={onChange}
      normalizar={normalizarPlaca}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
    />
  )
}

export default CampoPlaca
