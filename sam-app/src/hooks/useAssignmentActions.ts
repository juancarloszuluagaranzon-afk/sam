import { useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import type { Assignment } from '../domain/sam'
import { db } from '../lib/db'
import { updateAssignment } from '../services/samApi'

type FinishDraft = { area: string; notes: string; horometroFinal: string; isComplete: boolean }

function formatArea(value: number) {
  return `${value.toFixed(2)} ha`
}

export function useAssignmentActions() {
  const {
    session,
    equipment,
    assignments,
    setAssignments,
    isOnline,
    setOutboxCount,
    setInfo,
    setError,
    setBusy,
  } = useAppData()

  const [finishDrafts, setFinishDrafts] = useState<Record<string, FinishDraft>>({})
  const [startEquipmentDrafts, setStartEquipmentDrafts] = useState<Record<string, string>>({})
  const [startHorometroDrafts, setStartHorometroDrafts] = useState<Record<string, string>>({})

  function mergeUpdated(updated: Assignment) {
    setAssignments((current) => current.map((a) => (a.id === updated.id ? updated : a)))
    void db.assignments.put(updated)
  }

  async function startAssignment(assignment: Assignment) {
    const equipmentCode =
      startEquipmentDrafts[assignment.id] ||
      assignment.equipmentCode ||
      session?.equipmentCode ||
      ''
    const selectedEquipment = equipment.find((item) => item.code === equipmentCode)

    if (!selectedEquipment) {
      setError('Selecciona un equipo valido antes de iniciar la labor.')
      return
    }

    const horometroInicialRaw = startHorometroDrafts[assignment.id] ?? ''
    if (!horometroInicialRaw.trim()) {
      setError('Ingresa el horometro inicial antes de iniciar la labor.')
      return
    }
    const horometroInicial = Number(horometroInicialRaw)
    if (isNaN(horometroInicial) || horometroInicial < 0) {
      setError('El horometro inicial debe ser un numero valido.')
      return
    }

    setBusy(true)
    setError('')

    const startPayload = {
      status: 'EN_PROCESO' as const,
      startedAt: new Date().toISOString(),
      equipmentCode: selectedEquipment.code,
      equipmentName: selectedEquipment.name,
      horometroInicial,
    }

    try {
      if (!isOnline) {
        await db.outbox.add({
          type: 'UPDATE',
          assignmentId: assignment.id,
          updatePayload: startPayload,
          queuedAt: new Date().toISOString(),
          status: 'pending',
        })
        setAssignments((current) =>
          current.map((a) =>
            a.id === assignment.id
              ? {
                  ...a,
                  status: 'EN_PROCESO',
                  startedAt: startPayload.startedAt,
                  equipmentCode: selectedEquipment.code,
                  equipmentName: selectedEquipment.name,
                }
              : a,
          ),
        )
        void db.assignments.update(assignment.id, {
          status: 'EN_PROCESO',
          startedAt: startPayload.startedAt,
        })
        setOutboxCount((c) => c + 1)
        setInfo(`Labor iniciada (sin conexion, se sincronizara al recuperar senal).`)
      } else {
        const updated = await updateAssignment(assignment.id, startPayload)
        mergeUpdated(updated)
        setInfo(`Labor iniciada: ${assignment.labor}.`)
      }
      setStartEquipmentDrafts((current) => {
        const next = { ...current }
        delete next[assignment.id]
        return next
      })
      setStartHorometroDrafts((current) => {
        const next = { ...current }
        delete next[assignment.id]
        return next
      })
    } catch {
      setError('No se pudo iniciar la labor.')
    } finally {
      setBusy(false)
    }
  }

  async function finishAssignment(assignment: Assignment) {
    const draft = finishDrafts[assignment.id]
    const isComplete = draft?.isComplete ?? false
    const isPartialContinuation =
      assignment.status === 'PARCIAL' && assignment.executedArea > 0
    // El input del operario significa cosas distintas segun el estado:
    //   - PARCIAL: el delta de ESTA sesion (se suma al executedArea previo)
    //   - PENDIENTE/EN_PROCESO: el total ejecutado (reemplaza el previo)
    // Toggle "completada al 100%" siempre completa hasta area total.
    const remainingArea = Math.max(0, assignment.area - assignment.executedArea)
    const sessionMax = isPartialContinuation ? remainingArea : assignment.area
    const sessionDraftValue = Number(draft?.area ?? '')

    let executedArea: number
    if (isComplete) {
      executedArea = assignment.area
    } else if (isPartialContinuation) {
      executedArea = assignment.executedArea + sessionDraftValue
    } else {
      executedArea = sessionDraftValue
    }

    if (!sessionDraftValue && !isComplete) {
      setError('Ingresa las hectareas ejecutadas antes de finalizar.')
      return
    }
    if (!isComplete && sessionDraftValue > sessionMax) {
      const cap = formatArea(sessionMax)
      setError(
        isPartialContinuation
          ? `Lo ejecutado en esta sesion no puede superar el restante (${cap}).`
          : `El area ejecutada no puede superar el area de la suerte (${cap}).`,
      )
      return
    }
    // Defensa final: el total acumulado nunca debe exceder el area planificada
    if (executedArea > assignment.area) {
      executedArea = assignment.area
    }

    const horometroFinalRaw = draft?.horometroFinal ?? ''
    if (!horometroFinalRaw.trim()) {
      setError('Ingresa el horometro final antes de finalizar la labor.')
      return
    }
    const horometroFinal = Number(horometroFinalRaw)
    if (isNaN(horometroFinal) || horometroFinal < 0) {
      setError('El horometro final debe ser un numero valido.')
      return
    }

    setBusy(true)
    setError('')

    // Decision de status:
    //   - isComplete=true (toggle "100%") o executedArea >= area → COMPLETADA
    //   - executedArea < area → PARCIAL (sigue activa, operario u otro
    //     pueden continuarla luego). Capamos a un epsilon para evitar
    //     PARCIAL por redondeo.
    const eps = 0.001
    const isFullyDone = isComplete || executedArea + eps >= assignment.area
    const finalStatus: 'COMPLETADA' | 'PARCIAL' = isFullyDone ? 'COMPLETADA' : 'PARCIAL'

    const finishPayload = {
      status: finalStatus,
      finishedAt: new Date().toISOString(),
      executedArea,
      notes: draft?.notes ?? assignment.notes,
      horometroFinal,
    }

    const successMessage =
      finalStatus === 'COMPLETADA'
        ? `Labor finalizada: ${assignment.labor}.`
        : `Labor guardada como parcial: ${assignment.labor} (sigue activa para continuar).`

    try {
      if (!isOnline) {
        await db.outbox.add({
          type: 'UPDATE',
          assignmentId: assignment.id,
          updatePayload: finishPayload,
          queuedAt: new Date().toISOString(),
          status: 'pending',
        })
        setAssignments((current) =>
          current.map((a) =>
            a.id === assignment.id
              ? { ...a, status: finalStatus, finishedAt: finishPayload.finishedAt, executedArea }
              : a,
          ),
        )
        void db.assignments.update(assignment.id, {
          status: finalStatus,
          finishedAt: finishPayload.finishedAt,
          executedArea,
        })
        setOutboxCount((c) => c + 1)
        setInfo(
          finalStatus === 'COMPLETADA'
            ? `Labor finalizada (sin conexion, se sincronizara al recuperar senal).`
            : `Labor parcial guardada (sin conexion, se sincronizara al recuperar senal).`,
        )
      } else {
        const updated = await updateAssignment(assignment.id, finishPayload)
        mergeUpdated(updated)
        setInfo(successMessage)
      }
      setFinishDrafts((current) => {
        const next = { ...current }
        delete next[assignment.id]
        return next
      })
    } catch {
      setError('No se pudo finalizar la labor.')
    } finally {
      setBusy(false)
    }
  }

  async function decideApproval(assignment: Assignment, decision: 'APROBADA' | 'RECHAZADA') {
    if (!session) return
    if (assignment.supervisorId !== session.id) {
      setError('Solo el supervisor asignado puede aprobar o rechazar esta labor.')
      return
    }

    setBusy(true)
    setError('')

    const now = new Date().toISOString()
    const payload = {
      approval: decision,
      approvedBy: session.id,
      approvedAt: now,
    }

    try {
      if (!isOnline) {
        await db.outbox.add({
          type: 'UPDATE',
          assignmentId: assignment.id,
          updatePayload: payload,
          queuedAt: now,
          status: 'pending',
        })
        setAssignments((current) =>
          current.map((a) =>
            a.id === assignment.id
              ? { ...a, approval: decision, approvedBy: session.id, approvedAt: now }
              : a,
          ),
        )
        void db.assignments.update(assignment.id, {
          approval: decision,
          approvedBy: session.id,
          approvedAt: now,
        })
        setOutboxCount((c) => c + 1)
        setInfo(
          `Labor ${decision === 'APROBADA' ? 'aprobada' : 'rechazada'} (sin conexion, se sincronizara al recuperar senal).`,
        )
      } else {
        const updated = await updateAssignment(assignment.id, payload)
        mergeUpdated(updated)
        setInfo(
          `Labor ${decision === 'APROBADA' ? 'aprobada' : 'rechazada'}: ${assignment.labor}.`,
        )
      }
    } catch {
      setError(
        decision === 'APROBADA'
          ? 'No se pudo aprobar la labor.'
          : 'No se pudo rechazar la labor.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function approveAssignment(assignment: Assignment) {
    return decideApproval(assignment, 'APROBADA')
  }

  async function rejectAssignment(assignment: Assignment) {
    return decideApproval(assignment, 'RECHAZADA')
  }

  async function cancelAssignment(assignment: Assignment) {
    setBusy(true)
    setError('')

    try {
      if (!isOnline) {
        await db.outbox.add({
          type: 'UPDATE',
          assignmentId: assignment.id,
          updatePayload: { status: 'CANCELADA' },
          queuedAt: new Date().toISOString(),
          status: 'pending',
        })
        setAssignments((current) =>
          current.map((a) => (a.id === assignment.id ? { ...a, status: 'CANCELADA' } : a)),
        )
        void db.assignments.update(assignment.id, { status: 'CANCELADA' })
        setOutboxCount((c) => c + 1)
        setInfo(`Asignacion cancelada localmente. Se sincronizara al recuperar senal.`)
      } else {
        const updated = await updateAssignment(assignment.id, { status: 'CANCELADA' })
        mergeUpdated(updated)
        setInfo(`Asignacion cancelada: ${assignment.labor}.`)
      }
    } catch {
      setError('No se pudo cancelar la asignacion.')
    } finally {
      setBusy(false)
    }
  }

  type EditPatch = {
    executedArea?: number
    horometroInicial?: number | null
    horometroFinal?: number | null
    notes?: string
    equipmentCode?: string
    equipmentName?: string
    operatorId?: string
    operatorName?: string
    status?: 'PENDIENTE' | 'EN_PROCESO' | 'COMPLETADA' | 'CANCELADA' | 'PARCIAL'
  }

  async function editAssignment(assignment: Assignment, patch: EditPatch) {
    // Validacion basica
    if (patch.executedArea !== undefined) {
      if (isNaN(patch.executedArea) || patch.executedArea < 0) {
        setError('El area ejecutada debe ser un numero >= 0.')
        return false
      }
    }
    if (patch.horometroInicial != null && isNaN(patch.horometroInicial)) {
      setError('El horometro inicial debe ser un numero valido.')
      return false
    }
    if (patch.horometroFinal != null && isNaN(patch.horometroFinal)) {
      setError('El horometro final debe ser un numero valido.')
      return false
    }

    // Reasignacion: si el operator cambia, validar que el nuevo operario
    // no tenga ya una asignacion activa en la misma suerte + labor (de
    // lo contrario quedarian dos cards "Pendiente" identicas en su
    // pestaña Activas).
    if (patch.operatorId !== undefined && patch.operatorId !== assignment.operatorId) {
      const normalizedLabor = assignment.labor.trim().toUpperCase()
      const conflict = assignments.find(
        (a) =>
          a.id !== assignment.id &&
          a.suerteCode === assignment.suerteCode &&
          a.labor.trim().toUpperCase() === normalizedLabor &&
          a.operatorId === patch.operatorId &&
          (a.status === 'PENDIENTE' || a.status === 'EN_PROCESO' || a.status === 'PARCIAL'),
      )
      if (conflict) {
        setError(
          `Ese operario ya tiene una asignacion activa de "${assignment.labor}" en la suerte ${assignment.suerte}. Reasigna o cancela esa antes de mover esta.`,
        )
        return false
      }
    }

    setBusy(true)
    setError('')

    // Resolver nombre de equipo si solo se pasa codigo
    const finalPatch: EditPatch = { ...patch }
    if (patch.equipmentCode !== undefined && patch.equipmentName === undefined) {
      const eq = equipment.find((e) => e.code === patch.equipmentCode)
      if (eq) finalPatch.equipmentName = eq.name
    }

    try {
      if (!isOnline) {
        await db.outbox.add({
          type: 'UPDATE',
          assignmentId: assignment.id,
          updatePayload: finalPatch,
          queuedAt: new Date().toISOString(),
          status: 'pending',
        })
        setAssignments((current) =>
          current.map((a) => (a.id === assignment.id ? { ...a, ...finalPatch } : a)),
        )
        void db.assignments.update(assignment.id, finalPatch as Partial<Assignment>)
        setOutboxCount((c) => c + 1)
        setInfo(`Cambios guardados localmente. Se sincronizaran al recuperar senal.`)
      } else {
        const updated = await updateAssignment(assignment.id, finalPatch)
        mergeUpdated(updated)
        setInfo(`Asignacion actualizada.`)
      }
      return true
    } catch {
      setError('No se pudo actualizar la asignacion.')
      return false
    } finally {
      setBusy(false)
    }
  }

  return {
    finishDrafts,
    setFinishDrafts,
    startEquipmentDrafts,
    setStartEquipmentDrafts,
    startHorometroDrafts,
    setStartHorometroDrafts,
    startAssignment,
    finishAssignment,
    cancelAssignment,
    approveAssignment,
    rejectAssignment,
    editAssignment,
  }
}
