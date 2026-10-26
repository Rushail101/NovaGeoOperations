import { DataPage, useRows, opts, fmtDate, fmtDateTime } from '../lib.jsx'

export default function Batches() {
  const mills = useRows('mills', { order: 'name', asc: true })
  const grades = useRows('grades', { order: 'name', asc: true })
  const runs = useRows('mill_runs', { select: 'id, started_at, mills(name)', order: 'started_at', limit: 100 })
  const bags = useRows('bags', { select: 'batch_id, status, weight_kg', limit: 5000 })

  const stats = {}
  for (const b of bags.rows) {
    const s = (stats[b.batch_id] ||= { total: 0, stock: 0, kg: 0 })
    if (b.status === 'rejected') continue
    s.total++
    s.kg += Number(b.weight_kg)
    if (b.status === 'in_stock') s.stock++
  }

  const fields = [
    { name: 'mill_id', label: 'Mill', type: 'select', required: true, options: opts(mills.rows) },
    { name: 'grade_id', label: 'Grade / mesh', type: 'select', required: true, options: opts(grades.rows) },
    { name: 'mill_run_id', label: 'Mill run (optional)', type: 'select', options: opts(runs.rows, (r) => `${r.mills?.name ?? ''} - ${fmtDateTime(r.started_at)}`) },
    { name: 'inbound_lot_no', label: 'Quartz lot no. used' },
    { name: 'produced_on', label: 'Production date', type: 'date' },
    { name: 'sio2_pct', label: 'SiO2 %', type: 'number' },
    { name: 'fe2o3_pct', label: 'Fe2O3 %', type: 'number' },
    { name: 'moisture_pct', label: 'Moisture %', type: 'number' },
    { name: 'lab_report_url', label: 'Lab report link (URL)' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ]

  return (
    <DataPage
      title="Batches"
      table="batches"
      select="*, mills(name), grades(name)"
      fields={fields}
      defaults={{ produced_on: new Date().toISOString().slice(0, 10) }}
      extra={<p className="muted">A batch is one production lot with its lab results. The batch number is generated automatically. Pack its bags on the Bags tab.</p>}
      columns={[
        { label: 'Batch', render: (r) => <strong>{r.batch_no}</strong> },
        { label: 'Date', render: (r) => fmtDate(r.produced_on) },
        { label: 'Mill', render: (r) => r.mills?.name },
        { label: 'Grade', render: (r) => r.grades?.name },
        { label: 'Lot', key: 'inbound_lot_no' },
        { label: 'SiO2', render: (r) => r.sio2_pct ?? '-' },
        { label: 'Fe2O3', render: (r) => r.fe2o3_pct ?? '-' },
        { label: 'Moist.', render: (r) => r.moisture_pct ?? '-' },
        { label: 'Bags (in stock / total)', render: (r) => `${stats[r.id]?.stock ?? 0} / ${stats[r.id]?.total ?? 0}` },
        { label: 'Lab report', render: (r) => (r.lab_report_url ? <a href={r.lab_report_url} target="_blank" rel="noreferrer">Open</a> : '-') },
      ]}
    />
  )
}
