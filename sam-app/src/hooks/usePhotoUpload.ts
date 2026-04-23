import { useRef, useState, type ChangeEvent } from 'react'
import { SESSION_KEY, useAppData } from '../context/AppDataContext'
import { uploadUserPhoto } from '../services/samApi'

const MAX_BYTES = 5 * 1024 * 1024

export function usePhotoUpload() {
  const { session, setSession, setError, setInfo } = useAppData()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  function triggerUpload() {
    fileInputRef.current?.click()
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    const input = event.target
    if (!file || !session) return
    if (!file.type.startsWith('image/')) {
      setError('Selecciona un archivo de imagen.')
      input.value = ''
      return
    }
    if (file.size > MAX_BYTES) {
      setError('La imagen supera los 5 MB.')
      input.value = ''
      return
    }
    setUploading(true)
    setError('')
    try {
      const url = await uploadUserPhoto(session.id, file)
      const updated = { ...session, photoUrl: url }
      setSession(updated)
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(updated))
      setInfo('Foto actualizada.')
    } catch {
      setError('No se pudo subir la foto.')
    } finally {
      setUploading(false)
      input.value = ''
    }
  }

  return { fileInputRef, triggerUpload, handleFileChange, uploading }
}
