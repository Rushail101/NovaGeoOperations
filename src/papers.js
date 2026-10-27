// Paperwork rules for weighments. Pure functions (also used by tools/alerts.mjs).
const istDate = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

export const normVehicle = (s) => (s || '').toUpperCase().replace(/\s+/g, '')

// What is still missing for a weighment: [] means complete.
export function missingPapers(w) {
  if (w.type === 'inbound') {
    const m = []
    if (!w.supplier_invoice_no) m.push('supplier invoice no.')
    if (!w.permit_no) m.push('transit permit no.')
    if (!w.doc_paths?.length) m.push('scanned copies')
    return m
  }
  if (w.type === 'dispatch') {
    const m = []
    if (!w.invoice_no) m.push('invoice no.')
    if (!w.eway_bill_no) m.push('e-way bill no.')
    if (!w.doc_paths?.length) m.push('scanned copies')
    return m
  }
  return []
}

// % by which the weighed net differs from the quantity on the permit (null if either is unknown)
export function permitVariance(w) {
  const q = Number(w.permit_qty_kg)
  const net = w.net_kg != null ? Number(w.net_kg) : w.gross_kg != null && w.tare_kg != null ? Number(w.gross_kg) - Number(w.tare_kg) : null
  if (!(q > 0) || net == null || Number.isNaN(net)) return null
  return ((net - q) / q) * 100
}

export const permitExpired = (w) => !!(w.permit_valid_until && w.weighed_at && w.permit_valid_until < istDate(w.weighed_at))

// Plain-language problems with an inbound load (variance over the limit, expired permit)
export function permitProblems(w, limitPct = 3) {
  const out = []
  const v = permitVariance(w)
  if (v != null && Math.abs(v) > limitPct) out.push(`net weight is ${Math.abs(v).toFixed(1)}% ${v > 0 ? 'above' : 'below'} the permit quantity`)
  if (permitExpired(w)) out.push('permit had expired on the weighing date')
  return out
}
