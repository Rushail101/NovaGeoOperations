// Product specs. A grade has default limits; an order can override any of them.
export const SPEC_FIELDS = [
  { key: 'min_sio2', col: 'spec_min_sio2', batch: 'sio2_pct', dir: 'min', label: 'SiO2 at least (%)', short: 'SiO2' },
  { key: 'max_fe2o3', col: 'spec_max_fe2o3', batch: 'fe2o3_pct', dir: 'max', label: 'Fe2O3 at most (%)', short: 'Fe2O3' },
  { key: 'max_moisture', col: 'spec_max_moisture', batch: 'moisture_pct', dir: 'max', label: 'Moisture at most (%)', short: 'Moisture' },
  { key: 'min_whiteness', col: 'spec_min_whiteness', batch: 'whiteness_pct', dir: 'min', label: 'Whiteness at least (%)', short: 'Whiteness' },
]

export const specFormFields = (prefix = '') =>
  SPEC_FIELDS.map((f) => ({ name: f.col, label: prefix + f.label, type: 'number' }))

const has = (v) => v !== null && v !== undefined && v !== ''

// Limits that apply to an order: the order's own value if set, otherwise the grade's.
export function effectiveSpec(order, grade) {
  const out = {}
  for (const f of SPEC_FIELDS) out[f.key] = has(order?.[f.col]) ? Number(order[f.col]) : has(grade?.[f.col]) ? Number(grade[f.col]) : null
  return out
}

// -> { ok, fails: ['Whiteness 91.2 is below 93'], untested: ['Fe2O3'], limited: bool }
export function checkSpec(batch, spec) {
  const fails = []
  const untested = []
  let limited = false
  for (const f of SPEC_FIELDS) {
    const lim = spec?.[f.key]
    if (!has(lim)) continue
    limited = true
    const v = batch?.[f.batch]
    if (!has(v)) {
      untested.push(f.short)
      continue
    }
    if (f.dir === 'min' && Number(v) < lim) fails.push(`${f.short} ${v} is below ${lim}`)
    if (f.dir === 'max' && Number(v) > lim) fails.push(`${f.short} ${v} is above ${lim}`)
  }
  return { ok: fails.length === 0 && untested.length === 0, fails, untested, limited }
}
