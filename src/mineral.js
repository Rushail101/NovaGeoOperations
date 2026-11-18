// Mineral stock account (Mineral Dealer rules: daily account of mineral procured, fed into the plant,
// recovered and despatched). Pure functions so they can be tested: node tools/test-mineral.mjs
//
// Three stocks are kept, all in kg:
//   raw     = raw quartz in the yard        (+ received, − fed to washing, − fed straight to the mills)
//   washed  = washed quartz waiting to mill  (+ washing output, − fed to the mills)
//   powder  = ground product                 (+ mill output, − despatched)
// Washing rejects and dumped dust are reported as wastes, not stock.

const n = (v) => Number(v) || 0
const KEYS = ['raw_in_kg', 'raw_to_wash_kg', 'raw_to_mill_kg', 'washed_out_kg', 'wash_rejects_kg', 'washed_to_mill_kg', 'powder_made_kg', 'dispatched_kg', 'dust_dumped_kg']

function apply(bal, r) {
  return {
    raw: bal.raw + n(r.raw_in_kg) - n(r.raw_to_wash_kg) - n(r.raw_to_mill_kg),
    washed: bal.washed + n(r.washed_out_kg) - n(r.washed_to_mill_kg),
    powder: bal.powder + n(r.powder_made_kg) - n(r.dispatched_kg),
  }
}

// rows: mineral_daily rows (any order). Returns { opening, days:[{day, ...movements, open, close}], totals, closing }
export function mineralLedger(rows, from, to, opening0 = { raw: 0, washed: 0, powder: 0 }) {
  const sorted = [...rows].sort((a, b) => String(a.day).localeCompare(String(b.day)))
  let bal = { ...opening0 }
  for (const r of sorted) if (r.day < from) bal = apply(bal, r)
  const opening = { ...bal }
  const days = []
  const totals = Object.fromEntries(KEYS.map((k) => [k, 0]))
  for (const r of sorted) {
    if (r.day < from || r.day > to) continue
    const open = { ...bal }
    bal = apply(bal, r)
    KEYS.forEach((k) => (totals[k] += n(r[k])))
    days.push({ ...Object.fromEntries(KEYS.map((k) => [k, n(r[k])])), day: r.day, open, close: { ...bal } })
  }
  const fed = totals.raw_to_mill_kg + totals.washed_to_mill_kg
  return {
    opening, closing: { ...bal }, days, totals,
    washRecoveryPct: totals.raw_to_wash_kg ? (totals.washed_out_kg / totals.raw_to_wash_kg) * 100 : null,
    millYieldPct: fed ? (totals.powder_made_kg / fed) * 100 : null,
    negative: days.filter((d) => d.close.raw < -1 || d.close.washed < -1 || d.close.powder < -1).map((d) => d.day),
  }
}

// Documents that inspectors check on each movement
export function movementIssues(weighments, today = new Date().toLocaleDateString('en-CA'), variancePct = 2) {
  const out = []
  for (const w of weighments) {
    const day = String(w.weighed_at || '').slice(0, 10)
    const who = w.vehicle_no || w.id?.slice(0, 8)
    if (w.type === 'inbound') {
      if (!w.permit_no) out.push({ id: w.id, day, level: 'red', text: `Inbound ${who}: no transit permit number` })
      else if (w.permit_qty_kg != null && n(w.net_kg) > n(w.permit_qty_kg) * (1 + n(variancePct) / 100)) out.push({ id: w.id, day, level: 'red', text: `Inbound ${who}: weighed ${Math.round(n(w.net_kg))} kg, permit covers ${Math.round(n(w.permit_qty_kg))} kg` })
      if (w.permit_valid_until && w.permit_valid_until < day) out.push({ id: w.id, day, level: 'amber', text: `Inbound ${who}: permit expired on ${w.permit_valid_until}` })
    }
    if (w.type === 'dispatch') {
      if (!w.invoice_no) out.push({ id: w.id, day, level: 'red', text: `Dispatch ${who}: no tax invoice number` })
      if (!w.transit_pass_no) out.push({ id: w.id, day, level: 'amber', text: `Dispatch ${who}: no mineral transit pass number` })
      if (!w.eway_bill_no) out.push({ id: w.id, day, level: 'amber', text: `Dispatch ${who}: no e-way bill number` })
    }
  }
  return out.filter((x) => x.day <= today)
}

export const kgToT = (kg) => Math.round(n(kg)) / 1000
