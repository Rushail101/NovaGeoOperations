import { DataPage, useRows, opts, fmtKg, fmtDate, Badge } from '../lib.jsx'

const tone = {
  open: 'blue',
  in_production: 'amber',
  ready: 'green',
  partially_dispatched: 'amber',
  dispatched: 'grey',
  cancelled: 'red',
}
const statuses = Object.keys(tone).map((s) => ({ value: s, label: s.replace('_', ' ') }))

export default function Orders() {
  const customers = useRows('customers', { order: 'name', asc: true })
  const grades = useRows('grades', { order: 'name', asc: true })
  const progress = useRows('order_progress')
  const pend = Object.fromEntries(progress.rows.map((p) => [p.id, p]))

  const fields = [
    { name: 'order_no', label: 'Order no.', required: true },
    { name: 'customer_id', label: 'Customer', type: 'select', required: true, options: opts(customers.rows) },
    { name: 'grade_id', label: 'Grade / mesh', type: 'select', required: true, options: opts(grades.rows) },
    { name: 'qty_kg', label: 'Quantity (kg)', type: 'number', required: true },
    { name: 'due_date', label: 'Due date', type: 'date' },
    { name: 'status', label: 'Status', type: 'select', options: statuses },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ]

  return (
    <DataPage
      title="Orders"
      table="orders"
      select="*, customers(name), grades(name)"
      fields={fields}
      defaults={{ status: 'open' }}
      columns={[
        { label: 'Order', key: 'order_no' },
        { label: 'Customer', render: (r) => r.customers?.name },
        { label: 'Grade', render: (r) => r.grades?.name },
        { label: 'Qty', render: (r) => fmtKg(r.qty_kg) },
        { label: 'Pending', render: (r) => fmtKg(pend[r.id]?.pending_kg ?? r.qty_kg) },
        { label: 'Due', render: (r) => fmtDate(r.due_date) },
        { label: 'Status', render: (r) => <Badge tone={tone[r.status]}>{r.status.replace('_', ' ')}</Badge> },
      ]}
    />
  )
}
