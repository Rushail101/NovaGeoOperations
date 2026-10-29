// @ts-nocheck
// Supabase Edge Function "finance-link": READ-ONLY window from the ops app into the finance ERP's database.
// The finance database key lives here as a secret and never reaches the browser. Nothing is ever written to finance.
//
// Deploy (in the OPS Supabase project): Edge Functions > Create a new function named finance-link > paste this file > Deploy.
// Switch "Verify JWT" OFF (the function checks the signed-in user itself).
// Then Edge Functions > Secrets, add:
//   FINANCE_URL = the finance project's URL, e.g. https://abcdxyz.supabase.co
//   FINANCE_KEY = the finance project's service_role key (Project settings > API)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } })

// Only these tables and columns can be read.
const SELECTS = {
  suppliers: 'id,name,contact,phone,address',
  customers: 'id,name,gstin,contact,phone,address,state',
}
const PURCHASE_COLS = 'id,po_no,p_date,supplier_id,description,quantity_mt,invoice_no'

export async function handle(req, { admin, env, fetchFn = fetch }) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return reply(405, { error: 'POST only' })

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return reply(401, { error: 'Not signed in' })
  const { data: u, error: ue } = await admin.auth.getUser(token)
  if (ue || !u?.user) return reply(401, { error: 'Not signed in' })
  const { data: me } = await admin.from('profiles').select('role, active').eq('id', u.user.id).maybeSingle()
  if (!me || !me.active || me.role === 'pending') return reply(403, { error: 'No access' })

  let body
  try { body = await req.json() } catch { return reply(400, { error: 'Bad request' }) }
  if (!env.FINANCE_URL || !env.FINANCE_KEY) return reply(200, { error: 'not_configured' })

  async function read(table, params) {
    const qs = new URLSearchParams(params)
    const r = await fetchFn(`${env.FINANCE_URL.replace(/\/$/, '')}/rest/v1/${table}?${qs}`, {
      headers: { apikey: env.FINANCE_KEY, Authorization: `Bearer ${env.FINANCE_KEY}` },
    })
    if (!r.ok) return { error: `The finance database answered ${r.status}` }
    return { rows: await r.json() }
  }

  const a = body.action
  if (a === 'status') {
    const r = await read('suppliers', { select: 'id', limit: '1' })
    return reply(200, r.error ? { error: r.error } : { ok: true })
  }
  if (a === 'suppliers' || a === 'customers') {
    return reply(200, await read(a, { select: SELECTS[a], order: 'name.asc', limit: '3000' }))
  }
  if (a === 'purchases') {
    const params = { select: PURCHASE_COLS, order: 'p_date.desc', limit: '1000' }
    if (body.supplier_id != null) {
      const id = Number(body.supplier_id)
      if (!Number.isInteger(id)) return reply(200, { error: 'Bad supplier' })
      params.supplier_id = `eq.${id}`
    }
    const days = Math.min(Math.max(Number(body.days) || 180, 1), 1500)
    params.p_date = `gte.${new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)}`
    return reply(200, await read('purchases', params))
  }
  return reply(200, { error: 'Unknown action' })
}

if (typeof Deno !== 'undefined') {
  const { createClient } = await import('npm:@supabase/supabase-js@2')
  const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
  const env = { FINANCE_URL: Deno.env.get('FINANCE_URL'), FINANCE_KEY: Deno.env.get('FINANCE_KEY') }
  Deno.serve((req) => handle(req, { admin, env }))
}
