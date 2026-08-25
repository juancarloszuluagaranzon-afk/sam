import { useState, type FormEvent } from 'react'
import { useAppData } from '../context/AppDataContext'
import type { EquipmentFormState } from '../views/SupervisorView'
import {
  createEquipment, updateEquipment, loadEquipment, loadEquipoDetalle,
  setEquipmentActivo, deleteEquipment, contarUsoEquipo,
} from '../services/samApi'

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

/**
 * Alta, edición, apagado y borrado de máquinas.
 *
 * El mismo formulario sirve para crear y para editar: lo que cambia es
 * `editando`, que guarda el código de la máquina que se está tocando. Con dos
 * formularios distintos, cada campo nuevo habría que agregarlo dos veces y uno
 * de los dos se queda atrás — ya pasó en este proyecto.
 */
export function useEquipmentForm() {
  const { setBusy, setError, setInfo, setEquipment } = useAppData()

  const [equipmentForm, setEquipmentForm] = useState<EquipmentFormState>(EMPTY_FORM)
  const [isEquipmentFormOpen, setIsEquipmentFormOpen] = useState(false)
  /** Código de la máquina en edición. `null` = se está creando una nueva. */
  const [editando, setEditando] = useState<string | null>(null)

  function updateEquipmentForm<K extends keyof EquipmentFormState>(
    field: K,
    value: EquipmentFormState[K],
  ) {
    setEquipmentForm((current) => ({ ...current, [field]: value }))
  }

  async function refrescar() {
    const refreshed = await loadEquipment()
    setEquipment(refreshed.data)
  }

  function nuevaMaquina() {
    setEditando(null)
    setEquipmentForm(EMPTY_FORM)
    setIsEquipmentFormOpen(true)
  }

  function cerrarFormulario() {
    setEditando(null)
    setEquipmentForm(EMPTY_FORM)
    setIsEquipmentFormOpen(false)
  }

  /** Abre el formulario con la ficha completa, que no viene en el listado. */
  async function editarMaquina(codigo: string) {
    setBusy(true); setError('')
    try {
      const ficha = await loadEquipoDetalle(codigo)
      if (!ficha) { setError('No se encontró esa máquina.'); return }
      setEquipmentForm({
        code: ficha.code,
        name: ficha.name,
        type: ficha.type,
        state: ficha.state,
        brand: ficha.brand,
        model: ficha.model,
        year: ficha.year == null ? '' : String(ficha.year),
        plate: ficha.plate,
        serialNumber: ficha.serialNumber,
        notes: ficha.notes,
        active: ficha.active,
      })
      setEditando(codigo)
      setIsEquipmentFormOpen(true)
    } catch {
      setError('No se pudo abrir la máquina.')
    } finally { setBusy(false) }
  }

  async function handleCreateEquipment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!equipmentForm.code.trim() || !equipmentForm.name.trim()) {
      setError('Codigo y nombre son obligatorios para crear el equipo.')
      return
    }
    setBusy(true)
    setError('')
    const datos = {
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
    }
    try {
      if (editando) {
        // El código NO se manda: es la llave del historial. Ver `updateEquipment`.
        await updateEquipment(editando, datos)
        setInfo(`${datos.name} actualizada.`)
      } else {
        await createEquipment(datos)
        setInfo('Equipo creado correctamente.')
      }
      cerrarFormulario()
      await refrescar()
    } catch (e) {
      setError(e instanceof Error && e.message
        ? e.message
        : editando
          ? 'No se pudo actualizar la máquina.'
          : 'No se pudo crear el equipo. Revisa codigo unico y campos.')
    } finally {
      setBusy(false)
    }
  }

  /** Apaga o prende la máquina. Apagada deja de ofrecerse en los selectores. */
  async function cambiarActivo(codigo: string, activo: boolean) {
    setBusy(true); setError('')
    try {
      await setEquipmentActivo(codigo, activo)
      setInfo(activo ? `${codigo} activada.` : `${codigo} desactivada: ya no aparece en los selectores.`)
      await refrescar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cambiar el estado.')
    } finally { setBusy(false) }
  }

  /**
   * Borra de verdad, y solo si nunca se usó. Antes de preguntar se cuenta el
   * historial: si lo tiene, se ofrece desactivar en vez de borrar, porque
   * `equipo_metas` y `equipo_horas_mes` cuelgan con ON DELETE CASCADE.
   */
  async function borrarMaquina(codigo: string, nombre: string) {
    setBusy(true); setError('')
    try {
      const uso = await contarUsoEquipo(codigo)
      if (uso.total > 0) {
        const partes = [
          uso.asignaciones && `${uso.asignaciones} labores`,
          uso.kardex && `${uso.kardex} movimientos de inventario`,
          uso.horas && `${uso.horas} cierres de horómetro`,
          uso.combustible && `${uso.combustible} tanqueos`,
        ].filter(Boolean).join(', ')
        const apagar = window.confirm(
          `${nombre} ya tiene historial (${partes}).\n\n`
          + 'Si la borras se pierde, y las labores quedan apuntando a una máquina que no existe.\n\n'
          + '¿La desactivo en vez de borrarla?',
        )
        if (apagar) await cambiarActivo(codigo, false)
        return
      }
      if (!window.confirm(`¿Borrar ${nombre}? Nunca se ha usado, así que no se pierde nada.`)) return
      await deleteEquipment(codigo)
      setInfo(`${nombre} eliminada.`)
      await refrescar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo eliminar la máquina.')
    } finally { setBusy(false) }
  }

  return {
    equipmentForm,
    setEquipmentForm,
    updateEquipmentForm,
    isEquipmentFormOpen,
    setIsEquipmentFormOpen,
    handleCreateEquipment,
    editando,
    nuevaMaquina,
    cerrarFormulario,
    editarMaquina,
    cambiarActivo,
    borrarMaquina,
  }
}
