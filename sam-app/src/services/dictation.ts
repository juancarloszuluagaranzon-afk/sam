const WEBHOOK_URL = import.meta.env.VITE_DICTATE_WEBHOOK_URL as string | undefined

export type DictationEvent = 'start_assignment' | 'finish_assignment' | 'free_field'

export interface DictationAssignmentContext {
  id: string
  suerteCode: string
  haciendaCode: number
  haciendaName: string
  suerte: string
  labor: string
  area: number
  equipmentCode: string
  equipmentName: string
}

export interface DictationFreeFieldContext {
  haciendaCode: string
  haciendaName: string
  selectedSuertes: string[]
  labor: string
  cliente: string
  equipmentCode: string
  equipmentName: string
}

export interface DictationPayload {
  event: DictationEvent
  text: string
  timestamp: string
  user: { id: string; name: string; role: string }
  assignment?: DictationAssignmentContext
  freeField?: DictationFreeFieldContext
}

export function sendDictation(payload: DictationPayload): void {
  if (!WEBHOOK_URL) return
  if (!payload.text.trim()) return

  try {
    void fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // fire-and-forget — never let a webhook failure block the UI
  }
}
