// node tools/test-mineral.mjs
import assert from 'node:assert/strict'
import { mineralLedger, movementIssues } from '../src/mineral.js'

const rows = [
  { day: '2026-10-30', raw_in_kg: 50000 },
  { day: '2026-11-01', raw_in_kg: 30000, raw_to_wash_kg: 40000, washed_out_kg: 34000, wash_rejects_kg: 5500 },
  { day: '2026-11-02', washed_to_mill_kg: 30000, powder_made_kg: 29100 },
  { day: '2026-11-03', dispatched_kg: 25000 },
  { day: '2026-12-01', raw_in_kg: 999 },
]
const L = mineralLedger(rows, '2026-11-01', '2026-11-30')
assert.deepEqual(L.opening, { raw: 50000, washed: 0, powder: 0 })
assert.deepEqual(L.closing, { raw: 40000, washed: 4000, powder: 4100 })
assert.equal(L.days.length, 3)
assert.equal(Math.round(L.washRecoveryPct), 85)
assert.equal(Math.round(L.millYieldPct), 97)
assert.deepEqual(L.negative, [])
assert.deepEqual(mineralLedger([{ day: '2026-11-05', dispatched_kg: 10 }], '2026-11-01', '2026-11-30').negative, ['2026-11-05'])

const iss = movementIssues([
  { id: 'a', type: 'inbound', weighed_at: '2026-11-02T10:00', vehicle_no: 'TS1', net_kg: 21000, permit_no: 'P1', permit_qty_kg: 20000 },
  { id: 'b', type: 'inbound', weighed_at: '2026-11-02T10:00', vehicle_no: 'TS2', net_kg: 1 },
  { id: 'c', type: 'dispatch', weighed_at: '2026-11-03T10:00', vehicle_no: 'TS3', invoice_no: 'X', eway_bill_no: '1' },
], '2026-11-30')
assert.equal(iss.length, 3)
assert.match(iss[0].text, /permit covers/)
assert.match(iss[2].text, /transit pass/)
console.log('mineral account: all tests passed')
