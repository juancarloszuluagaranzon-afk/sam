import { useMemo, useState, type FormEvent } from 'react'
import { useAppData } from '../context/AppDataContext'
import type { Assignment, Zone } from '../domain/sam'
import { db } from '../lib/db'
import type { AssignmentFormState } from '../views/SupervisorView'
import { createAssignment as apiCreateAssignment, loadAssignments } from '../services/samApi'

function normalizeText(value: string) {
  return value.trim().toUpperCase()
}

function getRemainingArea(
  assignments: Assignment[],
  suerteCode: string,
  labor: string,
  totalArea: number,
): number {
  const executed = assignments
    .filter(
      (a) =>
        a.suerteCode === suerteCode &&
        normalizeText(a.labor) === normalizeText(labor) &&
        a.status === 'COMPLETADA',
    )
    .reduce((sum, a) => sum + (a.executedArea ?? 0), 0)
  return Math.max(0, totalArea - executed)
}

function generateTempId() {
  return `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const EMPTY_FORM: AssignmentFormState = {
  haciendaCode: '',
  suerte: '',
  labor: '',
  operatorId: '',
  equipmentCode: '',
  operatorId2: '',
  equipmentCode2: '',
  notes: '',
  cliente: '',
  ingenioId: '',
  supervisorId: '',
  zone: '',
}

interface Options {
  onFreeFieldTaken?: () => void
}

export function useFreeFieldForm(options?: Options) {
  const {
    session,
    operators,
    equipment,
    assignments,
    setAssignments,
    maestro,
    isOnline,
    setOutboxCount,
    setInfo,
    setError,
    setBusy,
    todayKey,
    supervisors,
  } = useAppData()

  const [freeFieldForm, setFreeFieldForm] = useState<AssignmentFormState>(EMPTY_FORM)
  const [freeFieldSuertesList, setFreeFieldSuertesList] = useState<string[]>([])

  const freeFieldHaciendas = useMemo(() => {
    const map = new Map<string, string>()
    maestro.forEach((row) => {
      if (freeFieldForm.ingenioId && row.ingenio_id !== freeFieldForm.ingenioId) return
      if (!map.has(row.haciendaCode)) map.set(row.haciendaCode, row.haciendaName)
    })
    return Array.from(map.entries()).map(([code, name]) => ({ code, name }))
  }, [maestro, freeFieldForm.ingenioId])

  const freeFieldSuertes = useMemo(
    () => maestro.filter((row) => row.haciendaCode === freeFieldForm.haciendaCode),
    [maestro, freeFieldForm.haciendaCode],
  )

  async function refreshAssignments() {
    const result = await loadAssignments()
    setAssignments(result.data)
  }

  function updateFreeFieldForm(field: keyof AssignmentFormState, value: string) {
    setFreeFieldForm((current) => {
      if (field === 'cliente') {
        setFreeFieldSuertesList([])
        return { ...current, cliente: value, ingenioId: '', haciendaCode: '', suerte: '' }
      }
      if (field === 'ingenioId') {
        setFreeFieldSuertesList([])
        return { ...current, ingenioId: value, haciendaCode: '', suerte: '' }
      }
      if (field === 'haciendaCode') {
        setFreeFieldSuertesList([])
        return { ...current, haciendaCode: value, suerte: '' }
      }
      return { ...current, [field]: value }
    })
  }

  function toggleFreeFieldSuerte(suerte: string) {
    setFreeFieldSuertesList((current) =>
      current.includes(suerte) ? current.filter((s) => s !== suerte) : [...current, suerte],
    )
  }

  async function takeFreeField(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session || session.role !== 'operador') return

    if (freeFieldSuertesList.length === 0) {
      setError('Selecciona al menos una suerte.')
      return
    }

    const operator = operators.find((item) => item.id === session.id)
    const equipmentItem = equipment.find(
      (item) => item.code === (freeFieldForm.equipmentCode || session.equipmentCode),
    )

    if (!operator || !equipmentItem || !freeFieldForm.labor || !freeFieldForm.cliente) {
      setError('Completa labor, equipo y cliente para tomar campo libre.')
      return
    }

    const selectedSupervisor = supervisors.find((s) => s.id === freeFieldForm.supervisorId)
    if (!selectedSupervisor) {
      setError('Selecciona el supervisor que aprobará la labor.')
      return
    }

    if (freeFieldForm.zone !== 'NORTE' && freeFieldForm.zone !== 'SUR') {
      setError('Selecciona la zona (Norte o Sur).')
      return
    }
    const zone: Zone = freeFieldForm.zone

    const maestroRows = freeFieldSuertesList
      .map((suerte) =>
        maestro.find(
          (row) => row.haciendaCode === freeFieldForm.haciendaCode && row.suerte === suerte,
        ),
      )
      .filter((row): row is NonNullable<typeof row> => row !== undefined)

    const suertesCompletas = maestroRows.filter(
      (row) =>
        getRemainingArea(
          assignments,
          `${row.haciendaCode}-${row.suerte}`,
          freeFieldForm.labor,
          row.area,
        ) === 0,
    )
    if (suertesCompletas.length > 0) {
      setError(
        `La labor "${freeFieldForm.labor}" ya está completamente ejecutada en: ${suertesCompletas.map((r) => r.suerte).join(', ')}. No hay área pendiente.`,
      )
      return
    }

    setBusy(true)
    setError('')

    try {
      if (!isOnline) {
        const now = new Date().toISOString()
        const localAssignments: Assignment[] = []

        for (const maestroRow of maestroRows) {
          const tempId = generateTempId()
          const area = getRemainingArea(
            assignments,
            `${maestroRow.haciendaCode}-${maestroRow.suerte}`,
            freeFieldForm.labor,
            maestroRow.area,
          )
          const createInput: Parameters<typeof apiCreateAssignment>[0] = {
            haciendaCode: maestroRow.haciendaCode,
            haciendaName: maestroRow.haciendaName,
            suerte: maestroRow.suerte,
            labor: freeFieldForm.labor,
            area,
            supervisorId: selectedSupervisor.id,
            supervisorName: selectedSupervisor.name,
            operatorId: operator.id,
            operatorName: operator.name,
            equipmentCode: equipmentItem.code,
            equipmentName: equipmentItem.name,
            notes: freeFieldForm.notes,
            cliente: freeFieldForm.cliente as 'ingenios' | 'proveedores',
            kind: 'LIBRE',
            initialStatus: 'PENDIENTE',
            approval: 'PENDIENTE',
            zone,
          }
          const local: Assignment = {
            id: tempId,
            createdAt: now,
            dateKey: todayKey,
            haciendaCode: maestroRow.haciendaCode,
            haciendaName: maestroRow.haciendaName,
            suerte: maestroRow.suerte,
            suerteCode: `${maestroRow.haciendaCode}-${maestroRow.suerte}`,
            labor: freeFieldForm.labor,
            area,
            status: 'PENDIENTE',
            operatorId: operator.id,
            operatorName: operator.name,
            supervisorId: selectedSupervisor.id,
            equipmentCode: equipmentItem.code,
            equipmentName: equipmentItem.name,
            startedAt: null,
            finishedAt: null,
            executedArea: 0,
            notes: freeFieldForm.notes,
            kind: 'LIBRE',
            horometroInicial: null,
            horometroFinal: null,
            cliente: freeFieldForm.cliente as 'ingenios' | 'proveedores',
            approval: 'PENDIENTE',
            approvedBy: null,
            approvedAt: null,
            zone,
          }
          await db.outbox.add({ type: 'CREATE', createInput, tempId, queuedAt: now, status: 'pending' })
          await db.assignments.put(local)
          localAssignments.push(local)
        }

        setAssignments((current) => [...localAssignments, ...current])
        setOutboxCount((c) => c + maestroRows.length)
        setInfo(
          `${maestroRows.length} labor(es) creadas localmente. Se sincronizaran al recuperar senal.`,
        )
      } else {
        await Promise.all(
          maestroRows.map((maestroRow) =>
            apiCreateAssignment({
              haciendaCode: maestroRow.haciendaCode,
              haciendaName: maestroRow.haciendaName,
              suerte: maestroRow.suerte,
              labor: freeFieldForm.labor,
              area: getRemainingArea(
                assignments,
                `${maestroRow.haciendaCode}-${maestroRow.suerte}`,
                freeFieldForm.labor,
                maestroRow.area,
              ),
              supervisorId: selectedSupervisor.id,
              supervisorName: selectedSupervisor.name,
              operatorId: operator.id,
              operatorName: operator.name,
              equipmentCode: equipmentItem.code,
              equipmentName: equipmentItem.name,
              notes: freeFieldForm.notes,
              cliente: freeFieldForm.cliente as 'ingenios' | 'proveedores',
              kind: 'LIBRE',
              initialStatus: 'PENDIENTE',
              approval: 'PENDIENTE',
              zone,
            }),
          ),
        )
        await refreshAssignments()
        setInfo(`${maestroRows.length} labor(es) tomadas en campo libre.`)
      }

      const savedEquipment = freeFieldForm.equipmentCode || session.equipmentCode
      setFreeFieldForm({ ...EMPTY_FORM, equipmentCode: savedEquipment })
      setFreeFieldSuertesList([])
      options?.onFreeFieldTaken?.()
    } catch (err) {
      console.error('[takeFreeField]', err)
      const detalle = err instanceof Error ? err.message : String(err)
      setError(`No se pudo registrar las labores en campo libre. ${detalle}`)
    } finally {
      setBusy(false)
    }
  }

  return {
    freeFieldForm,
    setFreeFieldForm,
    updateFreeFieldForm,
    freeFieldSuertesList,
    setFreeFieldSuertesList,
    toggleFreeFieldSuerte,
    freeFieldHaciendas,
    freeFieldSuertes,
    supervisors,
    takeFreeField,
  }
}
