// Función del servidor (edge runtime de Supabase, en el VPS): manda los AVISOS al
// celular del dueño de la tierra (Web Push con VAPID). 25-sep-2026.
//
// La llama SOLO la base (`af_avisar`, vía pg_net) con el secreto de
// `af_config.avisos.secreto`. 🔴 En este servidor las funciones NO verifican JWT
// (VERIFY_JWT=false) y quedan abiertas a internet: sin el secreto responde 401.
//
// 🔴 Lee la base DIRECTO (SUPABASE_DB_URL, red interna de Docker), no por la API de
// datos: con la llave de servicio de este contenedor PostgREST responde «permission
// denied for schema public» (probado el 25-sep).
//
// Despliegue: copiar esta carpeta a /opt/supabase/docker/volumes/functions/ en el
// VPS (el enrutador `main` la levanta sola por su nombre; no hay que reiniciar).
import webpush from 'npm:web-push@3.6.7'
import postgres from 'npm:postgres@3.4.5'

const sql = postgres(Deno.env.get('SUPABASE_DB_URL') ?? '', { max: 2, idle_timeout: 20, prepare: false })

interface Config { publica: string; privada: string; contacto: string; secreto: string }
interface Suscripcion { id: string; endpoint: string; p256dh: string; auth: string; fallos: number }

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('solo POST', { status: 405 })

  const [fila] = await sql<{ valor: Config }[]>`select valor from public.af_config where clave = 'avisos'`
  const v = fila?.valor
  if (!v?.secreto || req.headers.get('x-aviso-secreto') !== v.secreto) {
    return new Response('no autorizado', { status: 401 })
  }

  const { finca_id, titulo, cuerpo, tag, endpoint } = await req.json()
  if (!finca_id) return new Response('falta finca_id', { status: 400 })
  webpush.setVapidDetails(v.contacto, v.publica, v.privada)

  const subs = endpoint
    ? await sql<Suscripcion[]>`select id, endpoint, p256dh, auth, fallos from public.af_suscripciones
                               where finca_id = ${finca_id} and activa and endpoint = ${endpoint}`
    : await sql<Suscripcion[]>`select id, endpoint, p256dh, auth, fallos from public.af_suscripciones
                               where finca_id = ${finca_id} and activa`

  const cargaUtil = JSON.stringify({ titulo, cuerpo, tag, url: '/' })
  let enviados = 0
  const errores: string[] = []
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, cargaUtil,
        { TTL: 60 * 60 * 24, urgency: 'normal' })
      enviados++
    } catch (e) {
      const codigo = (e as { statusCode?: number }).statusCode
      errores.push(`${codigo ?? '?'} ${String((e as Error).message ?? e).slice(0, 120)}`)
      // 404/410 = ese celular ya no existe o quitó el permiso: no se vuelve a intentar.
      // Cualquier otra falla se reintenta en el próximo aviso, hasta 10 seguidas.
      const muerta = codigo === 404 || codigo === 410
      try {
        if (muerta) await sql`update public.af_suscripciones set fallos = fallos + 1, activa = false where id = ${s.id}`
        else await sql`update public.af_suscripciones set fallos = fallos + 1, activa = (fallos + 1 < 10) where id = ${s.id}`
      } catch (e2) {
        console.error('avisos-finca: no se pudo anotar la falla', e2)
      }
      continue
    }
    // Anotar el envío va APARTE: si fallara, el aviso igual ya llegó y no es una falla.
    await sql`update public.af_suscripciones set ultimo_envio = now(), fallos = 0 where id = ${s.id}`
      .catch((e3) => console.error('avisos-finca: no se pudo anotar el envío', e3))
  }
  return Response.json({ enviados, total: subs.length, errores })
})
