import { DataPage, useRows, opts, fmtKg, fmtDateTime, toLocalInput, gradeLabel } from '../lib.jsx'
import { useMeshes, gradeMeshFields } from '../meshes.js'

export default function Runs() {
  const mills = useRows('mills', { order: 'name', asc: true })
  const grades = useRows('grades', { order: 'name', asc: true })
  const meshes = useMeshes()
  const hours = useRows('mill_total_hours')
  const orders = useRows('orders', { select: 'id, order_no, status, customers(name)', order: 'created_at' })
  const openOrders = orders.rows.filter((o) => !['dispatched', 'cancelled'].includes(o.status))
  const millName = Object.fromEntries(mills.rows.map((m) => [m.id, m.name]))

  const fields = [
    { name: 'mill_id', label: 'Mill', type: 'select', required: true, options: opts(mills.rows) },
    { name: 'started_at', label: 'Started', type: 'datetime-local', required: true },
    { name: 'ended_at', label: 'Ended (leave blank if running)', type: 'datetime-local' },
    ...gradeMeshFields(grades.rows, meshes.rows, { gradeRequired: false, meshRequired: false }),
    { name: 'order_id', label: 'For order (optional)', type: 'select', options: opts(openOrders, (o) => `${o.order_no} - ${o.customers?.name ?? ''}`) },
    { name: 'kwh_start', label: 'Energy meter at start (kWh)', type: 'number' },
    { name: 'kwh_end', label: 'Energy meter at end (kWh)', type: 'number' },
    { name: 'feed_kg', label: 'Feed (kg)', type: 'number' },
    { name: 'output_kg', label: 'Output (kg)', type: 'number' },
    { name: 'shift', label: 'Shift', type: 'select', options: ['A', 'B', 'C'].map((x) => ({ value: x, label: x })) },
    { name: 'operator', label: 'Operator' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ]

  const extra = (
    <div className="stats">
      {hours.rows.map((h) => (
        <div className="stat" key={h.mill_id}>
          <div className="label">{millName[h.mill_id] || 'Mill'} total run-hours</div>
          <div className="value">{Number(h.total_hours).toFixed(1)} h</div>
        </div>
      ))}
    </div>
  )

  return (
    <DataPage
      title="Mill runs"
      table="mill_runs"
      select="*, mills(name), grades(name), grade_meshes(mesh), orders(order_no)"
      order="started_at"
      dateField="started_at"
      offline
      offlineLabel={(p) => `Mill run: ${fmtKg(p.output_kg)} output`}
      fields={fields}
      defaults={{ started_at: toLocalInput() }}
      extra={extra}
      columns={[
        { label: 'Mill', render: (r) => r.mills?.name },
        { label: 'Started', render: (r) => fmtDateTime(r.started_at) },
        { label: 'Hours', render: (r) => (r.hours == null ? 'Running' : r.hours) },
        { label: 'Grade / mesh', render: (r) => gradeLabel(r.grades, r.grade_meshes) },
        { label: 'Feed', render: (r) => fmtKg(r.feed_kg) },
        { label: 'Output', render: (r) => fmtKg(r.output_kg) },
        { label: 'Yield', render: (r) => (r.feed_kg > 0 && r.output_kg != null ? ((r.output_kg / r.feed_kg) * 100).toFixed(1) + '%' : '-') },
        { label: 'kWh/t', render: (r) => (r.kwh_used != null && r.output_kg > 0 ? (r.kwh_used / (r.output_kg / 1000)).toFixed(0) : '-') },
        { label: 'Order', render: (r) => r.orders?.order_no || '-' },
        { label: 'Shift', key: 'shift' },
        { label: 'Operator', key: 'operator' },
      ]}
    />
  )
}
