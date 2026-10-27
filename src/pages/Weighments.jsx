import { useState } from 'react'
import { DataPage, useRows, opts, fmtKg, fmtDateTime, toLocalInput, Badge } from '../lib.jsx'
import { useAuth } from '../auth.jsx'
import { PhotoLink } from '../PhotoField.jsx'

const ALL_TYPES = [
  { value: 'inbound', label: 'Inbound quartz' },
  { value: 'mill_feed', label: 'Mill feed' },
  { value: 'dispatch', label: 'Bulk dispatch (no bags)' },
]
const tone = { inbound: 'blue', mill_feed: 'amber', dispatch: 'green' }

export default function Weighments() {
  const { role } = useAuth()
  const [filter, setFilter] = useState('')
  const suppliers = useRows('suppliers', { order: 'name', asc: true })
  const mills = useRows('mills', { order: 'name', asc: true })
  const grades = useRows('grades', { order: 'name', asc: true })
  const orders = useRows('orders', { select: 'id, order_no, status, customers(name)', order: 'created_at' })

  const openOrders = orders.rows.filter((o) => !['dispatched', 'cancelled'].includes(o.status))
  // Truck dispatches with bags are done on the Dispatch tab. Loose (unbagged) dispatch is for admin and supervisor only.
  const bulkOk = ['admin', 'supervisor'].includes(role)
  const types = ALL_TYPES.filter((t) => t.value !== 'dispatch' || bulkOk)

  const fields = [
    { name: 'type', label: 'Type', type: 'select', required: true, options: types },
    { name: 'weighed_at', label: 'Date & time', type: 'datetime-local', required: true },
    { name: 'vehicle_no', label: 'Vehicle no.', showIf: (v) => v.type !== 'mill_feed' },
    { name: 'gross_kg', label: 'Gross (kg)', type: 'number', required: true },
    { name: 'tare_kg', label: 'Tare (kg)', type: 'number', required: true },
    { name: 'supplier_id', label: 'Supplier', type: 'select', options: opts(suppliers.rows), showIf: (v) => v.type === 'inbound' },
    { name: 'lot_no', label: 'Lot no.', required: true, hint: 'Used to trace a batch back to the quartz truck.', showIf: (v) => v.type === 'inbound' },
    { name: 'mill_id', label: 'Mill', type: 'select', required: true, options: opts(mills.rows), showIf: (v) => v.type === 'mill_feed' },
    { name: 'order_id', label: 'Order', type: 'select', required: true, options: opts(openOrders, (o) => `${o.order_no} - ${o.customers?.name ?? ''}`), showIf: (v) => v.type === 'dispatch' },
    { name: 'grade_id', label: 'Grade', type: 'select', options: opts(grades.rows), showIf: (v) => v.type !== 'inbound' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
    { name: 'photo_paths', label: 'Photo of slip or vehicle', type: 'photos', folder: 'weighments' },
  ]

  const extra = (
    <div className="tabs">
      {[{ value: '', label: 'All' }, ...ALL_TYPES].map((t) => (
        <button key={t.value} className={filter === t.value ? 'on' : ''} onClick={() => setFilter(t.value)}>{t.label}</button>
      ))}
    </div>
  )

  return (
    <DataPage
      key={filter}
      title="Weighments"
      table="weighments"
      select="*, suppliers(name), mills(name), orders(order_no), grades(name), creator:profiles!created_by(full_name, username)"
      order="weighed_at"
      dateField="weighed_at"
      eq={filter ? ['type', filter] : undefined}
      fields={fields}
      defaults={{ type: filter && filter !== 'dispatch' ? filter : 'inbound', weighed_at: toLocalInput() }}
      extra={extra}
      offline
      offlineLabel={(p) => `Weighment: ${p.type?.replace('_', ' ')} ${p.vehicle_no || ''} net ${fmtKg((p.gross_kg ?? 0) - (p.tare_kg ?? 0))}`}
      columns={[
        { label: 'When', render: (r) => fmtDateTime(r.weighed_at) },
        { label: 'Type', render: (r) => <Badge tone={tone[r.type]}>{r.type.replace('_', ' ')}</Badge> },
        { label: 'Vehicle', key: 'vehicle_no' },
        { label: 'Gross', render: (r) => fmtKg(r.gross_kg) },
        { label: 'Tare', render: (r) => fmtKg(r.tare_kg) },
        { label: 'Net', render: (r) => <strong>{fmtKg(r.net_kg)}</strong> },
        { label: 'Ref', render: (r) => r.orders?.order_no || r.mills?.name || r.suppliers?.name || r.lot_no || '-' },
        { label: 'Invoice', render: (r) => r.invoice_no || '-' },
        { label: 'Photos', render: (r) => <PhotoLink paths={r.photo_paths} /> },
        { label: 'By', render: (r) => r.creator?.full_name || r.creator?.username || '-' },
      ]}
    />
  )
}
