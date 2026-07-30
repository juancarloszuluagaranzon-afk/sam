import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  loadHorometros, loadHorometrosDudosos, loadProveedores, loadPlanes,
  loadOrdenes, loadEquiposActivo, type EquipoActivo,
} from '../../services/tallerApi'
import { loadBodegas } from '../../services/samApi'
import type {
  EquipoHorometro, HorometroDudoso, Proveedor, MttoPlan, OrdenTrabajo, Bodega,
} from '../../domain/sam'

/**
 * Datos compartidos del taller.
 *
 * Las siete pestañas leen casi lo mismo (horómetros, planes, órdenes) y sin esto
 * cada una dispararía sus propias consultas al montarse: cambiar de pestaña
 * recargaría todo otra vez. Se carga una vez y `refrescar()` lo actualiza
 * después de cualquier escritura.
 */
interface TallerCtx {
  horometros: EquipoHorometro[]
  /** Índice código → horas, que es como se consulta el 90 % de las veces. */
  horasDe: Map<string, number>
  dudosos: HorometroDudoso[]
  proveedores: Proveedor[]
  planes: MttoPlan[]
  ordenes: OrdenTrabajo[]
  activos: EquipoActivo[]
  bodegaTaller: Bodega | null
  cargando: boolean
  refrescar: () => Promise<void>
}

const Ctx = createContext<TallerCtx | null>(null)

export function TallerProvider({ children }: { children: ReactNode }) {
  const [horometros, setHorometros] = useState<EquipoHorometro[]>([])
  const [dudosos, setDudosos] = useState<HorometroDudoso[]>([])
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [planes, setPlanes] = useState<MttoPlan[]>([])
  const [ordenes, setOrdenes] = useState<OrdenTrabajo[]>([])
  const [activos, setActivos] = useState<EquipoActivo[]>([])
  const [bodegaTaller, setBodegaTaller] = useState<Bodega | null>(null)
  const [cargando, setCargando] = useState(true)

  const refrescar = useCallback(async () => {
    setCargando(true)
    try {
      const [h, d, p, pl, o, a, b] = await Promise.all([
        loadHorometros(), loadHorometrosDudosos(), loadProveedores(),
        loadPlanes(), loadOrdenes({ limit: 500 }), loadEquiposActivo(), loadBodegas(),
      ])
      setHorometros(h); setDudosos(d); setProveedores(p)
      setPlanes(pl); setOrdenes(o); setActivos(a)
      setBodegaTaller(b.find((x) => x.tipo === 'TALLER') ?? null)
    } finally { setCargando(false) }
  }, [])

  useEffect(() => { void refrescar() }, [refrescar])

  const horasDe = useMemo(() => {
    const m = new Map<string, number>()
    horometros.forEach((h) => m.set(h.codigo, h.horometro))
    return m
  }, [horometros])

  const value = useMemo<TallerCtx>(
    () => ({ horometros, horasDe, dudosos, proveedores, planes, ordenes, activos, bodegaTaller, cargando, refrescar }),
    [horometros, horasDe, dudosos, proveedores, planes, ordenes, activos, bodegaTaller, cargando, refrescar],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useTaller(): TallerCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useTaller fuera de TallerProvider')
  return c
}
