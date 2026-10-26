import { useState } from 'react'
import { DataPage } from '../lib.jsx'

const configs = {
  Mills: {
    table: 'mills',
    columns: [
      { label: 'Name', key: 'name' },
      { label: 'Lining', key: 'lining_type' },
      { label: 'Min safe lining (mm)', render: (r) => r.min_safe_thickness_mm ?? '-' },
      { label: 'Active', render: (r) => (r.active ? 'Yes' : 'No') },
    ],
    fields: [
      { name: 'name', label: 'Name', required: true },
      { name: 'lining_type', label: 'Lining type' },
      { name: 'min_safe_thickness_mm', label: 'Minimum safe lining thickness (mm) - used to project relining date', type: 'number' },
      { name: 'active', label: 'Active', type: 'checkbox' },
    ],
    defaults: { lining_type: 'Resin + road metal', active: true },
  },
  Customers: {
    table: 'customers',
    columns: [
      { label: 'Name', key: 'name' },
      { label: 'Phone', key: 'phone' },
      { label: 'Address', key: 'address' },
    ],
    fields: [
      { name: 'name', label: 'Name', required: true },
      { name: 'phone', label: 'Phone' },
      { name: 'address', label: 'Address', type: 'textarea' },
    ],
  },
  Suppliers: {
    table: 'suppliers',
    columns: [
      { label: 'Name', key: 'name' },
      { label: 'Phone', key: 'phone' },
      { label: 'Source', key: 'source_location' },
    ],
    fields: [
      { name: 'name', label: 'Name', required: true },
      { name: 'phone', label: 'Phone' },
      { name: 'source_location', label: 'Quarry / source' },
    ],
  },
  Grades: {
    table: 'grades',
    order: 'name',
    asc: true,
    columns: [
      { label: 'Grade', key: 'name' },
      { label: 'Mesh', key: 'mesh' },
      { label: 'Notes', key: 'notes' },
    ],
    fields: [
      { name: 'name', label: 'Grade name', required: true },
      { name: 'mesh', label: 'Mesh' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
  },
}

export default function Masters() {
  const [tab, setTab] = useState('Mills')
  const c = configs[tab]
  return (
    <div>
      <div className="tabs">
        {Object.keys(configs).map((k) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {k}
          </button>
        ))}
      </div>
      <DataPage
        key={tab}
        title={tab}
        table={c.table}
        order={c.order || 'created_at'}
        asc={c.asc}
        columns={c.columns}
        fields={c.fields}
        defaults={c.defaults}
      />
    </div>
  )
}
