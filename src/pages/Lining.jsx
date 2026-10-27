import { DataPage, useRows, opts, fmtDate, Badge } from '../lib.jsx'
import { PhotoLink } from '../PhotoField.jsx'

const conds = [
  { value: 'good', label: 'Good' },
  { value: 'watch', label: 'Watch' },
  { value: 'repair_soon', label: 'Repair soon' },
  { value: 'relining_needed', label: 'Relining needed' },
]
const tone = { good: 'green', watch: 'amber', repair_soon: 'amber', relining_needed: 'red' }
const yn = (b) => (b ? <Badge tone="red">Yes</Badge> : 'No')

// Wear rate (mm per 100 run-hours) from the thinnest-point readings, and projected hours left.
export function liningProjection(mill, inspections, currentHours) {
  const pts = inspections
    .filter((i) => i.mill_id === mill.id && i.min_thickness_mm != null && i.mill_hours_at_inspection != null)
    .map((i) => ({ h: Number(i.mill_hours_at_inspection), t: Number(i.min_thickness_mm) }))
    .sort((a, b) => a.h - b.h)
  if (pts.length < 2) return { note: 'Needs two or more inspections with thickness and run-hours' }
  const first = pts[0], last = pts[pts.length - 1]
  if (last.h <= first.h) return { note: 'Inspections need different run-hours' }
  const rate = (first.t - last.t) / (last.h - first.h) // mm per hour
  if (rate <= 0) return { note: 'No measurable wear yet', rate }
  const out = { rate: rate * 100 }
  if (mill.min_safe_thickness_mm != null) {
    const hoursLeft = (last.t - Number(mill.min_safe_thickness_mm)) / rate - (Number(currentHours || last.h) - last.h)
    out.hoursLeft = Math.max(0, hoursLeft)
  }
  return out
}

export default function Lining() {
  const mills = useRows('mills', { order: 'name', asc: true })
  const hours = useRows('mill_total_hours')

  const fields = [
    { name: 'mill_id', label: 'Mill', type: 'select', required: true, options: opts(mills.rows) },
    { name: 'inspected_at', label: 'Inspection date', type: 'date', required: true },
    { name: 'mill_hours_at_inspection', label: 'Mill run-hours at inspection', type: 'number' },
    { name: 'min_thickness_mm', label: 'Thinnest point (mm)', type: 'number' },
    { name: 'avg_thickness_mm', label: 'Average thickness (mm)', type: 'number' },
    { name: 'debonded_area_pct', label: 'Hollow / lifted area (%)', type: 'number' },
    { name: 'cracks', label: 'Cracks seen', type: 'checkbox' },
    { name: 'stone_loss_noted', label: 'Road metal pieces loose or missing', type: 'checkbox' },
    { name: 'iron_contamination_noted', label: 'Shell exposed / rust stain in powder', type: 'checkbox' },
    { name: 'condition', label: 'Overall condition', type: 'select', required: true, options: conds },
    { name: 'notes', label: 'Notes', type: 'textarea' },
    { name: 'photo_urls', label: 'Photos of the lining (needs signal)', type: 'photos', folder: 'lining' },
  ]

  const all = useRows('lining_inspections', { select: 'mill_id, min_thickness_mm, mill_hours_at_inspection', order: 'inspected_at' })
  const proj = mills.rows.map((m) => ({
    m,
    p: liningProjection(m, all.rows, hours.rows.find((h) => h.mill_id === m.id)?.total_hours),
  }))

  const extra = (
    <>
    <div className="stats">
      {proj.map(({ m, p }) => (
        <div className="stat" key={m.id}>
          <div className="label">{m.name} lining wear</div>
          <div className="value">{p.rate != null && p.rate > 0 ? `${p.rate.toFixed(2)} mm / 100 h` : '-'}</div>
          <div className="muted">
            {p.hoursLeft != null
              ? `about ${Math.round(p.hoursLeft)} run-hours until ${m.min_safe_thickness_mm} mm`
              : p.note || (m.min_safe_thickness_mm == null ? 'Set the minimum safe thickness under Masters > Mills' : '')}
          </div>
        </div>
      ))}
    </div>
    <p className="muted">
      Current run-hours:{' '}
      {hours.rows.map((h) => `${mills.rows.find((m) => m.id === h.mill_id)?.name ?? 'Mill'} ${Number(h.total_hours).toFixed(1)} h`).join(' | ') || 'no runs logged yet'}
      . Log an inspection at every long shutdown and compare thickness against run-hours to see the wear rate.
    </p>
    </>
  )

  return (
    <DataPage
      title="Resin lining inspections"
      table="lining_inspections"
      select="*, mills(name)"
      order="inspected_at"
      offline
      dateField="inspected_at"
      offlineLabel={(p) => `Lining inspection (${p.condition})`}
      fields={fields}
      defaults={{ inspected_at: new Date().toISOString().slice(0, 10), condition: 'good' }}
      extra={extra}
      columns={[
        { label: 'Date', render: (r) => fmtDate(r.inspected_at) },
        { label: 'Mill', render: (r) => r.mills?.name },
        { label: 'Run-hrs', key: 'mill_hours_at_inspection' },
        { label: 'Min mm', key: 'min_thickness_mm' },
        { label: 'Avg mm', key: 'avg_thickness_mm' },
        { label: 'Lifted %', key: 'debonded_area_pct' },
        { label: 'Cracks', render: (r) => yn(r.cracks) },
        { label: 'Stone loss', render: (r) => yn(r.stone_loss_noted) },
        { label: 'Iron', render: (r) => yn(r.iron_contamination_noted) },
        { label: 'Condition', render: (r) => <Badge tone={tone[r.condition]}>{r.condition.replace('_', ' ')}</Badge> },
        { label: 'Photos', render: (r) => <PhotoLink paths={r.photo_urls} /> },
      ]}
    />
  )
}
