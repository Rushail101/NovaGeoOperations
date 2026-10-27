import { DataPage, useRows, opts, fmtKg, fmtDate, Badge } from '../lib.jsx'
import { specFormFields } from '../spec.js'

const tone = { open: 'blue', in_production: 'amber', ready: 'green', partially_dispatched: 'amber', dispatched: 'grey', cancelled: 'red' }
const statuses = Object.keys(tone).map((s) => ({ value: s, label: s.replace('_', ' ') }))

export default function Orders() {
  const customers = useRows('customers', { order: 'name', asc: true })
  const grades = useRows('grades', { order: 'name', asc: true })
  const progress = useRows('order_progress')
  const stock = useRows('bags', { select: 'weight_kg, batches(grade_id, qc_hold)', eq: ['status', 'in_stock'], limit: 5000 })
  const pend = Object.fromEntries(progress.rows.map((p) => [p.id, p]))
  const stockByGrade = {}
  for (const b of stock.rows) if (!b.batches?.qc_hold) stockByGrade[b.batches?.grade_id] = (stockByGrade[b.batches?.grade_id] || 0) + Number(b.weight_kg)

  const fields = [
    { name: 'order_no', label: 'Order no.', required: true },
    { name: 'customer_id', label: 'Customer', type: 'select', required: true, options: opts(customers.rows) },
    { name: 'grade_id', label: 'Grade / mesh', type: 'select', required: true, options: opts(grades.rows) },
    { name: 'qty_kg', label: 'Quantity (kg)', type: 'number', required: true },
    { name: 'due_date', label: 'Due date', type: 'date' },
    { name: 'status', label: 'Status', type: 'select', options: statuses },
    ...specFormFields('Customer limit: '),
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ]

  return (
    <DataPage
      title="Orders"
      table="orders"
      select="*, customers(name), grades(name)"
      dateField="created_at"
      fields={fields}
      defaults={{ status: 'open' }}
      extra={<p className="muted">Leave the customer limits empty to use the grade's standard limits (set under Masters). Dispatch warns when a bag's batch is outside them.</p>}
      columns={[
        { label: 'Order', key: 'order_no' },
        { label: 'Customer', render: (r) => r.customers?.name },
        { label: 'Grade', render: (r) => r.grades?.name },
        { label: 'Qty', render: (r) => fmtKg(r.qty_kg) },
        { label: 'Pending', render: (r) => fmtKg(pend[r.id]?.pending_kg ?? r.qty_kg) },
        {
          label: 'Packed stock',
          render: (r) => {
            if (['dispatched', 'cancelled'].includes(r.status)) return '-'
            const have = stockByGrade[r.grade_id] || 0
            const need = Number(pend[r.id]?.pending_kg ?? r.qty_kg)
            return have >= need ? <Badge tone="green">can fill ({fmtKg(have)})</Badge> : <span>{fmtKg(have)}</span>
          },
        },
        { label: 'Due', render: (r) => fmtDate(r.due_date) },
        { label: 'Status', render: (r) => <Badge tone={tone[r.status]}>{r.status.replace('_', ' ')}</Badge> },
      ]}
    />
  )
}
