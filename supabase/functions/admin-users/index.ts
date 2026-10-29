// @ts-nocheck
// Supabase Edge Function "admin-users": lets an admin of the app add people, reset PINs and block/unblock sign-in.
// Creating accounts needs the service key, which must never be in the browser, so it lives here.
// Deploy: Supabase dashboard > Edge Functions > Create a new function named admin-users > paste this file > Deploy.
// (Switch "Verify JWT" OFF: the function checks the caller itself.) The function reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from its own environment.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } })
const ROLES = ['admin', 'supervisor', 'weighbridge', 'operator', 'maintenance', 'lab', 'viewer']
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,29}$/

export async function handle(req, { admin }) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return reply(405, { error: 'POST only' })

  // Who is calling? Must be a signed-in, active admin.
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return reply(401, { error: 'Not signed in' })
  const { data: u, error: ue } = await admin.auth.getUser(token)
  if (ue || !u?.user) return reply(401, { error: 'Not signed in' })
  const me = u.user.id
  const { data: mine } = await admin.from('profiles').select('role, active').eq('id', me).maybeSingle()
  if (!mine || mine.role !== 'admin' || !mine.active) return reply(403, { error: 'Only an admin can manage users' })

  let body
  try { body = await req.json() } catch { return reply(400, { error: 'Bad request' }) }
  const bad = (error) => reply(200, { error })

  if (body.action === 'create') {
    const username = String(body.username || '').trim().toLowerCase()
    const pin = String(body.pin || '')
    const role = String(body.role || '')
    const full_name = String(body.full_name || '').trim() || username
    if (!USERNAME.test(username)) return bad('Username: 3 to 30 characters, lowercase letters, numbers, dot, dash or underscore')
    if (pin.length < 6) return bad('PIN must be at least 6 characters')
    if (!ROLES.includes(role)) return bad('Pick a role')
    const { data, error } = await admin.auth.admin.createUser({ email: `${username}@ops.local`, password: pin, email_confirm: true, user_metadata: { full_name } })
    if (error) return bad(/already|registered|exists/i.test(error.message) ? `The username "${username}" is already taken` : error.message)
    const { error: pe } = await admin.from('profiles').upsert({ id: data.user.id, username, full_name, role, active: true }, { onConflict: 'id' })
    if (pe) return bad('Account created but the role could not be set: ' + pe.message)
    return reply(200, { ok: true, id: data.user.id, username })
  }

  if (body.action === 'reset_pin') {
    const pin = String(body.pin || '')
    if (pin.length < 6) return bad('PIN must be at least 6 characters')
    const { error } = await admin.auth.admin.updateUserById(String(body.id), { password: pin })
    return error ? bad(error.message) : reply(200, { ok: true })
  }

  if (body.action === 'set_active') {
    const id = String(body.id)
    const active = !!body.active
    if (!active) {
      if (id === me) return bad('You cannot block yourself')
      const { data: t } = await admin.from('profiles').select('role, active').eq('id', id).maybeSingle()
      if (t?.role === 'admin' && t.active) {
        const { data: others } = await admin.from('profiles').select('id').eq('role', 'admin').eq('active', true).neq('id', id)
        if (!others || others.length === 0) return bad('That is the last active admin')
      }
    }
    const { error: be } = await admin.auth.admin.updateUserById(id, { ban_duration: active ? 'none' : '876000h' })
    if (be) return bad(be.message)
    const { error: pe } = await admin.from('profiles').update({ active }).eq('id', id)
    return pe ? bad(pe.message) : reply(200, { ok: true })
  }

  return bad('Unknown action')
}

if (typeof Deno !== 'undefined') {
  const { createClient } = await import('npm:@supabase/supabase-js@2')
  const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
  Deno.serve((req) => handle(req, { admin }))
}
