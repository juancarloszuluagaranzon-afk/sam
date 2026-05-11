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
  const w = window as unknown as {
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance
    SpeechRecognition?: new () => SpeechRecognitionInstance
  }
  return w.webkitSpeechRecognition ?? w.SpeechRecognition ?? null
}

interface DictationCallbacks {
  onTranscript: (text: string, isFinal: boolean) => void
  onEnd?: (finalText: string) => void
  onError?: (error: string) => void
}

export function useDictation(lang = 'es-CO') {
  const [listening, setListening] = useState(false)
  const [supported, setSupported] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null)
  }, [])

  const start = useCallback(
    (callbacks: DictationCallbacks) => {
      const Ctor = getRecognitionCtor()
      if (!Ctor) {
        callbacks.onError?.('not-supported')
        return
      }

      const recognition = new Ctor()
      recognition.lang = lang
      recognition.continuous = true
      recognition.interimResults = true

      let finalText = ''

      recognition.onresult = (event: any) => {
        let interim = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]
          if (result.isFinal) {
            finalText += result[0].transcript
            callbacks.onTranscript(finalText, true)
          } else {
            interim += result[0].transcript
          }
        }
        if (interim) callbacks.onTranscript(finalText + interim, false)
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
