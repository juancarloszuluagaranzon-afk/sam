import { useMemo, useState, type FormEvent } from 'react'
import { useAppData } from '../context/AppDataContext'
import type { Assignment, UpdateAssignmentInput } from '../domain/sam'
import { db } from '../lib/db'
import type { AssignmentFormState } from '../views/SupervisorView'
import { createAssignment as apiCreateAssignment, loadAssignments, updateAssignment } from '../services/samApi'
import { findReusableAssignment, isSameCycle } from '../utils/suerteCycle'

function normalizeText(value: string) {
  return value.trim().toUpperCase()
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null) {
    const obj = err as Record<string, unknown>
    const msg = typeof obj.message === 'string' ? obj.message : ''
    const code = typeof obj.code === 'string' ? ` (${obj.code})` : ''
    if (msg) return `${msg}${code}`
    try { return JSON.stringify(err) } catch { return String(err) }
  }
  return String(err)
}

function getRemainingArea(
  assignments: Assignment[],
  suerteCode: string,
  labor: string,
  totalArea: number,
  todayKey: string,
): number {
  const executed = assignments
    .filter(
      (a) =>
        a.suerteCode === suerteCode &&
        normalizeText(a.labor) === normalizeText(labor) &&
        // Solo descontar avance del CICLO ACTUAL (ventana de dias respecto a
        // hoy): un re-laboreo meses despues arranca con el area completa; un
        // avance reciente del mismo ciclo (otro operario en campo) si se resta.
        isSameCycle(a.dateKey, todayKey) &&
        // Una PARCIAL ya consumio su executedArea aunque siga activa.
        (a.status === 'COMPLETADA' || a.status === 'PARCIAL'),
    )
    .reduce((sum, a) => sum + (a.executedArea ?? 0), 0)
  return Math.max(0, totalArea - executed)
}

function generateTempId() {
  return `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * True si el operario ya esta TRABAJANDO esa suerte+labor (EN_PROCESO o
 * PARCIAL): debe continuarla desde "Activas", no tomarla otra vez. Una
 * PENDIENTE NO bloquea aqui: se REUSA (ver findReusableAssignment) para no
 * dejar la suerte programada dos veces.
 */
function hasActiveDuplicate(
  assignments: Assignment[],
  suerteCode: string,
  labor: string,
  operatorId: string,
): boolean {
  if (!operatorId) return false
  return assignments.some(
    (a) =>
      a.suerteCode === suerteCode &&
      normalizeText(a.labor) === normalizeText(labor) &&
      a.operatorId === operatorId &&
      // Una labor LIBERADA no cuenta como "activa" para bloquear: justamente
      // el operario la solto y puede querer retomar el restante en campo.
      !a.liberada &&
      (a.status === 'EN_PROCESO' || a.status === 'PARCIAL'),
  )
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

    if (!operator || !equipmentItem || !freeFieldForm.labor) {
      setError('Completa labor y equipo para tomar campo libre.')
      return
    }

    const selectedSupervisor = supervisors.find((s) => s.id === freeFieldForm.supervisorId)
    if (!selectedSupervisor) {
      setError('Selecciona el supervisor que aprobará la labor.')
      return
    }

    // Cliente y zona ya NO los pone el operario al tomar en campo: el supervisor
    // los diligencia OBLIGATORIAMENTE al aprobar. Se crean en null.
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
          todayKey,
        ) === 0,
    )
    if (suertesCompletas.length > 0) {
      setError(
        `La labor "${freeFieldForm.labor}" ya está completamente ejecutada en: ${suertesCompletas.map((r) => r.suerte).join(', ')}. No hay área pendiente.`,
      )
      return
    }

    // No permitir tomar dos veces la misma labor en la misma suerte para
    // el mismo operario: debe continuar la activa desde "Activas" en
    // lugar de crear una nueva.
    const duplicateSuertes = maestroRows.filter((row) =>
      hasActiveDuplicate(
        assignments,
        `${row.haciendaCode}-${row.suerte}`,
        freeFieldForm.labor,
        operator.id,
      ),
    )
    if (duplicateSuertes.length > 0) {
      setError(
        `Ya tienes una labor "${freeFieldForm.labor}" activa en: ${duplicateSuertes.map((r) => r.suerte).join(', ')}. Continuala desde "Activas".`,
      )
      return
    }

    setBusy(true)
    setError('')

    try {
      const now = new Date().toISOString()
      // Por cada suerte decidimos: REUSAR la PENDIENTE existente (la misma linea
      // original, vencida o no) o CREAR una nueva. Asi una suerte nunca queda
      // programada dos veces. Al reusar reiniciamos createdAt → vuelve a contar
      // como "programada hoy" y reaparece en Activas.
      const usedReusableIds = new Set<string>()
      const plan = maestroRows.map((maestroRow) => {
        const suerteCode = `${maestroRow.haciendaCode}-${maestroRow.suerte}`
        const area = getRemainingArea(assignments, suerteCode, freeFieldForm.labor, maestroRow.area, todayKey)
        const reusable = findReusableAssignment(assignments, suerteCode, freeFieldForm.labor, usedReusableIds)
        if (reusable) usedReusableIds.add(reusable.id)
        return { maestroRow, suerteCode, area, reusable }
      })
      const reusedCount = plan.filter((p) => p.reusable).length

      if (!isOnline) {
        const newLocals: Assignment[] = []
        const reusedLocals = new Map<string, Assignment>()

        for (const { maestroRow, suerteCode, area, reusable } of plan) {
          if (reusable) {
            const updatePayload: UpdateAssignmentInput = {
              operatorId: operator.id,
              operatorName: operator.name,
              supervisorId: selectedSupervisor.id,
              supervisorName: selectedSupervisor.name,
              equipmentCode: equipmentItem.code,
              equipmentName: equipmentItem.name,
              notes: freeFieldForm.notes,
              approval: 'PENDIENTE',
              approvedBy: null,
              approvedAt: null,
              liberada: false,
              createdAt: now,
            }
            await db.outbox.add({ type: 'UPDATE', assignmentId: reusable.id, updatePayload, queuedAt: now, status: 'pending' })
            const updated: Assignment = {
              ...reusable,
              operatorId: operator.id,
              operatorName: operator.name,
              supervisorId: selectedSupervisor.id,
              equipmentCode: equipmentItem.code,
              equipmentName: equipmentItem.name,
              notes: freeFieldForm.notes,
              approval: 'PENDIENTE',
              approvedBy: null,
              approvedAt: null,
              liberada: false,
              createdAt: now,
              dateKey: todayKey,
            }
            await db.assignments.put(updated)
            reusedLocals.set(updated.id, updated)
          } else {
            const tempId = generateTempId()
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
              cliente: undefined,
              kind: 'LIBRE',
              initialStatus: 'PENDIENTE',
              approval: 'PENDIENTE',
              zone: null,
            }
            const local: Assignment = {
              id: tempId,
              createdAt: now,
              dateKey: todayKey,
              haciendaCode: maestroRow.haciendaCode,
              haciendaName: maestroRow.haciendaName,
              suerte: maestroRow.suerte,
              suerteCode,
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
              cliente: undefined,
              approval: 'PENDIENTE',
              approvedBy: null,
              approvedAt: null,
              zone: null,
            }
            await db.outbox.add({ type: 'CREATE', createInput, tempId, queuedAt: now, status: 'pending' })
            await db.assignments.put(local)
            newLocals.push(local)
          }
        }

        setAssignments((current) => [
          ...newLocals,
          ...current.map((a) => reusedLocals.get(a.id) ?? a),
        ])
        setOutboxCount((c) => c + plan.length)
        setInfo(
          `${plan.length} labor(es) registradas localmente. Se sincronizaran al recuperar senal.`,
        )
      } else {
        await Promise.all(
          plan.map(({ maestroRow, area, reusable }) => {
            if (reusable) {
              return updateAssignment(reusable.id, {
                operatorId: operator.id,
                operatorName: operator.name,
                supervisorId: selectedSupervisor.id,
                supervisorName: selectedSupervisor.name,
                equipmentCode: equipmentItem.code,
                equipmentName: equipmentItem.name,
                notes: freeFieldForm.notes,
                approval: 'PENDIENTE',
                approvedBy: null,
                approvedAt: null,
                liberada: false,
                createdAt: now,
              })
            }
            return apiCreateAssignment({
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
              cliente: undefined,
              kind: 'LIBRE',
              initialStatus: 'PENDIENTE',
              approval: 'PENDIENTE',
              zone: null,
            })
          }),
        )
        await refreshAssignments()
        setInfo(
          reusedCount > 0
            ? `${plan.length} labor(es) tomadas en campo (${reusedCount} reutilizada(s) de la programacion existente).`
            : `${plan.length} labor(es) tomadas en campo libre.`,
        )
      }

      const savedEquipment = freeFieldForm.equipmentCode || session.equipmentCode
      setFreeFieldForm({ ...EMPTY_FORM, equipmentCode: savedEquipment })
      setFreeFieldSuertesList([])
      options?.onFreeFieldTaken?.()
    } catch (err) {
      console.error('[takeFreeField]', err)
      setError(`No se pudo registrar las labores en campo libre. ${formatError(err)}`)
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
