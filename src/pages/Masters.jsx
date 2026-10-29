import { useState } from 'react'
import { DataPage, useRows, opts, fmtDate, fmtNum, Expiry } from '../lib.jsx'
import { useAuth } from '../auth.jsx'
import { PhotoLink } from '../PhotoField.jsx'
import { SPEC_FIELDS, specFormFields } from '../spec.js'
import FinanceSync from './FinanceSync.jsx'

const limitsText = (r) => SPEC_FIELDS.filter((f) => r[f.col] != null).map((f) => `${f.short} ${f.dir === 'min' ? '>=' : '<='} ${r[f.col]}`).join(', ') || '-'
const SETTING_LABELS = { permit_variance_pct: 'Flag an inbound load when its net weight differs from the permit quantity by more than (%)' }

function build({ grades }) {
  return {
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
      columns: [{ label: 'Name', key: 'name' }, { label: 'GSTIN', key: 'gstin' }, { label: 'Phone', key: 'phone' }, { label: 'Address', key: 'address' }],
      fields: [{ name: 'name', label: 'Name', required: true }, { name: 'gstin', label: 'GSTIN' }, { name: 'phone', label: 'Phone' }, { name: 'address', label: 'Address', type: 'textarea' }],
    },
    Suppliers: {
      table: 'suppliers',
      note: 'Add the quarry or mine lease number and its expiry date. You get a Telegram alert before it runs out, and the weighment screen warns if you receive a load from an expired lease.',
      columns: [
        { label: 'Name', key: 'name' },
        { label: 'Phone', key: 'phone' },
        { label: 'Source', key: 'source_location' },
        { label: 'Lease / licence no.', key: 'lease_no' },
        { label: 'Valid until', render: (r) => (r.lease_valid_until ? <>{fmtDate(r.lease_valid_until)} <Expiry date={r.lease_valid_until} /></> : '-') },
        { label: 'Papers', render: (r) => <PhotoLink paths={r.doc_paths} /> },
      ],
      fields: [
        { name: 'name', label: 'Name', required: true },
        { name: 'phone', label: 'Phone' },
        { name: 'source_location', label: 'Quarry / source' },
        { name: 'lease_no', label: 'Mining lease / licence no.' },
        { name: 'lease_valid_until', label: 'Lease valid until', type: 'date' },
        { name: 'doc_paths', label: 'Lease copy / other papers', type: 'docs', folder: 'suppliers' },
      ],
    },
    'Finance link': { special: FinanceSync },
    Grades: {
      table: 'grades',
      order: 'name',
      asc: true,
      note: 'A grade is the product family (for example "A grade"). Add its different mesh sizes on the Mesh sizes tab. Limits set here apply to every mesh unless that mesh has its own.',
      columns: [{ label: 'Grade', key: 'name' }, { label: 'Standard limits', render: limitsText }],
      fields: [{ name: 'name', label: 'Grade name', required: true }, ...specFormFields('Standard: '), { name: 'notes', label: 'Notes', type: 'textarea' }],
    },
    'Mesh sizes': {
      table: 'grade_meshes',
      select: '*, grades(name)',
      order: 'created_at',
      asc: true,
      defaults: { active: true },
      note: 'Each mesh size belongs to one grade, for example A grade: 200 mesh, 325 mesh, 500 mesh. Orders, mill runs and batches pick the grade first and then the mesh. A mesh can have its own limits; if left empty it uses the grade\'s limits.',
      columns: [
        { label: 'Grade', render: (r) => r.grades?.name },
        { label: 'Mesh', key: 'mesh' },
        { label: 'Own limits', render: limitsText },
        { label: 'Active', render: (r) => (r.active ? 'Yes' : 'No') },
      ],
      fields: [
        { name: 'grade_id', label: 'Grade', type: 'select', required: true, options: opts(grades) },
        { name: 'mesh', label: 'Mesh size (e.g. 200, 325, -100 +200)', required: true },
        ...specFormFields('Limit for this mesh: '),
        { name: 'notes', label: 'Notes', type: 'textarea' },
        { name: 'active', label: 'Active', type: 'checkbox' },
      ],
    },
    Licences: {
      table: 'licences',
      order: 'valid_until',
      asc: true,
      note: 'Plant approvals such as pollution board consent, factory licence and fire NOC. Each one shows a countdown and sends a Telegram alert before it expires.',
      columns: [
        { label: 'Licence', key: 'name' },
        { label: 'Number', key: 'licence_no' },
        { label: 'Issued by', key: 'issued_by' },
        { label: 'Valid until', render: (r) => (r.valid_until ? <>{fmtDate(r.valid_until)} <Expiry date={r.valid_until} /></> : '-') },
        { label: 'Copy', render: (r) => <PhotoLink paths={r.doc_paths} /> },
      ],
      fields: [
        { name: 'name', label: 'Licence / approval', required: true },
        { name: 'licence_no', label: 'Number' },
        { name: 'issued_by', label: 'Issued by' },
        { name: 'valid_until', label: 'Valid until', type: 'date' },
        { name: 'doc_paths', label: 'Copy of the certificate', type: 'docs', folder: 'licences' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ],
    },
    Vehicles: {
      table: 'vehicles',
      order: 'vehicle_no',
      asc: true,
      note: 'Trucks that come often, with their usual empty weight. The weighment form fills the tare in when you type or pick one of these. New vehicles are added automatically after their first weighment.',
      columns: [
        { label: 'Vehicle', key: 'vehicle_no' },
        { label: 'Usual tare', render: (r) => (r.default_tare_kg != null ? `${fmtNum(r.default_tare_kg)} kg` : '-') },
        { label: 'Transporter', key: 'transporter' },
      ],
      fields: [
        { name: 'vehicle_no', label: 'Vehicle no.', required: true },
        { name: 'default_tare_kg', label: 'Usual tare (kg)', type: 'number' },
        { name: 'transporter', label: 'Transporter' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ],
    },
    Settings: {
      table: 'plant_settings',
      order: 'key',
      asc: true,
      adminOnly: true,
      addable: false,
      canDelete: false,
      idField: 'key',
      columns: [{ label: 'Setting', render: (r) => SETTING_LABELS[r.key] || r.key }, { label: 'Value', key: 'value' }],
      fields: [{ name: 'value', label: 'Value', required: true }],
    },
  }
}

export default function Masters() {
  const { role } = useAuth()
  const grades = useRows('grades', { order: 'name', asc: true })
  const [tab, setTab] = useState('Mills')
  const configs = build({ grades: grades.rows })
  const names = Object.keys(configs).filter((k) => !configs[k].adminOnly || role === 'admin')
  const c = configs[tab] || configs.Mills
  return (
    <div>
      <div className="tabs">
        {names.map((k) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{k}</button>
        ))}
      </div>
      {c.special ? <c.special /> : <DataPage
        key={tab + grades.rows.length}
        title={tab}
        table={c.table}
        select={c.select}
        order={c.order || 'created_at'}
        asc={c.asc}
        columns={c.columns}
        fields={c.fields}
        defaults={c.defaults}
        addable={c.addable}
        canDelete={c.canDelete}
        idField={c.idField}
        extra={c.note ? <p className="muted">{c.note}</p> : undefined}
      />}
    </div>
  )
}
