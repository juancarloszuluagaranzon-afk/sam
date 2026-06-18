import { useEffect, useRef, useState } from 'react'

export interface SearchableSelectOption {
  value: string
  label: string
  rightLabel?: string
}

interface Props {
  value: string
  onChange: (value: string) => void
  options: SearchableSelectOption[]
  placeholder?: string
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Seleccionar',
}: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  // En móvil (puntero "grueso") abrir NO debe levantar el teclado: la lista se
  // ve completa. El teclado solo aparece cuando el usuario pide buscar.
  const [isCoarse] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches,
  )
  const [searching, setSearching] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedOption = options.find((opt) => opt.value === String(value))
  // "Escribiendo": en escritorio basta con estar abierto; en móvil, solo cuando
  // el usuario activó la búsqueda.
  const typing = searching || (!isCoarse && isOpen)
  const displayValue = typing ? query : selectedOption ? selectedOption.label : ''
  // El input es de solo lectura en móvil hasta que se pide buscar → sin teclado.
  const readOnly = isCoarse && !searching

  function close() {
    setIsOpen(false)
    setQuery('')
    setSearching(false)
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        close()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Al activar la búsqueda (móvil), enfocar el input para que aparezca el teclado.
  useEffect(() => {
    if (searching) inputRef.current?.focus()
  }, [searching])

  const filteredOptions = options.filter((opt) =>
    opt.label.toLowerCase().includes(query.toLowerCase()) ||
    (opt.rightLabel && opt.rightLabel.toLowerCase().includes(query.toLowerCase())),
  )

  function handleInputClick() {
    if (!isCoarse) return // escritorio: el foco/typing lo maneja onFocus
    if (!isOpen) {
      setIsOpen(true)
      setSearching(false)
      setQuery('')
    } else if (!searching) {
      // segundo toque sobre el campo → activar teclado para buscar
      setSearching(true)
    }
  }

  const inputPlaceholder = typing
    ? `Buscar ${placeholder.toLowerCase()}...`
    : isOpen && isCoarse
      ? 'Toca para buscar…'
      : placeholder

  return (
    <div className="searchable-select" ref={wrapperRef}>
      <input
        ref={inputRef}
        className="searchable-select-input"
        type="text"
        placeholder={inputPlaceholder}
        value={displayValue}
        readOnly={readOnly}
        onChange={(e) => {
          setQuery(e.target.value)
          if (!isOpen) setIsOpen(true)
        }}
        onClick={handleInputClick}
        onFocus={() => {
          // Escritorio: enfocar abre y limpia para escribir. Móvil: lo maneja el clic.
          if (!isCoarse) {
            setIsOpen(true)
            setQuery('')
          }
        }}
        autoComplete="off"
      />
      <div
        className="searchable-select-arrow"
        onClick={() => {
          if (isOpen) close()
          else {
            setIsOpen(true)
            setQuery('')
            setSearching(false)
          }
        }}
      >
        <span>&#x25BC;</span>
      </div>
      {isOpen && (
        <ul className="searchable-select-options">
          {/* Móvil sin teclado: opción explícita para activar la búsqueda */}
          {isCoarse && !searching && (
            <li
              className="searchable-select-item searchable-select-search"
              onMouseDown={(e) => {
                e.preventDefault()
                setSearching(true)
              }}
            >
              🔍 Buscar…
            </li>
          )}
          <li
            className={`searchable-select-item ${!value ? 'selected' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              onChange('')
              close()
            }}
          >
            {placeholder}
          </li>
          {filteredOptions.length > 0 ? (
            filteredOptions.map((opt) => (
              <li
                key={opt.value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(opt.value)
                  close()
                }}
                className={`searchable-select-item ${opt.value === String(value) ? 'selected' : ''}`}
              >
                <span>{opt.label}</span>
                {opt.rightLabel && <span className="searchable-select-item-right">{opt.rightLabel}</span>}
              </li>
            ))
          ) : (
            <li className="searchable-select-item searchable-select-empty">Sin resultados</li>
          )}
        </ul>
      )}
    </div>
  )
}

export default SearchableSelect
