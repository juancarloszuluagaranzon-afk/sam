import { useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import type { Assignment } from '../domain/sam'
import { db } from '../lib/db'
import { loadAssignments, updateAssignment } from '../services/samApi'

type FinishDraft = { area: string; notes: string; horometroFinal: string; isComplete: boolean }

function formatArea(value: number) {
  return `${value.toFixed(2)} ha`
}

export function useAssignmentActions() {
  const {
    session,
    equipment,
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

  async function refreshAssignments() {
    const result = await loadAssignments()
    setAssignments(result.data)
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
        await updateAssignment(assignment.id, startPayload)
        await refreshAssignments()
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
    const executedArea = isComplete ? assignment.area : Number(draft?.area ?? '')

    if (!executedArea || executedArea <= 0) {
      setError('Ingresa las hectareas ejecutadas antes de finalizar.')
      return
    }
    if (!isComplete && executedArea > assignment.area) {
      setError(
        `El area ejecutada no puede superar el area de la suerte (${formatArea(assignment.area)}).`,
      )
      return
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

    const finishPayload = {
      status: 'COMPLETADA' as const,
      finishedAt: new Date().toISOString(),
      executedArea,
      notes: draft?.notes ?? assignment.notes,
      horometroFinal,
    }

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
              ? { ...a, status: 'COMPLETADA', finishedAt: finishPayload.finishedAt, executedArea }
              : a,
          ),
        )
        void db.assignments.update(assignment.id, {
          status: 'COMPLETADA',
          finishedAt: finishPayload.finishedAt,
          executedArea,
        })
        setOutboxCount((c) => c + 1)
        setInfo(`Labor finalizada (sin conexion, se sincronizara al recuperar senal).`)
      } else {
        await updateAssignment(assignment.id, finishPayload)
        await refreshAssignments()
        setInfo(`Labor finalizada: ${assignment.labor}.`)
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
        await updateAssignment(assignment.id, { status: 'CANCELADA' })
        setInfo(`Asignacion cancelada: ${assignment.labor}.`)
        await refreshAssignments()
      }
    } catch {
      setError('No se pudo cancelar la asignacion.')
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
  }
}
