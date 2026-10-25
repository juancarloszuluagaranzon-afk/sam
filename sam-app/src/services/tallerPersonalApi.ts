import type { MarcacionFila, RespuestaMarcar, RostroRegistrado } from './asistenciaApi'
import type { ResultadoCamara } from '../components/CamaraRostro'
import { supabase } from '../lib/supabase'
import { aMayus } from '../lib/texto'
import { apodoDelAparato, ubicacion } from '../lib/biometria'
import { pinNuevo } from '../lib/quiosco'
import { createAppUser, deleteAppUser } from './samApi'
import { enrolarRostro, loadRostros, marcarOEncolar, mapMarcacion, revocarRostro } from './asistenciaApi'

/**
 * Personal del taller y quiosco de la entrada (25-oct-2026, pedido de Carlos David).
 *
 * Antes cada mecánico se tenía que registrar solo, en su celular: nadie lo hizo
 * (cero caras en la base). Ahora el JEFE da de alta a cada persona y le registra
 * la cara en persona, y la tableta fija de la entrada marca por todos.
 *
 * 🔴 Toda escritura pasa por funciones de la base (`app_create_user`,
 * `taller_guardar_personal`, `taller_enrolar_rostro`, `taller_marcar`…). El
 * cliente solo lee.
 */

/** Una persona del taller (usuario con rol `taller`) con lo que necesitan las dos pantallas. */
export interface Mecanico {
  id: string
  /** `nombre_completo`, en MAYÚSCULA. */
  nombre: string
  cedula?: string
  /** De `taller_personal`. */
  cargo?: string
  telefono?: string
  /** La cara vigente (activa), o null si no tiene. */
  rostro: RostroRegistrado | null
  /** La última marcación NO anulada de los últimos 14 días, o null. */
  ultima: MarcacionFila | null
}

/** El roster del quiosco, con de dónde salió (sin señal sale del espejo del aparato). */
export interface RosterQuiosco {
  mecanicos: Mecanico[]
  desdeCache: boolean
  /** ISO de la última vez que se trajo de la base. */
  actualizadoEn: string | null
}

/** Personal activo del taller, ordenado por nombre. Lee app_usuarios (columnas explícitas: nunca pin_hash). */
export async function loadPersonalTaller(): Promise<Mecanico[]> {
  const { data: usuarios, error } = await supabase.from('app_usuarios')
    .select('id,nombre_completo,rol,equipo_codigo,foto_url,cedula,zona,activo')
    .eq('rol', 'taller').eq('activo', true).order('nombre_completo')
  if (error) throw new Error(error.message)
  const ids = (usuarios ?? []).map((u) => String(u.id))
  const [fichas, rostros, marcas] = await Promise.all([
    supabase.from('taller_personal').select('*').in('usuario_id', ids),
    loadRostros(),
    ids.length ? supabase.from('taller_marcaciones').select('*').in('usuario_id', ids)
      .eq('anulada', false).gte('marcado_en', new Date(Date.now() - 14 * 86400000).toISOString())
      .order('marcado_en', { ascending: false }) : Promise.resolve({ data: [], error: null }),
  ])
  if (fichas.error) throw new Error(fichas.error.message)
  if (marcas.error) throw new Error(marcas.error.message)
  const porFicha = new Map((fichas.data ?? []).map((f) => [String(f.usuario_id), f]))
  // `loadRostros` viene de la más nueva a la más vieja: gana la PRIMERA de cada persona.
  const porRostro = new Map<string, RostroRegistrado>()
  for (const r of rostros) if (!porRostro.has(r.usuarioId)) porRostro.set(r.usuarioId, r)
  const porMarca = new Map<string, MarcacionFila>()
  for (const fila of (marcas.data ?? []) as Record<string, unknown>[]) {
    const m = mapMarcacion(fila)
    if (!porMarca.has(m.usuarioId)) porMarca.set(m.usuarioId, m)
  }
  return (usuarios ?? []).map((u) => {
    const id = String(u.id); const ficha = porFicha.get(id)
    return { id, nombre: String(u.nombre_completo ?? ''), cedula: u.cedula ? String(u.cedula) : undefined,
      cargo: ficha?.cargo ? String(ficha.cargo) : undefined, telefono: ficha?.telefono ? String(ficha.telefono) : undefined,
      rostro: porRostro.get(id) ?? null, ultima: porMarca.get(id) ?? null }
  })
}

/**
 * Da de alta a un mecánico: crea su usuario (rol `taller`) con un PIN de 4
 * dígitos al azar, guarda su ficha (cargo, teléfono) y lo devuelve con el PIN,
 * que la pantalla muestra UNA sola vez.
 * Errores con mensaje claro: nombre vacío, cédula vacía o con algo distinto de
 * dígitos, cédula repetida en otro usuario activo («Ya existe … con esa cédula»).
 */
export async function crearMecanico(
  datos: { nombre: string; cedula: string; cargo?: string; telefono?: string },
  quien: string,
): Promise<{ mecanico: Mecanico; pin: string }> {
  const nombreCompleto = aMayus(datos.nombre).replace(/\s+/g, ' ').trim()
  if (!nombreCompleto) throw new Error('Escribe el nombre del mecánico.')
  const cedula = datos.cedula.replace(/[.\s]/g, '')
  if (!/^\d{5,12}$/.test(cedula)) throw new Error('La cédula debe tener de 5 a 12 dígitos.')
  const { data: duplicado, error: errorDuplicado } = await supabase.from('app_usuarios')
    .select('id,nombre_completo,rol,equipo_codigo,foto_url,cedula,zona,activo').eq('cedula', cedula)
    .eq('activo', true).limit(1)
  if (errorDuplicado) throw new Error(errorDuplicado.message)
  if (duplicado?.length) throw new Error(`Ya existe ${duplicado[0].nombre_completo} (${duplicado[0].id}) con esa cédula.`)
  const pin = pinNuevo()
  await createAppUser({ id: 'NUEVO', nombreCompleto, rol: 'taller', pin, equipoCodigo: '', cedula })
  const { data: creado, error } = await supabase.from('app_usuarios')
    .select('id,nombre_completo,rol,equipo_codigo,foto_url,cedula,zona,activo').eq('cedula', cedula)
    .eq('rol', 'taller').eq('activo', true).single()
  if (error || !creado) throw new Error(error?.message || 'No se encontró el mecánico recién creado.')
  if (datos.cargo !== undefined || datos.telefono !== undefined) {
    await guardarFicha(String(creado.id), { cargo: datos.cargo, telefono: datos.telefono }, quien)
  }
  return { mecanico: { id: String(creado.id), nombre: String(creado.nombre_completo), cedula,
    cargo: datos.cargo, telefono: datos.telefono, rostro: null, ultima: null }, pin }
}

/** Corrige cargo y teléfono (la base pasa el cargo a MAYÚSCULA). */
export async function guardarFicha(usuarioId: string, ficha: { cargo?: string; telefono?: string }, quien: string): Promise<void> {
  const { error } = await supabase.rpc('taller_guardar_personal', {
    p_usuario_id: usuarioId, p_cargo: ficha.cargo ?? null, p_telefono: ficha.telefono ?? null, p_quien: quien,
  })
  if (error) throw new Error(error.message)
}

/**
 * Retira a la persona del taller: PRIMERO suprime su plantilla de la cara
 * (Ley 1581: terminada la finalidad, se borra) y DESPUÉS desactiva su usuario.
 * Sus marcaciones y horas pasadas se conservan.
 */
export async function retirarMecanico(usuarioId: string, quien: string): Promise<void> {
  await revocarRostro(usuarioId)
  await deleteAppUser(usuarioId)
}

/**
 * El jefe registra la cara EN PERSONA (después de que la persona leyó y aceptó
 * la autorización en la pantalla del jefe). Queda APROBADA de una.
 */
export async function enrolarPorJefe(
  input: { usuarioId: string; toma: ResultadoCamara; version: string },
  quien: string,
): Promise<'PENDIENTE' | 'APROBADO'> {
  return enrolarRostro({ usuarioId: input.usuarioId, descriptores: input.toma.descriptores,
    foto: input.toma.foto, consentimiento: true, version: input.version, enroladoPor: quien })
}

/** El usuario del quiosco, si ya existe (rol `quiosco_taller`, activo). */
export async function loadUsuarioQuiosco(): Promise<{ id: string; nombre: string } | null> {
  const { data, error } = await supabase.from('app_usuarios')
    .select('id,nombre_completo,rol,equipo_codigo,foto_url,cedula,zona,activo')
    .eq('rol', 'quiosco_taller').eq('activo', true).limit(1)
  if (error) throw new Error(error.message)
  return data?.[0] ? { id: String(data[0].id), nombre: String(data[0].nombre_completo) } : null
}

/** Crea el usuario del quiosco («QUIOSCO DEL TALLER») con PIN de 4 dígitos al azar. */
export async function crearUsuarioQuiosco(quien: string): Promise<{ id: string; pin: string }> {
  const yaExiste = await loadUsuarioQuiosco()
  if (yaExiste) throw new Error(`Ya existe el usuario del quiosco (${yaExiste.id}).`)
  const pin = pinNuevo()
  await createAppUser({ id: 'NUEVO', nombreCompleto: 'QUIOSCO DEL TALLER', rol: 'quiosco_taller', pin, equipoCodigo: '' })
  const creado = await loadUsuarioQuiosco()
  if (!creado) throw new Error('No se encontró el usuario del quiosco recién creado.')
  void quien
  return { id: creado.id, pin }
}

/**
 * El roster del quiosco. Con señal: `loadPersonalTaller()` y lo espeja en el
 * aparato. Sin señal (o si falla): el espejo, con `desdeCache: true`.
 * 🔴 El espejo es de una versión VIEJA por definición: al leerlo se rellena
 * contra el objeto vacío (regla 2b del CLAUDE.md), nunca se devuelve crudo.
 */
export async function loadRosterQuiosco(): Promise<RosterQuiosco> {
  const llave = 'sam:taller:quiosco-roster'
  const desdeEspejo = (): RosterQuiosco | null => {
    try {
      const raw = localStorage.getItem(llave)
      if (!raw) return null
      const guardado = JSON.parse(raw) as { mecanicos?: Partial<Mecanico>[]; actualizadoEn?: string }
      const mecanicos = (guardado.mecanicos ?? []).map((m) => ({ id: '', nombre: '', rostro: null, ultima: null, ...m }))
        .filter((m): m is Mecanico => Boolean(m.id))
      return { mecanicos, actualizadoEn: guardado.actualizadoEn ?? null, desdeCache: true }
    } catch { return null }
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const espejo = desdeEspejo()
    if (espejo) return espejo
    throw new Error('No hay roster guardado y el quiosco está sin conexión.')
  }
  try {
    const mecanicos = await loadPersonalTaller(); const actualizadoEn = new Date().toISOString()
    try { localStorage.setItem(llave, JSON.stringify({ mecanicos, actualizadoEn })) } catch { /* El roster vivo sigue disponible sin espejo. */ }
    return { mecanicos, actualizadoEn, desdeCache: false }
  } catch (error) {
    const espejo = desdeEspejo()
    if (espejo) return espejo
    throw error
  }
}

/**
 * Marca desde el quiosco. Usa `marcarOEncolar` (sin señal queda en cola y sube
 * sola), con `quioscoId`, `dispositivo: 'Quiosco del taller · <aparato>'` y la
 * ubicación si la hay (no bloquea: si no llega en 5 s, va sin ella).
 * Si se envió, actualiza la última marcación de esa persona en el espejo, para
 * que la cuadrícula diga ADENTRO/AFUERA bien aunque luego se caiga la señal.
 */
export async function marcarEnQuiosco(input: {
  usuarioId: string
  quioscoId: string
  tipo: 'ENTRADA' | 'SALIDA'
  metodo: 'ROSTRO' | 'PIN'
  toma?: ResultadoCamara | null
  /** Foto del momento cuando la cara no se reconoce y se deja para el jefe. */
  foto?: string | null
  pin?: string | null
  forzarRevision?: boolean
}): Promise<{ enviada: boolean; respuesta?: RespuestaMarcar }> {
  const geo = await ubicacion(5000)
  const cuando = new Date().toISOString()
  const marcacionId = crypto.randomUUID()
  const resultado = await marcarOEncolar({ id: marcacionId, usuarioId: input.usuarioId, tipo: input.tipo,
    ocurrioEn: cuando, metodo: input.metodo, lat: geo?.lat ?? null, lng: geo?.lng ?? null,
    precisionM: geo?.precision ?? null, dispositivo: 'Quiosco del taller · ' + apodoDelAparato(),
    descriptor: input.toma?.descriptores[0] ?? null, fotoMini: input.toma?.foto ?? input.foto ?? null,
    pruebasVida: input.toma?.pruebas ?? null, forzarRevision: input.forzarRevision ?? false,
    quioscoId: input.quioscoId, pin: input.pin ?? null })
  const respuesta = resultado.respuesta
  if (!resultado.enviada || (respuesta && respuesta.resultado !== 'NO_COINCIDE' && respuesta.resultado !== 'PIN_INCORRECTO')) {
    try {
      const llave = 'sam:taller:quiosco-roster'; const raw = localStorage.getItem(llave)
      if (raw) {
        const espejo = JSON.parse(raw) as { mecanicos?: Mecanico[]; actualizadoEn?: string }
        const mecanicos = (espejo.mecanicos ?? []).map((m) => m.id === input.usuarioId
          ? { ...m, ultima: { id: marcacionId, usuarioId: input.usuarioId, tipo: input.tipo,
            marcadoEn: respuesta?.marcadoEn ?? cuando, registradoEn: respuesta?.marcadoEn ?? cuando,
            metodo: input.metodo, horaCorregida: false, anulada: false, requiereRevision: respuesta?.requiereRevision ?? false } }
          : m)
        localStorage.setItem(llave, JSON.stringify({ mecanicos, actualizadoEn: espejo.actualizadoEn ?? null }))
      }
    } catch { /* La marcación ya quedó enviada o encolada; el espejo se recupera con la próxima carga. */ }
  }
  return resultado
}
