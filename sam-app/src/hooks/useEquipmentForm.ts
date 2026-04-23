import { useState, type FormEvent } from 'react'
import { useAppData } from '../context/AppDataContext'
import type { EquipmentFormState } from '../views/SupervisorView'
import { createEquipment, loadEquipment } from '../services/samApi'

const EMPTY_FORM: EquipmentFormState = {
  code: '',
  name: '',
  type: 'tractor',
  state: 'activo',
  brand: '',
  model: '',
  year: '',
  plate: '',
  serialNumber: '',
  notes: '',
  active: true,
}

export function useEquipmentForm() {
  const { setBusy, setError, setInfo, setEquipment } = useAppData()

  const [equipmentForm, setEquipmentForm] = useState<EquipmentFormState>(EMPTY_FORM)
  const [isEquipmentFormOpen, setIsEquipmentFormOpen] = useState(false)

  function updateEquipmentForm<K extends keyof EquipmentFormState>(
    field: K,
    value: EquipmentFormState[K],
  ) {
    setEquipmentForm((current) => ({ ...current, [field]: value }))
  }

  async function handleCreateEquipment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!equipmentForm.code.trim() || !equipmentForm.name.trim()) {
      setError('Codigo y nombre son obligatorios para crear el equipo.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await createEquipment({
        code: equipmentForm.code.trim().toUpperCase(),
        name: equipmentForm.name.trim(),
        type: equipmentForm.type,
        state: equipmentForm.state,
        brand: equipmentForm.brand.trim(),
        model: equipmentForm.model.trim(),
        year: equipmentForm.year ? Number(equipmentForm.year) : null,
        plate: equipmentForm.plate.trim(),
        serialNumber: equipmentForm.serialNumber.trim(),
        notes: equipmentForm.notes.trim(),
        active: equipmentForm.active,
      })
      setEquipmentForm(EMPTY_FORM)
      setIsEquipmentFormOpen(false)
      const refreshed = await loadEquipment()
      setEquipment(refreshed.data)
      setInfo('Equipo creado correctamente.')
    } catch {
      setError('No se pudo crear el equipo. Revisa codigo unico y campos.')
    } finally {
      setBusy(false)
    }
  }

  return {
    equipmentForm,
    setEquipmentForm,
    updateEquipmentForm,
    isEquipmentFormOpen,
    setIsEquipmentFormOpen,
    handleCreateEquipment,
  }
}
