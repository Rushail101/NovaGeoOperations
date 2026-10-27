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
  weighments: [{ type: 'inbound', net_kg: 20000, weighed_at: '2026-10-26T06:00:00Z' }, { type: 'dispatch', net_kg: 5000, weighed_at: '2026-10-26T08:00:00Z' }, { type: 'dispatch', net_kg: 999, weighed_at: '2026-10-25T08:00:00Z' }],
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
const daily = a.find((x) => x.key === 'daily:2026-10-27')
assert.match(daily.text, /Dispatched 5,000 kg/)
assert.match(daily.text, /Powder produced 8,000 kg/)
// before 8 IST no summary
assert.ok(!buildAlerts(d, new Date('2026-10-26T20:00:00Z')).some((x) => x.key.startsWith('daily:')))

// run(): sends only unsent alerts and records them
const logged = new Set(['hold:b1'])
const inserted = []
const tables = { ...d, mill_total_hours: d.hours, maintenance_schedules: d.schedules, spare_stock: d.spares, batches: d.held, maintenance_logs: d.logs, lining_inspections: d.lining, mill_runs: d.runs, alert_log: [...logged].map((key) => ({ key })) }
const q = (rows) => { const o = { select: () => o, eq: () => o, gte: () => o, is: () => o, then: (r) => r({ data: rows, error: null }) }; return o }
const client = { from: (t) => (t === 'alert_log' ? { select: () => q(tables.alert_log), insert: async (r) => (inserted.push(r.key), { error: null }) } : { select: () => q(tables[t] ?? tables[{ mills: 'mills' }[t]] ?? []) }) }
const sent = []
const n = await run({ client, token: 't', chat: 'c', now, send: async (t, c, text) => sent.push(text) })
assert.equal(n, a.length - 1)
assert.ok(!inserted.includes('hold:b1') && inserted.length === n)
console.log('tools: all tests passed (' + a.length + ' alert types checked)')
