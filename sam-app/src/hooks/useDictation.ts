import { useCallback, useEffect, useRef, useState } from 'react'

type SpeechRecognitionInstance = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: any) => void) | null
  onend: (() => void) | null
  onerror: ((event: any) => void) | null
  start: () => void
  stop: () => void
}

function getRecognitionCtor(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance
    SpeechRecognition?: new () => SpeechRecognitionInstance
  }
  return w.webkitSpeechRecognition ?? w.SpeechRecognition ?? null
}

/**
 * Traduce los codigos de error del Web Speech API a mensajes en español
 * que el operario entiende. Los codigos vienen del SpeechRecognitionErrorEvent
 * (ver https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognitionErrorEvent/error)
 */
export function dictationErrorMessage(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Permiso de microfono denegado. Habilitalo desde el navegador (icono junto a la URL).'
    case 'audio-capture':
      return 'No se detecto un microfono. Conecta o habilita el microfono del dispositivo.'
    case 'no-speech':
      return 'No se escucho nada. Acerca el microfono y vuelve a intentar.'
    case 'network':
      return 'Sin red para el dictado. Necesitas conexion a Internet para que funcione.'
    case 'aborted':
      return 'Dictado cancelado.'
    case 'not-supported':
      return 'Tu navegador no soporta dictado por voz. Usa Chrome o Edge.'
    case 'start-failed':
      return 'No se pudo iniciar el dictado. Intenta de nuevo.'
    default:
      return `Error de dictado (${code}).`
  }
}

interface DictationCallbacks {
  onTranscript: (text: string, isFinal: boolean) => void
  onEnd?: (finalText: string) => void
  onError?: (error: string) => void
}

export function useDictation(lang = 'es-CO') {
  const [listening, setListening] = useState(false)
  // supported se calcula sincronicamente para que el boton aparezca en
  // el primer render. Antes se setea en un useEffect que causaba flicker
  // null -> boton al cargar.
  const [supported] = useState(() => getRecognitionCtor() !== null)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)

  const start = useCallback(
    (callbacks: DictationCallbacks) => {
      const Ctor = getRecognitionCtor()
      if (!Ctor) {
        callbacks.onError?.('not-supported')
        return
      }

      const recognition = new Ctor()
      recognition.lang = lang
      // continuous=false: la sesion termina automaticamente cuando el motor
      // detecta silencio. Esto evita duplicaciones de Chrome Android, que en
      // modo continuous emitia el mismo final result varias veces durante una
      // sesion larga. Si el usuario quiere dictar mas, vuelve a tocar el boton.
      recognition.continuous = false
      recognition.interimResults = true

      let finalText = ''

      // Reconstruye el transcript final desde cero en cada evento iterando
      // TODOS los results (no solo desde resultIndex), y deduplica segmentos
      // finales consecutivos identicos. Chrome Android emite a veces el mismo
      // result en posiciones distintas durante una sesion con continuous=true,
      // lo cual hacia que el texto se duplicara con la estrategia anterior
      // basada en indices.
      recognition.onresult = (event: any) => {
        const segments: string[] = []
        let interim = ''
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i]
          const piece = String(result[0]?.transcript ?? '').trim()
          if (!piece) continue
          if (result.isFinal) {
            if (segments[segments.length - 1] !== piece) {
              segments.push(piece)
            }
          } else {
            interim += interim ? ' ' + piece : piece
          }
        }
        const nextFinal = segments.join(' ')
        const finalChanged = nextFinal !== finalText
        finalText = nextFinal
        if (finalChanged && nextFinal) callbacks.onTranscript(nextFinal, true)
        if (interim) {
          const join = nextFinal ? `${nextFinal} ` : ''
          callbacks.onTranscript(join + interim, false)
        }
      }

      recognition.onend = () => {
        setListening(false)
        recognitionRef.current = null
        callbacks.onEnd?.(finalText.trim())
      }

      recognition.onerror = (event: any) => {
        setListening(false)
        recognitionRef.current = null
        callbacks.onError?.(String(event?.error ?? 'unknown'))
      }

      try {
        recognition.start()
        recognitionRef.current = recognition
        setListening(true)
      } catch {
        setListening(false)
        callbacks.onError?.('start-failed')
      }
    },
    [lang],
  )

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
    }
  }, [])

  return { listening, supported, start, stop }
}
