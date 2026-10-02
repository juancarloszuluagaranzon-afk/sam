// Función del servidor (edge runtime de Supabase, en el VPS): conecta las FACTURAS
// registradas en SAM con SIIGO. 2-oct-2026, pedido de Cristhian.
//
// POST { documento_id, accion }  —  accion:
//   'estado' → busca la factura en Siigo (por su número, p. ej. «FV-1-1234») y anota
//              en fact_documentos: siigo_id, nombre, CUFE, total y saldo.
//   'pdf'    → devuelve el PDF oficial de Siigo en base64 { base64, nombre }.
//
// 🔴 Solo trabaja sobre facturas que YA existen en SAM (fact_documentos): no es un
// paso abierto a toda la cuenta de Siigo. Las credenciales (usuario + access_key de
// cada razón social) están en `siigo_config`, cerrada a la llave pública.
// 🔴 En este servidor las funciones NO verifican JWT (VERIFY_JWT=false).
// 🔴 Lee la base DIRECTO (SUPABASE_DB_URL): la llave de servicio de este contenedor
// no sirve para la API de datos (ver avisos-finca).
//
// API de Siigo: https://api.siigo.com — POST /auth { username, access_key } con el
// header Partner-Id → access_token (24 h). GET /v1/invoices?name=… ·
// GET /v1/invoices/{id} (total, balance, stamp.cufe) · GET /v1/invoices/{id}/pdf ({ base64 }).
//
// Despliegue: copiar esta carpeta a /opt/supabase/docker/volumes/functions/ en el VPS.
import postgres from 'npm:postgres@3.4.5'

const sql = postgres(Deno.env.get('SUPABASE_DB_URL') ?? '', { max: 2, idle_timeout: 20, prepare: false })
const SIIGO = 'https://api.siigo.com'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

interface Config { usuario: string; access_key: string; partner_id: string }
// Token de Siigo por razón social (dura 24 h; se renueva a las 23).
const tokens = new Map<string, { token: string; vence: number }>()

async function tokenDe(razon: string, c: Config): Promise<string> {
  const t = tokens.get(razon)
  if (t && t.vence > Date.now()) return t.token
  const r = await fetch(`${SIIGO}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Partner-Id': c.partner_id },
    body: JSON.stringify({ username: c.usuario, access_key: c.access_key }),
  })
  if (!r.ok) throw new Error(`Siigo no aceptó las credenciales de ${razon} (${r.status})`)
  const d = await r.json() as { access_token?: string }
  if (!d.access_token) throw new Error(`Siigo no devolvió token para ${razon}`)
  tokens.set(razon, { token: d.access_token, vence: Date.now() + 23 * 3600 * 1000 })
  return d.access_token
}

async function siigo(razon: string, c: Config, ruta: string) {
  const r = await fetch(`${SIIGO}${ruta}`, {
    headers: { Authorization: `Bearer ${await tokenDe(razon, c)}`, 'Partner-Id': c.partner_id, 'Content-Type': 'application/json' },
  })
  if (r.status === 401) tokens.delete(razon)
  if (!r.ok) throw new Error(`Siigo respondió ${r.status} en ${ruta.split('?')[0]}`)
  return r.json()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'solo POST' }, 405)
  let cuerpo: { documento_id?: string; accion?: string }
  try { cuerpo = await req.json() } catch { return json({ error: 'cuerpo inválido' }, 400) }
  const { documento_id, accion } = cuerpo
  if (!documento_id || !/^[0-9a-f-]{36}$/i.test(documento_id)) return json({ error: 'falta la factura' }, 400)
  if (accion !== 'estado' && accion !== 'pdf') return json({ error: 'acción inválida' }, 400)

  const [doc] = await sql<{ id: string; tipo: string; numero: string; razon_social: string | null; anulado: boolean; siigo_id: string | null }[]>`
    select id, tipo, numero, razon_social, anulado, siigo_id from public.fact_documentos where id = ${documento_id}`
  if (!doc || doc.tipo !== 'FACTURA' || doc.anulado) return json({ error: 'Esa factura no está registrada en SAM' }, 404)
  if (!doc.razon_social) return json({ error: 'La factura no tiene razón social' }, 400)

  const [c] = await sql<Config[]>`
    select usuario, access_key, partner_id from public.siigo_config where razon_social = ${doc.razon_social} and activo`
  if (!c) return json({ error: `Siigo no está conectado para ${doc.razon_social}: faltan sus credenciales` }, 409)

  try {
    // 1) Ubicar la factura en Siigo (por su id guardado o por su número).
    let id = doc.siigo_id
    if (!id) {
      const lista = await siigo(doc.razon_social, c, `/v1/invoices?name=${encodeURIComponent(doc.numero)}`) as { results?: { id: string }[] }
      id = lista.results?.[0]?.id ?? null
      if (!id) return json({ error: `No está en Siigo una factura «${doc.numero}» de ${doc.razon_social}. ¿El número está tal como sale en Siigo (p. ej. FV-1-1234)?` }, 404)
    }

    if (accion === 'pdf') {
      const p = await siigo(doc.razon_social, c, `/v1/invoices/${id}/pdf`) as { base64?: string }
      if (!p.base64) return json({ error: 'Siigo no devolvió el PDF' }, 502)
      return json({ base64: p.base64, nombre: `${doc.numero}.pdf` })
    }

    const f = await siigo(doc.razon_social, c, `/v1/invoices/${id}`) as {
      id: string; name?: string; total?: number; balance?: number; stamp?: { cufe?: string }
    }
    await sql`update public.fact_documentos set
        siigo_id = ${f.id}, siigo_nombre = ${f.name ?? null}, siigo_cufe = ${f.stamp?.cufe ?? null},
        siigo_total = ${f.total ?? null}, siigo_saldo = ${f.balance ?? null}, siigo_consultado_en = now()
      where id = ${doc.id}`
    return json({ siigo_id: f.id, nombre: f.name ?? null, total: f.total ?? null, saldo: f.balance ?? null, cufe: f.stamp?.cufe ?? null })
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 502)
  }
})
