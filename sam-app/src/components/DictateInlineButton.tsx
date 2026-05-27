import { memo, useRef } from 'react'
import { dictationErrorMessage, useDictation } from '../hooks/useDictation'

interface DictateInlineButtonProps {
  onComplete: (text: string) => void
  onError?: (error: string) => void
  disabled?: boolean
  ariaLabel?: string
}

export const DictateInlineButton = memo(function DictateInlineButton({
  onComplete,
  onError,
  disabled,
  ariaLabel = 'Dictar',
}: DictateInlineButtonProps) {
  const { listening, supported, start, stop } = useDictation('es-CO')
  const finalTextRef = useRef('')

  // Si el navegador no soporta Web Speech API, mostramos el boton
  // deshabilitado con un tooltip explicativo en vez de ocultarlo.
  // Asi el operario sabe que la funcion existe pero su navegador no
  // la soporta — antes el boton simplemente no aparecia y daba la
  // impresion de bug.
  if (!supported) {
    return (
      <button
        type="button"
        className="dictate-inline-btn"
        disabled
        aria-label="Dictado no disponible en este navegador"
        title="Dictado no disponible. Usa Chrome o Edge actualizado."
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 10v2a7 7 0 0 0 14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
          <line x1="2" y1="2" x2="22" y2="22" />
        </svg>
      </button>
    )
  }

  const handleClick = () => {
    if (listening) {
      stop()
      return
    }
    finalTextRef.current = ''
    start({
      onTranscript: (text, isFinal) => {
        if (isFinal) finalTextRef.current = text
      },
      onEnd: (finalText) => {
        const text = finalText || finalTextRef.current
        if (text) onComplete(text)
      },
      onError: (err) => {
        // Si no se paso onError desde el caller, al menos lo logueamos a
        // consola con mensaje en humano (en lugar de fallar en silencio
        // y dejar al operario sin pista de que pasa).
        if (onError) onError(err)
        else console.warn('[dictado]', dictationErrorMessage(err))
      },
    })
  }

  return (
    <button
      type="button"
      className={`dictate-inline-btn${listening ? ' dictate-inline-btn--listening' : ''}`}
      onClick={handleClick}
      disabled={disabled}
      aria-pressed={listening}
      aria-label={listening ? 'Detener dictado' : ariaLabel}
      title={listening ? 'Detener dictado' : ariaLabel}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10v2a7 7 0 0 0 14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    </button>
  )
})
