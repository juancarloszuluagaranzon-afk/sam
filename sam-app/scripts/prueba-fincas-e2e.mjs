// Prueba de punta a punta del módulo de fincas contra la base REAL, con el
// código REAL de la app (se carga por Vite, igual que en el navegador).
//
// 🔴 No usa ningún PIN: las dos llaves de prueba se crean directo en la base
// (af_sesiones, 1 hora) y se borran al terminar. Ver pie de la skill managing-fincas.
// Uso (desde sam-app):
//   AF_LLAVE_ADMIN=<llave de administración> AF_LLAVE_OTRO=<llave de otro usuario> node scripts/prueba-fincas-e2e.mjs
// Deja datos marcados «PRUEBA E2E»: se borran después con SQL.
import { createServer } from 'vite'

const ADMIN = process.env.AF_LLAVE_ADMIN   // reporta y administra
const OTRO = process.env.AF_LLAVE_OTRO     // acepta: nadie acepta lo suyo
if (!ADMIN || !OTRO) { console.error('Faltan AF_LLAVE_ADMIN y AF_LLAVE_OTRO'); process.exit(1) }
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const api = await server.ssrLoadModule('/src/services/fincasApi.ts')
const lib = await server.ssrLoadModule('/src/lib/fincas.ts')
const { supabase } = await server.ssrLoadModule('/src/lib/supabase.ts')
const { hoyBogota } = await server.ssrLoadModule('/src/lib/periodos.ts')

const res = []
const ok = (caso, cond, detalle = '') => res.push(`${cond ? '✓' : '✗'} ${caso}${detalle ? ` — ${detalle}` : ''}`)
const espera = async (caso, fn, codigo) => {
  try { await fn(); ok(caso, false, 'no falló') } catch (e) { ok(caso, String(e.message).startsWith(codigo), api.mensajeDeError(e)) }
}
let rot = null
let costoOriginal = null

try {
  const hoy = hoyBogota()

  // La puerta directa está cerrada: con la llave pública no se leen las tablas.
  const directo = await supabase.from('af_fincas').select('id').limit(1)
  ok('la llave pública de la app NO lee las tablas de fincas', !!directo.error, directo.error?.message ?? `leyó ${directo.data?.length}`)
  await espera('sin llave del módulo no se cargan las fincas', () => api.cargarFincas('inventada'), 'SIN_SESION')

  let d = await api.cargarFincas(ADMIN)
  ok('administración carga el módulo con su llave', d.rol === 'administracion' || d.rol === 'owner', d.rol)
  rot = d.paquete.find((p) => p.labor === 'ROTURACIÓN' && p.aplica === 'SOCA')
  costoOriginal = rot.costoUnitario
  await api.guardarPaquete({ ...rot, costoUnitario: 100000 }, ADMIN)
  ok('administración pone costo a roturación en el paquete', true)

  const fincaId = await api.guardarFinca({
    nombre: 'PRUEBA E2E LA CEIBA', duenoNombre: 'DUEÑO DE PRUEBA', duenoTelefono: '3000000000',
    ingenioId: 'riopaila', municipio: 'Zarzal', honorarioModo: 'PORCENTAJE', honorarioValor: 8,
  }, ADMIN)
  await api.agregarSuertes(fincaId, [{ codigo: '12', areaHa: 10 }, { codigo: '14', areaHa: 8 }], ADMIN)
  d = await api.cargarFincas(ADMIN)
  const s12 = d.suertes.find((s) => s.fincaId === fincaId && s.codigo === '12')
  ok('crear finca con 2 suertes', d.suertes.filter((s) => s.fincaId === fincaId).length === 2)

  await api.abrirCiclo(s12.id, '2026-09-01', 'SOCA', ADMIN)
  d = await api.cargarFincas(ADMIN)
  const ciclo = lib.cicloAbiertoDe(s12.id, d.ciclos)
  const labores = d.labores.filter((l) => l.cicloId === ciclo.id)
  ok('abrir ciclo carga el paquete de soca', labores.length === 4, labores.map((l) => l.labor).join(', '))
  const lRot = labores.find((l) => l.labor === 'ROTURACIÓN')
  ok('roturación planeada a 10 ha × $100.000', lRot.cantidadPlan === 10 && lRot.costoUnitarioPlan === 100000)

  // Foto de prueba (1×1 px) al mismo almacenamiento que usa la app
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaPj/HwAFBQIAX8jx0gAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
  const path = `fincas/reportes/prueba-e2e-${Date.now()}.png`
  const up = await supabase.storage.from('avatars').upload(path, png, { contentType: 'image/png' })
  if (up.error) throw up.error
  const foto = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
  console.log(`FOTO_PRUEBA=${path}`)

  const idRep = crypto.randomUUID()
  await api.reportarLabor({ id: idRep, laborId: lRot.id, cantidad: 6, fecha: '2026-09-10', fotoUrl: foto, lat: 4.39, lng: -76.07, precisionM: 9, nota: 'prueba e2e' }, ADMIN)
  ok('reportar 6 ha de roturación con foto y ubicación', true)
  await espera('el mismo usuario no puede aceptar su reporte', () => api.revisarReporte(idRep, true, '', ADMIN), 'NO_PROPIO')
  await espera('reportar pasándose del área de la suerte', () => api.reportarLabor({ id: crypto.randomUUID(), laborId: lRot.id, cantidad: 5, fecha: '2026-09-11', fotoUrl: foto, lat: null, lng: null, precisionM: null, nota: '' }, ADMIN), 'SUPERA_AREA')
  ok('otra persona acepta', (await api.revisarReporte(idRep, true, '', OTRO)) === 'ACEPTADO')

  // Reintento: es lo que hace la cola cuando la senal se cae a mitad de camino.
  await api.reportarLabor({ id: idRep, laborId: lRot.id, cantidad: 6, fecha: '2026-09-10', fotoUrl: foto, lat: 4.39, lng: -76.07, precisionM: 9, nota: 'prueba e2e' }, ADMIN)
  d = await api.cargarFincas(ADMIN)
  ok('reintentar el mismo reporte NO lo duplica', d.reportes.filter((r) => r.laborId === lRot.id).length === 1,
    `${d.reportes.filter((r) => r.laborId === lRot.id).length} reporte(s)`)

  await api.registrarMovimiento({ fincaId, tipo: 'ANTICIPO', fecha: hoy, concepto: 'Giro del dueño (prueba)', valor: 5_000_000 }, ADMIN)
  await espera('un gasto sin soporte no entra', () => api.registrarMovimiento({ fincaId, tipo: 'GASTO', fecha: hoy, concepto: 'sin soporte', valor: 1000 }, ADMIN), 'new row')

  // Las cifras de la administración
  d = await api.cargarFincas(ADMIN)
  const finca = d.fincas.find((f) => f.id === fincaId)
  const p = lib.presupuestoFinca(fincaId, d)
  const c = lib.cuentaFinca(fincaId, d.movimientos)
  const filas = lib.laboresDeFinca(fincaId, d, hoy)
  const fRot = filas.find((x) => x.labor.id === lRot.id)
  ok('el gasto de la labor aceptada entra a la cuenta: $600.000', c.gastos === 600000, lib.fmtPesos(c.gastos))
  ok('saldo = anticipo − gasto = $4.400.000', c.saldo === 4_400_000, lib.fmtPesos(c.saldo))
  ok('presupuesto del ciclo ejecutado', p.ejecutado === 600000, `${lib.fmtPesos(p.ejecutado)} de ${lib.fmtPesos(p.presupuesto)} (${p.pct} %)`)
  ok('avance de roturación 60 %', fRot.avance.pct === 60, `${fRot.avance.aceptado} de ${fRot.labor.cantidadPlan} ha`)
  ok('oportunidad: arrancó a los 9 días del corte → a tiempo', fRot.oport?.nivel === 'ideal' && fRot.oport.ddc === 9, JSON.stringify(fRot.oport))
  const fFert = filas.find((x) => x.labor.labor === 'FERTILIZACIÓN')
  ok('fertilización sin hacer se califica con hoy', fFert.oport && !fFert.oport.hecha, JSON.stringify(fFert.oport))
  const bit = lib.bitacoraFinca(fincaId, d, (id) => id)
  ok('bitácora con el reporte (con foto) y el anticipo', bit.length === 2 && bit.some((e) => e.foto === foto), bit.map((e) => e.titulo).join(' | '))

  // ── El dueño entra con su enlace ──
  await espera('un usuario que no es administración no crea enlaces', () => api.crearAccesoDueno(fincaId, 'x', OTRO), 'SIN_PERMISO')
  const llaveDueno = await api.crearAccesoDueno(fincaId, 'DUEÑO DE PRUEBA', ADMIN)
  ok('administración crea el enlace del dueño', /^[0-9a-f]{64}$/.test(llaveDueno))
  const v = await api.cargarFincas(llaveDueno)
  ok('el dueño ve SOLO su finca', v.rol === 'dueno' && v.fincas.length === 1 && v.fincas[0].id === fincaId, `${v.rol} · ${v.fincas.map((f) => f.nombre).join(', ')}`)
  ok('el dueño no ve el paquete ni los enlaces', v.paquete.length === 0 && v.accesos.length === 0)
  const cD = lib.cuentaFinca(fincaId, v.movimientos)
  const pD = lib.presupuestoFinca(fincaId, v)
  ok('el dueño ve las MISMAS cifras que la administración', cD.saldo === c.saldo && pD.ejecutado === p.ejecutado && pD.presupuesto === p.presupuesto,
    `saldo ${lib.fmtPesos(cD.saldo)} · ejecutado ${lib.fmtPesos(pD.ejecutado)} de ${lib.fmtPesos(pD.presupuesto)}`)
  ok('el dueño recibe los nombres de quien reportó y aceptó', Object.keys(v.nombres).length >= 2, Object.values(v.nombres).join(', '))
  await espera('el dueño no escribe en la cuenta', () => api.registrarMovimiento({ fincaId, tipo: 'ANTICIPO', fecha: hoy, concepto: 'x', valor: 1 }, llaveDueno), 'SIN_PERMISO')
  await espera('el dueño no acepta reportes', () => api.revisarReporte(idRep, true, '', llaveDueno), 'SIN_PERMISO')
  d = await api.cargarFincas(ADMIN)
  const acc = d.accesos.find((a) => a.fincaId === fincaId)
  ok('administración ve cuándo entró el dueño', acc?.usos === 1 && !!acc.ultimoUso, `${acc?.usos} vez · ${acc?.ultimoUso}`)
  await api.revocarAccesoDueno(acc.id, ADMIN)
  await espera('enlace quitado ya no abre', () => api.cargarFincas(llaveDueno), 'SIN_SESION')

  console.log('\n--- Resumen para el dueño (WhatsApp) ---\n' + lib.resumenParaDueno(finca, d, hoy, (id) => id) + '\n---')
  console.log(`FINCA_PRUEBA=${fincaId}`)
} catch (e) {
  res.push(`✗ ERROR: ${e.message}`)
} finally {
  // El paquete vuelve a como estaba.
  if (rot && costoOriginal !== null) {
    try { await api.guardarPaquete({ ...rot, costoUnitario: costoOriginal }, ADMIN); res.push(`· paquete de roturación devuelto a ${costoOriginal}`) }
    catch (e) { res.push(`✗ NO se devolvió el costo del paquete (${costoOriginal}): ${e.message}`) }
  }
  console.log(res.join('\n'))
  await server.close()
}
