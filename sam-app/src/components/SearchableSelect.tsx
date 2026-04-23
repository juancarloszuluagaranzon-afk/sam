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

  const selectedOption = options.find((opt) => opt.value === String(value))
  const displayValue = isOpen ? query : selectedOption ? selectedOption.label : ''

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filteredOptions = options.filter((opt) =>
    opt.label.toLowerCase().includes(query.toLowerCase()) ||
    (opt.rightLabel && opt.rightLabel.toLowerCase().includes(query.toLowerCase())),
  )

  return (
    <div className="searchable-select" ref={wrapperRef}>
      <input
        className="searchable-select-input"
        type="text"
        placeholder={isOpen ? `Buscar ${placeholder.toLowerCase()}...` : placeholder}
        value={displayValue}
        onChange={(e) => {
          setQuery(e.target.value)
          if (!isOpen) setIsOpen(true)
        }}
        onFocus={() => {
          setIsOpen(true)
          setQuery('')
        }}
        autoComplete="off"
      />
      <div
        className="searchable-select-arrow"
        onClick={() => {
          setIsOpen(!isOpen)
          if (!isOpen) setQuery('')
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
              setIsOpen(false)
              setQuery('')
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
                  setIsOpen(false)
                  setQuery('')
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
