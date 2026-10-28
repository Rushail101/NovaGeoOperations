// Offline tests for the tools (no network): node tools/test.mjs
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { backup, fetchAll } from './backup.mjs'
import { buildAlerts, run } from './alerts.mjs'

// --- backup: pages through >1000 rows and writes files
const big = Array.from({ length: 2500 }, (_, i) => ({ id: i }))
const fake = {
  from: (t) => ({
    select: () => ({
      range: async (a, b) => ({ data: (t === 'mills' ? big : [{ id: 'x' }]).slice(a, b + 1), error: null }),
    }),
  }),
}
assert.equal((await fetchAll(fake, 'mills')).length, 2500)
const dir = await mkdtemp(tmpdir() + '/bk-')
const sum = await backup(fake, dir, ['mills', 'orders'])
assert.deepEqual(sum, { mills: 2500, orders: 1 })
assert.equal(JSON.parse(await readFile(dir + '/mills.json', 'utf8')).length, 2500)
const failing = { from: () => ({ select: () => ({ range: async () => ({ data: null, error: { message: 'denied' } }) }) }) }
await assert.rejects(() => fetchAll(failing, 'x'), /denied/)

// --- alerts
const now = new Date('2026-10-27T03:00:00Z') // 8:30 IST
const d = {
  mills: [{ id: 'm1', name: 'Mill 1' }],
  assets: [{ id: 'a1', name: 'Motor 1', mill_id: 'm1' }],
  schedules: [{ id: 's1', asset_id: 'a1', task: 'Grease', every_days: 30, last_done_at: '2026-08-01T00:00:00Z' }, { id: 's2', asset_id: 'a1', task: 'Check', every_days: 30, last_done_at: '2026-10-20T00:00:00Z' }],
  hours: [{ mill_id: 'm1', total_hours: 100 }],
  orders: [{ id: 'o1', order_no: 'ORD-1', status: 'open', due_date: '2026-10-20', customers: { name: 'Acme' } }, { id: 'o2', order_no: 'ORD-2', status: 'dispatched', due_date: '2026-10-01' }, { id: 'o3', order_no: 'ORD-3', status: 'open', due_date: '2026-11-20' }],
  spares: [{ id: 'p1', name: 'Filter bag', active: true, on_hand: 3, reorder_level: 5, unit: 'nos' }, { id: 'p2', name: 'Oil', active: true, on_hand: 50, reorder_level: 5, unit: 'l' }, { id: 'p3', name: 'NoLevel', active: true, on_hand: 0, reorder_level: 0, unit: 'nos' }],
  held: [{ id: 'b1', batch_no: 'NG-1', hold_reason: 'low whiteness' }],
  logs: [{ id: 'l1', type: 'breakdown', done_at: '2026-10-26T00:00:00Z', description: 'Belt snapped', assets: { name: 'Fan' } }, { id: 'l2', type: 'preventive', done_at: '2026-10-26T00:00:00Z' }],
  lining: [{ id: 'i1', mill_id: 'm1', inspected_at: '2026-09-01', condition: 'good' }, { id: 'i2', mill_id: 'm1', inspected_at: '2026-10-01', condition: 'repair_soon', min_thickness_mm: 18 }],
  downtime: [{ id: 'd1', mill_id: 'm1', started_at: '2026-10-27T00:00:00Z', ended_at: null, reason: 'power_cut' }],
  weighments: [
    { id: 'w1', type: 'inbound', net_kg: 20000, weighed_at: '2026-10-26T06:00:00Z', vehicle_no: 'TS09', permit_no: 'TP1', permit_qty_kg: 20200, supplier_invoice_no: 'I1', doc_paths: ['a.pdf'] },
    { id: 'w2', type: 'dispatch', net_kg: 5000, weighed_at: '2026-10-26T08:00:00Z', invoice_no: 'INV1', eway_bill_no: '123456789012', doc_paths: ['b.pdf'] },
    { id: 'w3', type: 'dispatch', net_kg: 999, weighed_at: '2026-10-25T08:00:00Z', vehicle_no: 'AP16' },
    { id: 'w4', type: 'inbound', net_kg: 18000, weighed_at: '2026-10-26T09:00:00Z', vehicle_no: 'KA01', permit_no: 'TP2', permit_qty_kg: 21000, supplier_invoice_no: 'I2', doc_paths: ['c.pdf'] },
  ],
  licences: [{ id: 'L1', name: 'Consent to operate', valid_until: '2026-11-10' }, { id: 'L2', name: 'Fire NOC', valid_until: '2027-06-01' }, { id: 'L3', name: 'Factory licence', valid_until: '2026-10-01' }],
  leases: [{ id: 'S1', name: 'Khammam Quarry', lease_valid_until: '2026-11-02' }],
  settings: [{ key: 'permit_variance_pct', value: '3' }],
  runs: [{ output_kg: 8000, started_at: '2026-10-26T04:00:00Z' }],
}
const a = buildAlerts(d, now)
const keys = a.map((x) => x.key)
assert.ok(keys.includes('maint:s1:2026-08-01T00:00:00Z'))
assert.ok(!keys.some((k) => k.startsWith('maint:s2')))
assert.ok(keys.includes('order:o1:2026-10-20') && !keys.some((k) => k.includes('o2') || k.includes('o3')))
assert.equal(keys.filter((k) => k.startsWith('spare:')).length, 1)
assert.ok(keys.includes('hold:b1') && keys.includes('bd:l1') && !keys.includes('bd:l2'))
assert.ok(keys.includes('lining:i2') && !keys.includes('lining:i1'))
assert.ok(keys.includes('down:d1'))
assert.ok(keys.includes('papers:w3') && !keys.includes('papers:w1') && !keys.includes('papers:w2'))
assert.ok(keys.includes('permit:w4') && !keys.includes('permit:w1'))
assert.ok(keys.includes('lic:L1:2026-11-10:30') && !keys.some((k) => k.startsWith('lic:L2')) && keys.includes('lic:L3:2026-10-01:expired'))
assert.ok(keys.includes('lease:S1:2026-11-02:7'))
const daily = a.find((x) => x.key === 'daily:2026-10-27')
assert.match(daily.text, /Dispatched 5,000 kg/)
assert.match(daily.text, /Powder produced 8,000 kg/)
// before 8 IST no summary
assert.ok(!buildAlerts(d, new Date('2026-10-26T20:00:00Z')).some((x) => x.key.startsWith('daily:')))

// run(): sends only unsent alerts and records them
const logged = new Set(['hold:b1'])
const inserted = []
const tables = { ...d, plant_settings: d.settings, suppliers: d.leases, mill_total_hours: d.hours, maintenance_schedules: d.schedules, spare_stock: d.spares, batches: d.held, maintenance_logs: d.logs, lining_inspections: d.lining, mill_runs: d.runs, alert_log: [...logged].map((key) => ({ key })) }
const q = (rows) => { const o = { select: () => o, eq: () => o, gte: () => o, is: () => o, then: (r) => r({ data: rows, error: null }) }; return o }
const client = { from: (t) => (t === 'alert_log' ? { select: () => q(tables.alert_log), insert: async (r) => (inserted.push(r.key), { error: null }) } : { select: () => q(tables[t] ?? tables[{ mills: 'mills' }[t]] ?? []) }) }
const sent = []
const n = await run({ client, token: 't', chat: 'c', now, send: async (t, c, text) => sent.push(text) })
assert.equal(n, a.length - 1)
assert.ok(!inserted.includes('hold:b1') && inserted.length === n)
console.log('tools: all tests passed (' + a.length + ' alert types checked)')

// --- admin-users edge function logic (fake service client)
import { writeFile } from 'node:fs/promises'
{
  const src = await readFile(new URL('../supabase/functions/admin-users/index.ts', import.meta.url), 'utf8')
  const tmp = (await mkdtemp(tmpdir() + '/fn-')) + '/fn.mjs'
  await writeFile(tmp, src)
  const { handle } = await import(tmp)
  const profiles = { adm: { role: 'admin', active: true }, adm2: { role: 'admin', active: true }, sup: { role: 'supervisor', active: true } }
  const calls = []
  const admin = {
    auth: {
      getUser: async (t) => (t.startsWith('tok-') ? { data: { user: { id: t.slice(4) } }, error: null } : { data: null, error: { message: 'bad' } }),
      admin: {
        createUser: async (a) => { calls.push(['createUser', a]); return a.email.startsWith('taken') ? { data: null, error: { message: 'A user with this email address has already been registered' } } : { data: { user: { id: 'new1' } }, error: null } },
        updateUserById: async (id, a) => { calls.push(['update', id, a]); return { error: null } },
      },
    },
    from: (t) => {
      let filters = {}
      const q = {
        select: () => q, eq: (k, v) => ((filters[k] = v), q), neq: (k, v) => ((filters['!' + k] = v), q),
        maybeSingle: async () => ({ data: profiles[filters.id] ?? null }),
        upsert: async (row) => { calls.push(['upsert', row]); return { error: null } },
        update: (row) => ({ eq: async (k, v) => { calls.push(['profile-update', v, row]); return { error: null } } }),
        then: (res) => res({ data: Object.entries(profiles).filter(([id, p]) => p.role === filters.role && p.active === filters.active && id !== filters['!id']).map(([id]) => ({ id })) }),
      }
      return q
    },
  }
  const call = async (tok, body) => {
    const r = await handle(new Request('http://x/', { method: 'POST', headers: tok ? { authorization: 'Bearer ' + tok } : {}, body: JSON.stringify(body) }), { admin })
    return { status: r.status, body: await r.json() }
  }
  assert.equal((await call(null, { action: 'create' })).status, 401)
  assert.equal((await call('tok-sup', { action: 'create' })).status, 403)
  assert.equal((await call('tok-ghost', { action: 'create' })).status, 403)
  assert.match((await call('tok-adm', { action: 'create', username: 'Ab', pin: '123456', role: 'operator' })).body.error, /Username/)
  assert.match((await call('tok-adm', { action: 'create', username: 'gate1', pin: '123', role: 'operator' })).body.error, /PIN/)
  assert.match((await call('tok-adm', { action: 'create', username: 'gate1', pin: '123456', role: 'pending' })).body.error, /role/)
  assert.match((await call('tok-adm', { action: 'create', username: 'taken1', pin: '123456', role: 'operator' })).body.error, /already taken/)
  const ok = await call('tok-adm', { action: 'create', username: 'Lab.Tech', full_name: 'Anita', pin: '654321', role: 'lab' })
  assert.deepEqual(ok.body, { ok: true, id: 'new1', username: 'lab.tech' })
  assert.ok(calls.some((c) => c[0] === 'createUser' && c[1].email === 'lab.tech@ops.local' && c[1].password === '654321' && c[1].email_confirm === true))
  assert.ok(calls.some((c) => c[0] === 'upsert' && c[1].role === 'lab' && c[1].full_name === 'Anita'))
  assert.equal((await call('tok-adm', { action: 'reset_pin', id: 'sup', pin: '12' })).body.error.includes('PIN'), true)
  assert.equal((await call('tok-adm', { action: 'reset_pin', id: 'sup', pin: '999999' })).body.ok, true)
  assert.match((await call('tok-adm', { action: 'set_active', id: 'adm', active: false })).body.error, /yourself/)
  assert.equal((await call('tok-adm', { action: 'set_active', id: 'sup', active: false })).body.ok, true)
  assert.ok(calls.some((c) => c[0] === 'update' && c[1] === 'sup' && c[2].ban_duration === '876000h'))
  assert.equal((await call('tok-adm', { action: 'set_active', id: 'sup', active: true })).body.ok, true)
  // blocking another admin is fine while a second active admin (the caller) exists
  assert.equal((await call('tok-adm', { action: 'set_active', id: 'adm2', active: false })).body.ok, true)
  assert.match((await call('tok-adm', { action: 'nope' })).body.error, /Unknown/)
  console.log('admin-users function: all tests passed')
}
