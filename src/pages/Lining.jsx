import { DataPage, useRows, opts, fmtDate, Badge } from '../lib.jsx'

const conds = [
  { value: 'good', label: 'Good' },
  { value: 'watch', label: 'Watch' },
  { value: 'repair_soon', label: 'Repair soon' },
  { value: 'relining_needed', label: 'Relining needed' },
]
const tone = { good: 'green', watch: 'amber', repair_soon: 'amber', relining_needed: 'red' }
const yn = (b) => (b ? <Badge tone="red">Yes</Badge> : 'No')

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
  ]

  const extra = (
    <p className="muted">
      Current run-hours:{' '}
      {hours.rows.map((h) => `${mills.rows.find((m) => m.id === h.mill_id)?.name ?? 'Mill'} ${Number(h.total_hours).toFixed(1)} h`).join(' | ') || 'no runs logged yet'}
      . Log an inspection at every long shutdown and compare thickness against run-hours to see the wear rate.
    </p>
  )

  return (
    <DataPage
      title="Resin lining inspections"
      table="lining_inspections"
      select="*, mills(name)"
      order="inspected_at"
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
      ]}
    />
  )
}
