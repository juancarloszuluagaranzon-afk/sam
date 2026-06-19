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
  // ve completa. El teclado solo aparece cuando el usuario toca el campo de nuevo.
  const [isCoarse] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches,
  )
  const [searching, setSearching] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedOption = options.find((opt) => opt.value === String(value))
  // "Escribiendo": en escritorio basta con estar abierto; en móvil, solo cuando
  // el input recibió foco real (segundo toque) → ahí mostramos el query.
  const typing = searching || (!isCoarse && isOpen)
  const displayValue = typing ? query : selectedOption ? selectedOption.label : ''
  // CLAVE para iOS: el teclado solo aparece de forma confiable cuando el usuario
  // TOCA DIRECTAMENTE un <input> que NO sea readOnly (el focus() por código lo
  // bloquea Safari). Por eso el input es readOnly únicamente mientras la lista está
  // CERRADA: el 1er toque abre la lista sin teclado; al quedar abierta el input ya
  // es editable, y el 2º toque cae directo sobre él → iOS abre el teclado solo.
  const readOnly = isCoarse && !isOpen

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

  const filteredOptions = options.filter((opt) =>
    opt.label.toLowerCase().includes(query.toLowerCase()) ||
    (opt.rightLabel && opt.rightLabel.toLowerCase().includes(query.toLowerCase())),
  )

  function handleInputClick() {
    if (!isCoarse) return // escritorio: el foco/typing lo maneja onFocus
    // Primer toque (campo readOnly): abre la lista SIN teclado. El segundo toque cae
    // sobre el input ya editable y iOS abre el teclado nativamente (sin focus por código).
    if (!isOpen) {
      setIsOpen(true)
      setSearching(false)
      setQuery('')
    }
  }

  const inputPlaceholder = typing
    ? `Buscar ${placeholder.toLowerCase()}...`
    : isOpen && isCoarse
      ? 'Toca aquí para escribir…'
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
          if (!isCoarse) {
            // Escritorio: enfocar abre y limpia para escribir.
            setIsOpen(true)
            setQuery('')
            return
          }
          // Móvil: el input solo recibe foco real cuando la lista YA está abierta
          // (cerrada es readOnly y no se enfoca). El teclado lo abrió iOS solo al
          // tocar el input editable; aquí entramos en modo escritura y limpiamos.
          if (isOpen) {
            setSearching(true)
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
          {/* Móvil en modo navegar: pista para que toque el campo y aparezca el teclado */}
          {isCoarse && !searching && (
            <li
              className="searchable-select-item searchable-select-empty"
              style={{ fontStyle: 'italic', opacity: 0.7 }}
            >
              🔍 Toca el campo de arriba para escribir
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
