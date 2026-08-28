import { useState } from 'react'
import { useAppData } from '../context/AppDataContext'
import type { Assignment, Zone } from '../domain/sam'
import { db } from '../lib/db'
import { updateAssignment, createAssignment, executionDateKey, createLaborSesion } from '../services/samApi'
import { isSameCycle } from '../utils/suerteCycle'
import { unidadDeLabor } from '../lib/texto'

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
    todayKey,
    supervisors,
    maestro,
  } = useAppData()

  /**
   * Área REAL de la suerte, según el maestro del ingenio.
   *
   * 🔴 Antes se usaba el MÁXIMO de las áreas planificadas del ciclo como proxy.
   * Eso funciona cuando la suerte se programa entera y se ejecuta en varios
   * parciales (cada fila nace con el área completa), pero **falla cuando la
   * suerte se reparte en pedazos**: en EL REFLEJO 040 (6,82 ha) el DESPEJE se
   * programó 3,10 + 3,72 — el máximo daba 3,72 y el tope quedaba en la mitad
   * del área real, impidiendo registrar lo que de verdad se hizo.
   *
   * ⚠️ Se busca por NOMBRE de hacienda, no por código: hay códigos compartidos
   * entre haciendas distintas (ver `project_maestro_codigo_compartido`).
   */
  /**
   * 🔴 El tope del maestro NO aplica a las labores que se miden en HECTÓMETROS.
   *
   * ACEQUIAS es longitud: se abren tantos hectómetros de zanja dentro de una
   * suerte de tantas hectáreas. Son **dimensiones distintas** y compararlas no
   * significa nada — una suerte de 5,9 ha puede llevar 12 hm de acequia sin que
   * eso tenga nada de raro. Topar lo uno con lo otro le impediría al operario
   * registrar lo que de verdad hizo, que es el peor error posible aquí: con esto
   * se le paga.
   */
  function tieneTopeDeArea(a: Assignment): boolean {
    return unidadDeLabor(a.labor) === 'ha'
  }

  function areaOficialSuerte(a: Assignment): number | null {
    const suerte = a.suerte.trim().toUpperCase()
    const hacienda = a.haciendaName.trim().toUpperCase()
    const fila = maestro.find(
      (m) => m.suerte.trim().toUpperCase() === suerte && m.haciendaName.trim().toUpperCase() === hacienda,
    )
    return fila && fila.area > 0 ? fila.area : null
  }

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
      // Re-inicio de una PARCIAL: el cierre anterior (finishedAt + horómetro
      // final) pertenece a la sesión previa ya cerrada. Lo limpiamos para abrir
      // una sesión nueva; el avance acumulado (executedArea) se conserva intacto.
      // Para un inicio fresco (PENDIENTE) estos ya venían en null, así que es inocuo.
      finishedAt: null,
      horometroFinal: null,
    }

    // Continuación de una PARCIAL trabajada en un día ANTERIOR: en vez de
    // sobrescribir esa fila (lo que "movía" la porción de ayer a hoy), CONGELA
    // la entrada anterior (queda con su porción en SU fecha) y crea una entrada
    // NUEVA para hoy. Cada día queda en su día y se agrupan por ciclo (como ya
    // pasa entre dos operarios). Solo online; offline cae al flujo normal.
    const isCrossDayContinuation =
      assignment.status === 'PARCIAL' &&
      (assignment.executedArea ?? 0) > 0 &&
      executionDateKey(assignment) !== todayKey

    if (isCrossDayContinuation && isOnline) {
      try {
        // 1. Congela ayer: COMPLETADA conserva su executedArea y su fecha_fin.
        const frozen = await updateAssignment(assignment.id, { status: 'COMPLETADA' })
        // 2. Entrada nueva de HOY para la misma suerte+labor (se agrupa por ciclo).
        const supName = supervisors.find((s) => s.id === assignment.supervisorId)?.name ?? ''
        const created = await createAssignment({
          haciendaCode: assignment.haciendaCode,
          haciendaName: assignment.haciendaName,
          suerte: assignment.suerte,
          labor: assignment.labor,
          area: assignment.area,
          supervisorId: assignment.supervisorId,
          supervisorName: supName,
          operatorId: assignment.operatorId,
          operatorName: assignment.operatorName,
          equipmentCode: selectedEquipment.code,
          equipmentName: selectedEquipment.name,
          notes: assignment.notes,
          cliente: assignment.cliente,
          kind: assignment.kind,
          initialStatus: 'EN_PROCESO',
          startedAt: startPayload.startedAt,
          approval: 'APROBADA',
          zone: assignment.zone,
        })
        // 3. Horómetro inicial de la sesión de hoy en la fila nueva.
        const withHoro = await updateAssignment(created.id, { horometroInicial })
        setAssignments((cur) => [withHoro, ...cur.map((a) => (a.id === assignment.id ? frozen : a))])
        void db.assignments.put(frozen)
        void db.assignments.put(withHoro)
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
        setInfo('Continúas en una entrada nueva de hoy. La del día anterior queda en su fecha.')
      } catch {
        setError('No se pudo continuar la labor en una entrada nueva.')
      } finally {
        setBusy(false)
      }
      return
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
                  horometroInicial,
                  finishedAt: null,
                  horometroFinal: null,
                }
              : a,
          ),
        )
        void db.assignments.update(assignment.id, {
          status: 'EN_PROCESO',
          startedAt: startPayload.startedAt,
          horometroInicial,
          finishedAt: null,
          horometroFinal: null,
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

    // Avance agregado de la suerte+labor en el MISMO CICLO entre todos los
    // operarios que trabajan dicha suerte. Si OP-A ya hizo 5 de 10 ha en el
    // ciclo, cuando OP-B finaliza solo puede registrar hasta 5 ha.
    //
    // El "ciclo" se agrupa con `isSameCycle` (ventana tolerante en dias), NO
    // con `dateKey` exacto: dos operarios que toman la misma suerte EN CAMPO
    // en dias distintos pertenecen al mismo ciclo y su avance debe sumarse
    // para cerrar la labor. Un re-laboreo meses despues queda fuera de la
    // ventana y sigue siendo un ciclo distinto (no mezcla historico).
    const normalizedLabor = assignment.labor.trim().toUpperCase()
    const suerteExecutedOthers = assignments
      .filter(
        (a) =>
          a.id !== assignment.id &&
          a.suerteCode === assignment.suerteCode &&
          a.labor.trim().toUpperCase() === normalizedLabor &&
          isSameCycle(a.dateKey, assignment.dateKey) &&
          (a.status === 'COMPLETADA' || a.status === 'PARCIAL'),
      )
      .reduce((sum, a) => sum + (a.executedArea ?? 0), 0)
    const ownExecuted = assignment.executedArea ?? 0

    // Area TOTAL de la suerte en el ciclo. La primera toma (o la ASIGNADA)
    // lleva el area completa; una RE-TOMA posterior del restante lleva solo
    // lo que faltaba (ej: 7.32 tras liberar un parcial de 12.20). Usar
    // `assignment.area` directo en ese caso restaria dos veces lo ya hecho
    // y el cap quedaria en 0 (el operario no podria registrar nada). Tomamos
    // el MAX de las areas del ciclo = area completa real de la suerte.
    // Mismo criterio que en la edicion: el area OFICIAL del maestro manda. El
    // maximo del ciclo solo sirve de respaldo, y se queda corto cuando la
    // suerte se programo en pedazos en vez de entera.
    const suerteTotalArea =
      areaOficialSuerte(assignment) ??
      Math.max(
        assignment.area,
        ...assignments
          .filter(
            (a) =>
              a.suerteCode === assignment.suerteCode &&
              a.labor.trim().toUpperCase() === normalizedLabor &&
              isSameCycle(a.dateKey, assignment.dateKey) &&
              a.status !== 'CANCELADA',
          )
          .map((a) => a.area),
      )
    const suerteRemaining = Math.max(
      0,
      suerteTotalArea - (suerteExecutedOthers + ownExecuted),
    )

    // isOwnContinuation: el operario ya habia registrado avance propio
    // antes (asignacion en estado PARCIAL con executedArea > 0). En ese
    // caso el input del form es el DELTA de esta sesion (se suma al previo).
    // Si no, el input es el aporte total de esta sesion (reemplaza).
    const isOwnContinuation = ownExecuted > 0
    const sessionMax = suerteRemaining
    const sessionDraftValue = Number(draft?.area ?? '')

    if (!sessionDraftValue && !isComplete) {
      setError(unidadDeLabor(assignment.labor) === 'hm'
        ? 'Ingresa los hectómetros ejecutados antes de finalizar.'
        : 'Ingresa las hectareas ejecutadas antes de finalizar.')
      return
    }
    if (!isComplete && tieneTopeDeArea(assignment) && sessionDraftValue > sessionMax + 0.001) {
      const cap = formatArea(sessionMax)
      setError(
        suerteExecutedOthers > 0
          ? `Otro operario ya avanzo en esta suerte. Solo puedes registrar hasta ${cap}.`
          : isOwnContinuation
            ? `Lo ejecutado en esta sesion no puede superar el restante (${cap}).`
            : `El area ejecutada no puede superar el area de la suerte (${cap}).`,
      )
      return
    }

    // Calculo del executedArea propio final:
    //   - toggle 100%: completa la suerte aportando todo el restante
    //   - continuando su propia parcial: suma al previo
    //   - primer aporte: el draft es el total propio
    let executedArea: number
    if (isComplete) {
      executedArea = ownExecuted + sessionMax
    } else if (isOwnContinuation) {
      executedArea = ownExecuted + sessionDraftValue
    } else {
      executedArea = sessionDraftValue
    }
    // Defensa final: el executedArea propio nunca debe exceder el ÁREA TOTAL de
    // la suerte (no el `assignment.area` crudo). En una RE-TOMA del restante la
    // fila nace con área reducida (ej. 7.32); usar assignment.area truncaba el
    // acumulado (12.20 + 7.32 → 7.32, perdiendo avance real). suerteTotalArea es
    // el MAX del ciclo, el área real de la suerte.
    if (executedArea > suerteTotalArea) {
      executedArea = suerteTotalArea
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
    //   - isComplete=true (toggle "100%") → COMPLETADA (operario decide cerrar)
    //   - executedArea propio >= area planificada → COMPLETADA
    //   - suerte completa por trabajo conjunto (this + others >= area)
    //     → COMPLETADA: cualquier operario que aporte para cerrar la suerte
    //     queda con su asignacion COMPLETADA, aunque su parte propia sea
    //     menor al area planificada individual.
    //   - en otro caso → PARCIAL (sigue activa).
    const eps = 0.001
    const suerteFullyDone = suerteExecutedOthers + executedArea + eps >= suerteTotalArea
    const isFullyDone =
      isComplete || executedArea + eps >= assignment.area || suerteFullyDone
    const finalStatus: 'COMPLETADA' | 'PARCIAL' = isFullyDone ? 'COMPLETADA' : 'PARCIAL'

    const finishPayload = {
      status: finalStatus,
      finishedAt: new Date().toISOString(),
      executedArea,
      notes: draft?.notes ?? assignment.notes,
      horometroFinal,
      // Toda labor FINALIZADA (parcial o completa) vuelve a "por aprobar": el
      // supervisor revisa el área ejecutada antes de que cuente para facturación.
      // Aplica a ASIGNADA y LIBRE. Si era APROBADA y el operario re-finaliza una
      // parcial, vuelve a PENDIENTE (hay área nueva que verificar).
      approval: 'PENDIENTE' as const,
      editadoPor: session?.id,
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
              ? { ...a, status: finalStatus, finishedAt: finishPayload.finishedAt, executedArea, approval: 'PENDIENTE' }
              : a,
          ),
        )
        void db.assignments.update(assignment.id, {
          status: finalStatus,
          finishedAt: finishPayload.finishedAt,
          executedArea,
          approval: 'PENDIENTE',
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
        // Registro INMUTABLE de la sesión: cada cierre/parcial = 1 fila en
        // labor_sesiones (fecha, horómetro inicial/final, horas, área). Es el
        // detalle "uno a uno" para trazabilidad de horómetros, horas-máquina y
        // eficiencias. No bloquea el cierre si falla (solo se loguea).
        const sessionArea = Math.max(0, Number((executedArea - ownExecuted).toFixed(2)))
        const horIni = assignment.horometroInicial
        const horas = horIni != null ? Number((horometroFinal - horIni).toFixed(2)) : null
        void createLaborSesion({
          asignacionId: assignment.id,
          suerteCodigo: assignment.suerteCode,
          numeroSuerte: assignment.suerte,
          nombreHacienda: assignment.haciendaName,
          laborNombre: assignment.labor,
          operadorId: assignment.operatorId,
          operadorNombre: assignment.operatorName,
          equipoCodigo: assignment.equipmentCode,
          equipoNombre: assignment.equipmentName,
          fecha: todayKey,
          horometroInicial: horIni ?? null,
          horometroFinal,
          horas,
          areaEjecutada: sessionArea,
        }).catch((e) => console.warn('[labor_sesiones] no se pudo registrar la sesión', e))
        setInfo(successMessage)
      }
      setFinishDrafts((current) => {
        const next = { ...current }
        delete next[assignment.id]
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo finalizar la labor.')
    } finally {
      setBusy(false)
    }
  }

  async function decideApproval(
    assignment: Assignment,
    decision: 'APROBADA' | 'RECHAZADA',
    // Datos que el supervisor diligencia al aprobar una labor de campo (cliente
    // y zona, que el operario ya no captura). Se mezclan en el mismo update.
    extra?: { cliente?: 'ingenios' | 'proveedores'; zone?: Zone | null },
  ) {
    if (!session) return
    // El supervisor asignado aprueba lo suyo; owner/administración pueden aprobar
    // cualquiera (supervisión global).
    const puedeAprobar =
      assignment.supervisorId === session.id ||
      session.role === 'owner' ||
      session.role === 'administracion'
    if (!puedeAprobar) {
      setError('Solo el supervisor asignado (o la administración) puede aprobar o rechazar esta labor.')
      return
    }

    setBusy(true)
    setError('')

    const now = new Date().toISOString()
    const payload: import('../domain/sam').UpdateAssignmentInput = {
      approval: decision,
      approvedBy: session.id,
      approvedAt: now,
      editadoPor: session.id,
    }
    // RECHAZAR = sacar la labor de TODA parte operativa: pasa a CANCELADA para
    // que NUNCA cuente como área realizada (todos los conteos ya excluyen
    // CANCELADA). La fila se conserva con approval=RECHAZADA → queda como
    // AUDITORÍA (se muestra "Rechazada", no "Cancelada") de que existió y se
    // rechazó. El área ejecutada se conserva solo como dato del reclamo.
    if (decision === 'RECHAZADA') payload.status = 'CANCELADA'
    // cliente/zona SOLO si el supervisor los diligenció. Antes se hacía spread
    // crudo de `extra`, así que `zone: null` PISABA una zona ya válida y la labor
    // se caía de los filtros de zona del Tablero/Resumen.
    if (extra?.cliente) payload.cliente = extra.cliente
    if (extra?.zone === 'NORTE' || extra?.zone === 'SUR') payload.zone = extra.zone

    try {
      if (!isOnline) {
        await db.outbox.add({
          type: 'UPDATE',
          assignmentId: assignment.id,
          updatePayload: payload,
          queuedAt: now,
          status: 'pending',
        })
        const localPatch: Partial<Assignment> = {
          approval: decision,
          approvedBy: session.id,
          approvedAt: now,
          ...(decision === 'RECHAZADA' ? { status: 'CANCELADA' as const } : {}),
          ...(extra ?? {}),
        }
        setAssignments((current) =>
          current.map((a) => (a.id === assignment.id ? { ...a, ...localPatch } : a)),
        )
        void db.assignments.update(assignment.id, localPatch)
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

  async function approveAssignment(
    assignment: Assignment,
    extra?: { cliente?: 'ingenios' | 'proveedores'; zone?: Zone | null },
  ) {
    return decideApproval(assignment, 'APROBADA', extra)
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

  // El operario "libera" (rechaza) una labor que no va a poder terminar.
  // NO cambia el status (un PARCIAL sigue PARCIAL, conservando su avance):
  // solo marca `liberada = true` para ocultarla de SUS Activas. La labor
  // sigue abierta para que el supervisor la reasigne/cancele o el propio
  // operario la retome en campo. No se pierde el area ya ejecutada.
  async function releaseAssignment(assignment: Assignment) {
    setBusy(true)
    setError('')

    try {
      if (!isOnline) {
        await db.outbox.add({
          type: 'UPDATE',
          assignmentId: assignment.id,
          updatePayload: { liberada: true },
          queuedAt: new Date().toISOString(),
          status: 'pending',
        })
        setAssignments((current) =>
          current.map((a) => (a.id === assignment.id ? { ...a, liberada: true } : a)),
        )
        void db.assignments.update(assignment.id, { liberada: true })
        setOutboxCount((c) => c + 1)
        setInfo('Labor liberada localmente. Se sincronizara al recuperar senal.')
      } else {
        const updated = await updateAssignment(assignment.id, { liberada: true })
        mergeUpdated(updated)
        setInfo(`Labor liberada: ${assignment.labor}. El supervisor podra reasignarla.`)
      }
    } catch {
      setError('No se pudo liberar la labor.')
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
    liberada?: boolean
    // Permite corregir la FECHA de ejecución (cuando el operario registró tarde):
    // mueve la labor al día correcto en la Planilla/Reporte.
    startedAt?: string | null
    finishedAt?: string | null
    // Al cambiar el ESTADO desde el Reporte, se ajusta la aprobación: pasar a
    // COMPLETADA/PARCIAL la deja PENDIENTE (cae en la bandeja del supervisor);
    // volver a PENDIENTE/EN_PROCESO la deja APROBADA (sale de la bandeja).
    approval?: 'APROBADA' | 'PENDIENTE' | 'RECHAZADA'
    approvedBy?: string | null
    approvedAt?: string | null
    editadoPor?: string
    facturaNumero?: string | null
  }

  async function editAssignment(assignment: Assignment, patch: EditPatch) {
    // Validacion basica
    if (patch.executedArea !== undefined) {
      if (isNaN(patch.executedArea) || patch.executedArea < 0) {
        setError('El area ejecutada debe ser un numero >= 0.')
        return false
      }
      // TOPE: el área ejecutada de una labor NO puede superar el RESTANTE de la
      // suerte en el ciclo = área real de la suerte − lo YA ejecutado por los
      // OTROS parciales de la misma labor+suerte. Sin restar los otros parciales,
      // dos parciales podían quedar cada uno ≤ suerte pero SUMAR más que la
      // suerte (p.ej. 15.51 + 13.74 = 29.25 sobre 26.22) → sobrepago. El cliente
      // reclamó exactamente esto (SAMAN LA VICTORIA 010, REENCALLE). El cierre
      // (finishAssignment) ya topa contra el restante; la edición topaba contra
      // el total y ese era el hueco.
      const normLabor = assignment.labor.trim().toUpperCase()
      const mismoCiclo = assignments.filter(
        (a) =>
          a.suerteCode === assignment.suerteCode &&
          a.labor.trim().toUpperCase() === normLabor &&
          isSameCycle(a.dateKey, assignment.dateKey) &&
          a.status !== 'CANCELADA',
      )
      // El área oficial manda; el máximo del ciclo es solo el respaldo para
      // cuando la suerte todavía no está en el maestro.
      const suerteTotalArea =
        areaOficialSuerte(assignment) ??
        Math.max(assignment.area, ...mismoCiclo.map((a) => a.area))
      // Ejecutado por los OTROS parciales/completadas del ciclo (no esta fila).
      const ejecOtros = mismoCiclo
        .filter((a) => a.id !== assignment.id && (a.status === 'COMPLETADA' || a.status === 'PARCIAL'))
        .reduce((s, a) => s + (a.executedArea ?? 0), 0)
      const restante = Math.max(0, suerteTotalArea - ejecOtros)
      // ⚠️ `tieneTopeDeArea`: las labores en hectómetros no se topan contra el
      // área de la suerte — son dimensiones distintas. Va aquí, en la condición,
      // y no como una salida temprana: salir de `editAssignment` antes de tiempo
      // se saltaría también el guardado y diría que guardó sin haber guardado.
      if (tieneTopeDeArea(assignment) && patch.executedArea > restante + 0.001) {
        setError(
          ejecOtros > 0
            ? `El área ejecutada (${patch.executedArea.toFixed(2)} ha) supera lo que queda de la suerte ${assignment.suerte}: otros parciales ya sumaron ${ejecOtros.toFixed(2)} de ${suerteTotalArea.toFixed(2)} ha, quedan ${restante.toFixed(2)} ha.`
            : `El área ejecutada (${patch.executedArea.toFixed(2)} ha) no puede superar el área de la suerte ${assignment.suerte} (${suerteTotalArea.toFixed(2)} ha). Si el área de la suerte cambió, corrige primero el área planificada.`,
        )
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
          !a.liberada &&
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
    // Auditoría: quién hace esta edición.
    if (session?.id) finalPatch.editadoPor = session.id

    // Reasignar a otro operario "des-libera" la labor: el nuevo operario
    // debe verla en SUS Activas para continuarla. Si seguia marcada como
    // liberada quedaria oculta tambien para el. (No tocar si el operario
    // no cambia, para no pisar el flag en ediciones normales.)
    if (patch.operatorId !== undefined && patch.operatorId !== assignment.operatorId) {
      finalPatch.liberada = false
    }

    // COHERENCIA estado↔área (blindaje central): una labor con área ejecutada
    // > 0 NO puede quedar PENDIENTE ("pendiente" pero con trabajo hecho es
    // contradictorio y confunde al cliente). Pasaba al editar las hectáreas
    // ejecutadas desde el historial sin cerrar la labor (updateAssignment
    // escribe columnas por separado). Si el RESULTADO tendría área>0 y estado
    // PENDIENTE, se promueve a COMPLETADA (si cubre el área) o PARCIAL, y se
    // estampa fecha de cierre si falta — así el trabajo real cuenta y el estado
    // deja de mentir. NO afecta EN_PROCESO (avance real en curso, legítimo).
    {
      const execResultante = finalPatch.executedArea !== undefined ? finalPatch.executedArea : assignment.executedArea
      const statusResultante = finalPatch.status ?? assignment.status
      if ((execResultante ?? 0) > 0 && statusResultante === 'PENDIENTE') {
        finalPatch.status = (execResultante ?? 0) + 0.001 >= assignment.area ? 'COMPLETADA' : 'PARCIAL'
        if (finalPatch.finishedAt == null && assignment.finishedAt == null) {
          finalPatch.finishedAt = new Date().toISOString()
        }
      }
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la asignacion.')
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
    releaseAssignment,
    approveAssignment,
    rejectAssignment,
    editAssignment,
  }
}
