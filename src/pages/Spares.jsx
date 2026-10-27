import { useState } from 'react'
import { PackagePlus, PackageMinus, FileDown } from 'lucide-react'
import { DataPage, useRows, opts, Modal, Form, clean, toast, Badge, fmtNum, fmtDateTime, toLocalInput, exportList } from '../lib.jsx'
import { useAuth } from '../auth.jsx'
import { can } from '../perms.js'
import { saveInsert, isNetworkError } from '../offline.js'
import { OutboxList } from '../Outbox.jsx'

export const CATEGORIES = [
  { value: 'grinding_media', label: 'Grinding media' },
  { value: 'filter_bag', label: 'Filter bags' },
  { value: 'lubricant', label: 'Lubricants' },
  { value: 'liner_resin', label: 'Lining resin / stone' },
  { value: 'electrical', label: 'Electrical' },
  { value: 'other', label: 'Other' },
]
const catLabel = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]))

function MoveForm({ kind, item, items, mills, onDone }) {
  const fields = [
    { name: 'item_id', label: 'Item', type: 'select', required: true, options: opts(items, (i) => `${i.name} (${fmtNum(i.on_hand)} ${i.unit} on hand)`) },
    { name: 'qty', label: kind === 'in' ? 'Quantity received' : 'Quantity issued', type: 'number', required: true },
    { name: 'moved_at', label: 'When', type: 'datetime-local', required: true },
    ...(kind === 'out' ? [{ name: 'mill_id', label: 'Used on mill', type: 'select', options: opts(mills) }] : []),
    ...(kind === 'in' ? [{ name: 'supplier', label: 'Supplier' }, { name: 'ref_no', label: 'Bill / challan no.' }] : []),
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ]
  async function submit(v) {
    const payload = { ...clean(v, fields), kind }
    if (!(payload.qty > 0)) throw new Error('Enter a quantity above zero')
    try {
      const res = await saveInsert('spare_moves', payload, `${kind === 'in' ? 'Received' : 'Issued'} ${payload.qty} - ${items.find((i) => i.id === payload.item_id)?.name ?? ''}`)
      if (res.queued) toast('No connection. Saved on this device and will be sent automatically.')
    } catch (e) {
      throw isNetworkError(e) ? new Error('No connection.') : e
    }
    onDone()
  }
  return <Form grid fields={fields} initial={{ item_id: item?.id ?? '', moved_at: toLocalInput() }} onSubmit={submit} onCancel={onDone} submitLabel={kind === 'in' ? 'Receive' : 'Issue'} />
}

function StockTab() {
  const { role, name } = useAuth()
  const stock = useRows('spare_stock', { order: 'name', asc: true })
  const mills = useRows('mills', { order: 'name', asc: true })
  const [move, setMove] = useState(null) // { kind, item }
  const [cat, setCat] = useState('')
  const canMove = can(role, 'spare_moves', 'insert')
  const items = stock.rows.filter((i) => i.active)
  const shown = items.filter((i) => !cat || i.category === cat)
  const low = items.filter((i) => Number(i.on_hand) <= Number(i.reorder_level) && Number(i.reorder_level) > 0)
  const columns = [
    { label: 'Item', key: 'name' },
    { label: 'Category', render: (r) => catLabel[r.category] },
    { label: 'On hand', render: (r) => `${fmtNum(r.on_hand)} ${r.unit}` },
    { label: 'Reorder at', render: (r) => (Number(r.reorder_level) ? `${fmtNum(r.reorder_level)} ${r.unit}` : '-') },
  ]
  return (
    <section>
      <div className="head">
        <h2>Spares &amp; consumables</h2>
        <div className="headbtns">
          {shown.length > 0 && (
            <button className="btn" onClick={() => exportList('Spares stock', [...columns, { label: 'Status', render: (r) => (low.includes(r) ? 'Reorder' : 'OK') }], shown, name)}>
              <FileDown size={17} /> PDF
            </button>
          )}
          {canMove && <button className="btn" onClick={() => setMove({ kind: 'out' })}><PackageMinus size={17} /> Issue</button>}
          {canMove && <button className="btn primary" onClick={() => setMove({ kind: 'in' })}><PackagePlus size={17} /> Receive</button>}
        </div>
      </div>
      {low.length > 0 && (
        <div className="notice"><strong>{low.length} to reorder:</strong> {low.map((i) => i.name).join(', ')}</div>
      )}
      <OutboxList filter={(i) => i.table === 'spare_moves'} />
      <div className="tabs">
        <button className={cat === '' ? 'on' : ''} onClick={() => setCat('')}>All</button>
        {CATEGORIES.filter((c) => items.some((i) => i.category === c.value)).map((c) => (
          <button key={c.value} className={cat === c.value ? 'on' : ''} onClick={() => setCat(c.value)}>{c.label}</button>
        ))}
      </div>
      {stock.error && <div className="error">{stock.error}</div>}
      {stock.stale && <div className="notice">No connection. Showing stock as last saved on this device.</div>}
      {!stock.loading && shown.length === 0 ? (
        <div className="empty">No items yet. Add them on the Items tab, then receive stock.</div>
      ) : (
        <div className="tablewrap">
          <table className="stack">
            <thead>
              <tr>{columns.map((c) => <th key={c.label}>{c.label}</th>)}<th>Status</th><th /></tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const isLow = low.includes(r)
                return (
                  <tr key={r.id} className={isLow ? 'low' : ''}>
                    {columns.map((c) => <td key={c.label} data-label={c.label}>{c.render ? c.render(r) : r[c.key]}</td>)}
                    <td data-label="Status">{isLow ? <Badge tone="red">Reorder</Badge> : <Badge tone="green">OK</Badge>}</td>
                    <td className="actions">
                      {canMove && <button className="link" onClick={() => setMove({ kind: 'out', item: r })}>Issue</button>}
                      {canMove && <button className="link" onClick={() => setMove({ kind: 'in', item: r })}>Receive</button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {move && (
        <Modal title={move.kind === 'in' ? 'Receive stock' : 'Issue stock'} onClose={() => setMove(null)}>
          <MoveForm kind={move.kind} item={move.item} items={items} mills={mills.rows} onDone={() => { setMove(null); stock.reload() }} />
        </Modal>
      )}
    </section>
  )
}

function MovesTab() {
  const items = useRows('spare_items', { order: 'name', asc: true })
  const mills = useRows('mills', { order: 'name', asc: true })
  return (
    <DataPage
      title="Stock movements"
      table="spare_moves"
      select="*, spare_items(name, unit), mills(name)"
      order="moved_at"
      offline
      dateField="moved_at"
      offlineLabel={(p) => `Stock ${p.kind}: ${p.qty}`}
      defaults={{ moved_at: toLocalInput(), kind: 'in' }}
      fields={[
        { name: 'item_id', label: 'Item', type: 'select', required: true, options: opts(items.rows) },
        { name: 'kind', label: 'Type', type: 'select', required: true, options: [{ value: 'in', label: 'Received' }, { value: 'out', label: 'Issued' }, { value: 'adjust', label: 'Stock-count correction (+ or -)' }] },
        { name: 'qty', label: 'Quantity', type: 'number', required: true },
        { name: 'moved_at', label: 'When', type: 'datetime-local', required: true },
        { name: 'mill_id', label: 'Used on mill', type: 'select', options: opts(mills.rows) },
        { name: 'supplier', label: 'Supplier' },
        { name: 'ref_no', label: 'Bill / challan no.' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ]}
      columns={[
        { label: 'When', render: (r) => fmtDateTime(r.moved_at) },
        { label: 'Item', render: (r) => r.spare_items?.name },
        { label: 'Type', render: (r) => <Badge tone={r.kind === 'in' ? 'green' : r.kind === 'out' ? 'amber' : 'blue'}>{{ in: 'received', out: 'issued', adjust: 'correction' }[r.kind]}</Badge> },
        { label: 'Qty', render: (r) => `${fmtNum(r.qty)} ${r.spare_items?.unit ?? ''}` },
        { label: 'Mill', render: (r) => r.mills?.name || '-' },
        { label: 'Supplier / bill', render: (r) => [r.supplier, r.ref_no].filter(Boolean).join(' / ') || '-' },
        { label: 'Notes', key: 'notes' },
      ]}
    />
  )
}

function ItemsTab() {
  return (
    <DataPage
      title="Items"
      table="spare_items"
      order="name"
      asc
      defaults={{ category: 'grinding_media', unit: 'nos', reorder_level: 0, active: true }}
      fields={[
        { name: 'name', label: 'Name (e.g. Alumina balls 25 mm)', required: true },
        { name: 'category', label: 'Category', type: 'select', required: true, options: CATEGORIES },
        { name: 'unit', label: 'Unit (nos, kg, litre...)', required: true },
        { name: 'reorder_level', label: 'Reorder when stock is at or below', type: 'number', required: true },
        { name: 'location', label: 'Stored at' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
        { name: 'active', label: 'Active', type: 'checkbox' },
      ]}
      columns={[
        { label: 'Name', key: 'name' },
        { label: 'Category', render: (r) => catLabel[r.category] },
        { label: 'Unit', key: 'unit' },
        { label: 'Reorder at', key: 'reorder_level' },
        { label: 'Stored at', key: 'location' },
        { label: 'Active', render: (r) => (r.active ? 'Yes' : 'No') },
      ]}
    />
  )
}

export default function Spares() {
  const [tab, setTab] = useState('Stock')
  const tabs = { Stock: StockTab, Movements: MovesTab, Items: ItemsTab }
  const Tab = tabs[tab]
  return (
    <div>
      <div className="tabs">
        {Object.keys(tabs).map((k) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{k}</button>
        ))}
      </div>
      <Tab key={tab} />
    </div>
  )
}
