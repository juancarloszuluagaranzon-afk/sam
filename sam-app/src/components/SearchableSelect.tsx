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
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedOption = options.find((opt) => opt.value === String(value))
  // Un solo toque: al enfocar el input se abre la lista y, por ser un input normal
  // (editable, sin readOnly), iOS y Android levantan el teclado de forma NATIVA.
  // El teclado se superpone sobre la parte baja de la lista; la lista tiene scroll
  // y el campo se sube solo al enfocarse, así que sigue siendo usable. Mientras está
  // abierto mostramos lo que se escribe (query); cerrado, la etiqueta seleccionada.
  const displayValue = isOpen ? query : selectedOption ? selectedOption.label : ''

  function close() {
    setIsOpen(false)
    setQuery('')
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

  const inputPlaceholder = isOpen ? `Buscar ${placeholder.toLowerCase()}...` : placeholder

  return (
    <div className="searchable-select" ref={wrapperRef}>
      <input
        ref={inputRef}
        className="searchable-select-input"
        type="text"
        placeholder={inputPlaceholder}
        value={displayValue}
        onChange={(e) => {
          setQuery(e.target.value)
          if (!isOpen) setIsOpen(true)
        }}
        onFocus={() => {
          // Toque directo sobre el input → teclado nativo (iOS/Android) + abrir lista.
          setIsOpen(true)
          setQuery('')
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
            inputRef.current?.focus()
          }
        }}
      >
        <span>&#x25BC;</span>
      </div>
      {isOpen && (
        <ul className="searchable-select-options">
          <li
            className={`searchable-select-item ${!value ? 'selected' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              onChange('')
              close()
              inputRef.current?.blur()
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
                  inputRef.current?.blur()
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
