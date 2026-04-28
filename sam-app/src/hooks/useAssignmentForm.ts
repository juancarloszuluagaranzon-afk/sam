import { useMemo, useState, type FormEvent } from 'react'
import { useAppData } from '../context/AppDataContext'
import type { Assignment } from '../domain/sam'
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

function isSupervisorOrOwner(role: string | undefined): boolean {
  return role === 'supervisor' || role === 'owner' || role === 'administracion'
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
  onAssignmentCreated?: () => void
}

export function useAssignmentForm(options?: Options) {
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
  } = useAppData()

  const [assignmentForm, setAssignmentForm] = useState<AssignmentFormState>(EMPTY_FORM)
  const [assignmentSuertesList, setAssignmentSuertesList] = useState<string[]>([])

  const assignmentHaciendas = useMemo(() => {
    const map = new Map<string, string>()
    maestro.forEach((row) => {
      if (assignmentForm.ingenioId && row.ingenio_id !== assignmentForm.ingenioId) return
      if (!map.has(row.haciendaCode)) map.set(row.haciendaCode, row.haciendaName)
    })
    return Array.from(map.entries()).map(([code, name]) => ({ code, name }))
  }, [maestro, assignmentForm.ingenioId])

  const assignmentSuertes = useMemo(
    () => maestro.filter((row) => row.haciendaCode === assignmentForm.haciendaCode),
    [maestro, assignmentForm.haciendaCode],
  )

  async function refreshAssignments() {
    const result = await loadAssignments()
    setAssignments(result.data)
  }

  function updateAssignmentForm(field: keyof AssignmentFormState, value: string) {
    setAssignmentForm((current) => {
      if (field === 'cliente') {
        setAssignmentSuertesList([])
        return { ...current, cliente: value, ingenioId: '', haciendaCode: '', suerte: '' }
      }
      if (field === 'ingenioId') {
        setAssignmentSuertesList([])
        return { ...current, ingenioId: value, haciendaCode: '', suerte: '' }
      }
      if (field === 'haciendaCode') {
        setAssignmentSuertesList([])
        return { ...current, haciendaCode: value, suerte: '' }
      }
      return { ...current, [field]: value }
    })
  }

  function toggleAssignmentSuerte(suerte: string) {
    setAssignmentSuertesList((current) =>
      current.includes(suerte) ? current.filter((s) => s !== suerte) : [...current, suerte],
    )
  }

  function prefillAssignmentForm(haciendaCode: string, suerte: string, labor: string) {
    setAssignmentForm({ ...EMPTY_FORM, haciendaCode, labor })
    setAssignmentSuertesList([suerte])
  }

  async function createAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session || !isSupervisorOrOwner(session.role)) return

    if (assignmentSuertesList.length === 0) {
      setError('Selecciona al menos una suerte.')
      return
    }

    const operator = operators.find((item) => item.id === assignmentForm.operatorId)
    const equipmentItem = equipment.find((item) => item.code === assignmentForm.equipmentCode)

    if (!operator || !equipmentItem || !assignmentForm.labor || !assignmentForm.cliente) {
      setError('Completa labor, operador, equipo y cliente.')
      return
    }

    if (assignmentForm.zone !== 'NORTE' && assignmentForm.zone !== 'SUR') {
      setError('Selecciona la zona (Norte o Sur).')
      return
    }
    const zone = assignmentForm.zone

    const operator2 = assignmentForm.operatorId2
      ? operators.find((item) => item.id === assignmentForm.operatorId2)
      : null
    const equipmentItem2 = assignmentForm.equipmentCode2
      ? equipment.find((item) => item.code === assignmentForm.equipmentCode2)
      : null

    if (
      (assignmentForm.operatorId2 && !equipmentItem2) ||
      (!assignmentForm.operatorId2 && assignmentForm.equipmentCode2)
    ) {
      setError('Si asignas un segundo par, completa tanto operador 2 como equipo 2.')
      return
    }

    const maestroRows = assignmentSuertesList
      .map((suerte) =>
        maestro.find(
          (row) => row.haciendaCode === assignmentForm.haciendaCode && row.suerte === suerte,
        ),
      )
      .filter((row): row is NonNullable<typeof row> => row !== undefined)

    const suertesCompletas = maestroRows.filter(
      (row) =>
        getRemainingArea(
          assignments,
          `${row.haciendaCode}-${row.suerte}`,
          assignmentForm.labor,
          row.area,
        ) === 0,
    )
    if (suertesCompletas.length > 0) {
      setError(
        `La labor "${assignmentForm.labor}" ya está completamente ejecutada en: ${suertesCompletas.map((r) => r.suerte).join(', ')}. Solo se puede programar si hay área pendiente.`,
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
            assignmentForm.labor,
            maestroRow.area,
          )
          const createInput: Parameters<typeof apiCreateAssignment>[0] = {
            haciendaCode: maestroRow.haciendaCode,
            haciendaName: maestroRow.haciendaName,
            suerte: maestroRow.suerte,
            labor: assignmentForm.labor,
            area,
            supervisorId: session.id,
            supervisorName: session.name,
            operatorId: operator.id,
            operatorName: operator.name,
            equipmentCode: equipmentItem.code,
            equipmentName: equipmentItem.name,
            notes: assignmentForm.notes,
            cliente: assignmentForm.cliente as 'ingenios' | 'proveedores',
            kind: 'ASIGNADA',
            initialStatus: 'PENDIENTE',
            approval: 'APROBADA',
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
            labor: assignmentForm.labor,
            area,
            status: 'PENDIENTE',
            operatorId: operator.id,
            operatorName: operator.name,
            supervisorId: session.id,
            equipmentCode: equipmentItem.code,
            equipmentName: equipmentItem.name,
            startedAt: null,
            finishedAt: null,
            executedArea: 0,
            notes: assignmentForm.notes,
            kind: 'ASIGNADA',
            horometroInicial: null,
            horometroFinal: null,
            cliente: assignmentForm.cliente as 'ingenios' | 'proveedores',
            approval: 'APROBADA',
            approvedBy: session.id,
            approvedAt: now,
            zone,
          }
          await db.outbox.add({ type: 'CREATE', createInput, tempId, queuedAt: now, status: 'pending' })
          await db.assignments.put(local)
          localAssignments.push(local)
        }

        setAssignments((current) => [...localAssignments, ...current])
        setOutboxCount((c) => c + maestroRows.length)
        setInfo(
          `${maestroRows.length} asignacion(es) creadas localmente. Se sincronizaran al recuperar senal.`,
        )
      } else {
        const buildInputs = (op: typeof operator, eq: typeof equipmentItem) =>
          maestroRows.map((maestroRow) => ({
            haciendaCode: maestroRow.haciendaCode,
            haciendaName: maestroRow.haciendaName,
            suerte: maestroRow.suerte,
            labor: assignmentForm.labor,
            area: getRemainingArea(
              assignments,
              `${maestroRow.haciendaCode}-${maestroRow.suerte}`,
              assignmentForm.labor,
              maestroRow.area,
            ),
            supervisorId: session.id,
            supervisorName: session.name,
            operatorId: op.id,
            operatorName: op.name,
            equipmentCode: eq.code,
            equipmentName: eq.name,
            notes: assignmentForm.notes,
            cliente: assignmentForm.cliente as 'ingenios' | 'proveedores',
            kind: 'ASIGNADA',
            initialStatus: 'PENDIENTE' as const,
            approval: 'APROBADA' as const,
            zone,
          }))

        const allInputs = [
          ...buildInputs(operator, equipmentItem),
          ...(operator2 && equipmentItem2 ? buildInputs(operator2, equipmentItem2) : []),
        ]
        await Promise.all(allInputs.map((input) => apiCreateAssignment(input)))
        await refreshAssignments()
        const pares = operator2 && equipmentItem2 ? 2 : 1
        setInfo(
          `${maestroRows.length * pares} asignacion(es) creadas (${pares} par(es) operador-equipo).`,
        )
      }

      setAssignmentForm(EMPTY_FORM)
      setAssignmentSuertesList([])
      options?.onAssignmentCreated?.()
    } catch (err) {
      console.error('[createAssignment]', err)
      setError('No se pudo crear las asignaciones.')
    } finally {
      setBusy(false)
    }
  }

  return {
    assignmentForm,
    setAssignmentForm,
    updateAssignmentForm,
    assignmentSuertesList,
    toggleAssignmentSuerte,
    assignmentHaciendas,
    assignmentSuertes,
    prefillAssignmentForm,
    createAssignment,
  }
}
