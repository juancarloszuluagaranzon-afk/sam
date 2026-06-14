import { useMemo, useState, type FormEvent } from 'react'
import { useAppData } from '../context/AppDataContext'
import type { Assignment, Zone } from '../domain/sam'
import { db } from '../lib/db'
import type { AssignmentFormState } from '../views/SupervisorView'
import { createAssignment as apiCreateAssignment, loadAssignments, updateAssignment } from '../services/samApi'
import { isSameCycle } from '../utils/suerteCycle'

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
        // Solo el CICLO ACTUAL (ventana de dias respecto a hoy): un re-laboreo
        // meses despues arranca con el area completa disponible para asignar;
        // el avance reciente del mismo ciclo si se descuenta.
        isSameCycle(a.dateKey, todayKey) &&
        // Una PARCIAL ya "consumio" su executedArea de la suerte aunque
        // siga activa: si no contamos eso, otro operario podria asignarse
        // la totalidad nuevamente y duplicar area.
        (a.status === 'COMPLETADA' || a.status === 'PARCIAL'),
    )
    .reduce((sum, a) => sum + (a.executedArea ?? 0), 0)
  return Math.max(0, totalArea - executed)
}

/**
 * True si ya existe una asignacion ACTIVA (PENDIENTE / EN_PROCESO /
 * PARCIAL) con el mismo trio suerteCode + labor + operatorId.
 *
 * Cierres (COMPLETADA, CANCELADA) NO bloquean — la labor puede volver
 * a planearse en otra fecha o ciclo. Lo que bloqueamos es duplicar
 * trabajo activo: dos cards "Pendiente" identicas en la pestaña
 * Activas del operario, que ademas confunden al supervisor al revisar
 * el tablero.
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
      // Una labor LIBERADA no bloquea: el operario la solto a proposito; el
      // supervisor puede reasignarla limpiamente sin choque de "ya tiene una".
      !a.liberada &&
      (a.status === 'PENDIENTE' || a.status === 'EN_PROCESO' || a.status === 'PARCIAL'),
  )
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
    const zone: Zone = assignmentForm.zone

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
          todayKey,
        ) === 0,
    )
    if (suertesCompletas.length > 0) {
      setError(
        `La labor "${assignmentForm.labor}" ya está completamente ejecutada en: ${suertesCompletas.map((r) => r.suerte).join(', ')}. Solo se puede programar si hay área pendiente.`,
      )
      return
    }

    // No permitir duplicar una asignacion activa del mismo trio
    // suerte + labor + operador. Cubrimos los dos pares (operador 1
    // y operador 2 si esta presente).
    const duplicateSuertes: { suerte: string; operatorName: string }[] = []
    for (const row of maestroRows) {
      const suerteCode = `${row.haciendaCode}-${row.suerte}`
      if (hasActiveDuplicate(assignments, suerteCode, assignmentForm.labor, operator.id)) {
        duplicateSuertes.push({ suerte: row.suerte, operatorName: operator.name })
      }
      if (operator2 && hasActiveDuplicate(assignments, suerteCode, assignmentForm.labor, operator2.id)) {
        duplicateSuertes.push({ suerte: row.suerte, operatorName: operator2.name })
      }
    }
    if (duplicateSuertes.length > 0) {
      const detalle = duplicateSuertes
        .map((d) => `suerte ${d.suerte} a ${d.operatorName}`)
        .join('; ')
      setError(
        `Ya existe una asignacion activa de "${assignmentForm.labor}" para ${detalle}. Reasigna la existente desde Labores en lugar de crear una nueva.`,
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
            todayKey,
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
              todayKey,
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
      setError(`No se pudo crear las asignaciones. ${formatError(err)}`)
    } finally {
      setBusy(false)
    }
  }

  // Detección de duplicados: para las suertes seleccionadas + la labor, busca
  // asignaciones PENDIENTE nunca iniciadas (las "colgadas" reciclables). Si
  // existen, el form muestra una alerta para REUSARLAS en vez de crear nuevas
  // (evita saturar la base con duplicados).
  const reusableMatches = useMemo(() => {
    if (!assignmentForm.labor || assignmentSuertesList.length === 0) return []
    const out: { suerte: string; existing: Assignment }[] = []
    for (const suerte of assignmentSuertesList) {
      const suerteCode = `${assignmentForm.haciendaCode}-${suerte}`
      const existing = assignments.find(
        (a) =>
          a.suerteCode === suerteCode &&
          normalizeText(a.labor) === normalizeText(assignmentForm.labor) &&
          a.status === 'PENDIENTE' &&
          !a.startedAt &&
          (a.executedArea ?? 0) === 0 &&
          !a.liberada,
      )
      if (existing) out.push({ suerte, existing })
    }
    return out
  }, [assignments, assignmentForm.labor, assignmentForm.haciendaCode, assignmentSuertesList])

  // Reusa las pendientes existentes: las REASIGNA al operario/equipo del form
  // (un solo UPDATE por fila, NO crea filas nuevas). Reversible vía la edición
  // normal. No toca el flujo de creación.
  async function reuseExisting() {
    if (!session || !isSupervisorOrOwner(session.role)) return
    const matches = reusableMatches
    if (matches.length === 0) return
    const operator = operators.find((item) => item.id === assignmentForm.operatorId)
    const equipmentItem = equipment.find((item) => item.code === assignmentForm.equipmentCode)
    if (!operator || !equipmentItem || !assignmentForm.labor || !assignmentForm.cliente) {
      setError('Completa operador, equipo y cliente para reusar la existente.')
      return
    }
    if (assignmentForm.zone !== 'NORTE' && assignmentForm.zone !== 'SUR') {
      setError('Selecciona la zona (Norte o Sur).')
      return
    }
    const zone: Zone = assignmentForm.zone
    setBusy(true)
    setError('')
    try {
      await Promise.all(
        matches.map((m) =>
          updateAssignment(m.existing.id, {
            operatorId: operator.id,
            operatorName: operator.name,
            equipmentCode: equipmentItem.code,
            equipmentName: equipmentItem.name,
            cliente: assignmentForm.cliente as 'ingenios' | 'proveedores',
            zone,
          }),
        ),
      )
      await refreshAssignments()
      setInfo(`${matches.length} asignación(es) existente(s) reutilizada(s) y reasignada(s) a ${operator.name}.`)
      setAssignmentForm(EMPTY_FORM)
      setAssignmentSuertesList([])
      options?.onAssignmentCreated?.()
    } catch (err) {
      console.error('[reuseExisting]', err)
      setError(`No se pudo reusar la asignación. ${formatError(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return {
    reusableMatches,
    reuseExisting,
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
