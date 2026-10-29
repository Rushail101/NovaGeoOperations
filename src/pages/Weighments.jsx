import { useState } from 'react'
import { DataPage, useRows, opts, fmtKg, fmtDate, fmtDateTime, toLocalInput, daysLeft, Modal, Badge } from '../lib.jsx'
import { useAuth } from '../auth.jsx'
import { supabase } from '../supabase.js'
import { PhotoLink } from '../PhotoField.jsx'
import { AttachFiles, InboundPapersForm } from '../Papers.jsx'
import { missingPapers, permitProblems, permitVariance, normVehicle } from '../papers.js'
import { can } from '../perms.js'
import { useFinance } from '../financeLink.js'

const ALL_TYPES = [
  { value: 'inbound', label: 'Inbound quartz' },
  { value: 'mill_feed', label: 'Mill feed' },
  { value: 'dispatch', label: 'Bulk dispatch (no bags)' },
]
const tone = { inbound: 'blue', mill_feed: 'amber', dispatch: 'green' }

export default function Weighments({ only, title = 'Weighments' }) {
  const { role } = useAuth()
  const [filter, setFilter] = useState(only || '')
  const [papers, setPapers] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const suppliers = useRows('suppliers', { order: 'name', asc: true })
  const mills = useRows('mills', { order: 'name', asc: true })
  const grades = useRows('grades', { order: 'name', asc: true })
  const vehicles = useRows('vehicles', { order: 'vehicle_no', asc: true, limit: 1000 })
  const settings = useRows('plant_settings')
  const orders = useRows('orders', { select: 'id, order_no, status, customers(name)', order: 'created_at' })

  const fin = useFinance({ action: 'purchases', days: 400 })
  const linked = useRows('weighments', { select: 'id, finance_purchase_id, net_kg', order: 'weighed_at', limit: 1000 })
  const finOn = !fin.error && fin.rows.length > 0
  const purchaseOf = (id) => fin.rows.find((p) => String(p.id) === String(id))
  const pLabel = (p) => `${p.invoice_no || p.po_no || '#' + p.id} - ${fmtDate(p.p_date)} - ${p.quantity_mt} t`
  const receivedKg = (pid, skip) => linked.rows.filter((w) => String(w.finance_purchase_id) === String(pid) && w.id !== skip).reduce((a, w) => a + Number(w.net_kg || 0), 0)

  const limit = Number(settings.rows.find((s) => s.key === 'permit_variance_pct')?.value ?? 3)
  const openOrders = orders.rows.filter((o) => !['dispatched', 'cancelled'].includes(o.status))
  // Truck dispatches with bags are done on the Dispatch tab. Loose (unbagged) dispatch is for admin and supervisor only.
  const bulkOk = ['admin', 'supervisor'].includes(role)
  const types = ALL_TYPES.filter((t) => (only ? t.value === only : t.value !== 'dispatch' || bulkOk))
  const canPapers = can(role, 'weighments', 'update') || ['weighbridge'].includes(role)

  const net = (v) => (v.gross_kg !== '' && v.gross_kg != null && v.tare_kg !== '' && v.tare_kg != null ? Number(v.gross_kg) - Number(v.tare_kg) : null)
  const leaseNote = (v) => {
    const s = suppliers.rows.find((x) => x.id === v.supplier_id)
    const n = daysLeft(s?.lease_valid_until)
    if (n == null) return s && !s.lease_no ? 'No mining lease on file for this supplier. Add it under Masters > Suppliers.' : null
    return n < 0 ? `This supplier's lease expired ${-n} days ago. Do not accept material without a valid permit.` : n <= 30 ? `This supplier's lease expires in ${n} days.` : null
  }

  const fields = [
    { name: 'type', label: 'Type', type: 'select', required: true, options: types },
    { name: 'weighed_at', label: 'Date & time', type: 'datetime-local', required: true },
    {
      name: 'vehicle_no', label: 'Vehicle no.', showIf: (v) => v.type !== 'mill_feed', datalist: vehicles.rows.map((x) => x.vehicle_no),
      onPick: (val, v) => {
        const m = vehicles.rows.find((x) => normVehicle(x.vehicle_no) === normVehicle(val))
        return m?.default_tare_kg != null && (v.tare_kg === '' || v.tare_kg == null) ? { tare_kg: String(m.default_tare_kg) } : {}
      },
    },
    { name: 'gross_kg', label: 'Gross (kg)', type: 'number', required: true },
    { name: 'tare_kg', label: 'Tare (kg)', type: 'number', required: true },
    { name: 'supplier_id', label: 'Supplier', type: 'select', options: opts(suppliers.rows), showIf: (v) => v.type === 'inbound', hintFn: leaseNote, onPick: () => ({ finance_purchase_id: '' }) },
    {
      name: 'finance_purchase_id', label: 'Finance purchase / bill (optional)', type: 'select', showIf: (v) => v.type === 'inbound' && finOn,
      optionsFor: (v) => {
        const fid = suppliers.rows.find((x) => x.id === v.supplier_id)?.finance_id
        return fid == null ? [] : fin.rows.filter((p) => Number(p.supplier_id) === Number(fid)).map((p) => ({ value: String(p.id), label: pLabel(p) }))
      },
      hintFn: (v) => {
        const sup = suppliers.rows.find((x) => x.id === v.supplier_id)
        if (!v.finance_purchase_id) return sup && sup.finance_id == null ? 'This supplier is not linked to finance yet (Masters > Finance link), so its bills cannot be picked.' : null
        const p = purchaseOf(v.finance_purchase_id)
        if (!p) return null
        const billed = Number(p.quantity_mt) * 1000
        const total = receivedKg(p.id, v.__id) + (net(v) || 0)
        const pct = billed > 0 ? ((total - billed) / billed) * 100 : null
        return `Billed ${fmtKg(billed)}. With this load received ${fmtKg(total)}${pct != null ? ` (${pct > 0 ? '+' : ''}${pct.toFixed(1)}% vs bill)` : ''}.`
      },
    },
    { name: 'supplier_invoice_no', label: 'Supplier invoice no.', showIf: (v) => v.type === 'inbound' },
    { name: 'supplier_invoice_date', label: 'Invoice date', type: 'date', showIf: (v) => v.type === 'inbound' },
    { name: 'permit_no', label: 'Transit permit no.', showIf: (v) => v.type === 'inbound' },
    {
      name: 'permit_qty_kg', label: 'Quantity on permit (kg)', type: 'number', showIf: (v) => v.type === 'inbound',
      hintFn: (v) => {
        const p = permitProblems({ ...v, net_kg: net(v) }, limit).filter((x) => x.includes('permit quantity'))
        return p.length ? `Check: ${p[0]} (limit ${limit}%).` : null
      },
    },
    {
      name: 'permit_valid_until', label: 'Permit valid until', type: 'date', showIf: (v) => v.type === 'inbound',
      hintFn: (v) => (permitProblems({ ...v, weighed_at: v.weighed_at ? new Date(v.weighed_at).toISOString() : null }, 100).some((x) => x.includes('expired')) ? 'This permit had expired on the weighing date.' : null),
    },
    { name: 'eway_bill_no', label: 'E-way bill no. (if any)', showIf: (v) => v.type === 'inbound' },
    { name: 'invoice_no', label: 'Invoice no.', showIf: (v) => v.type === 'dispatch' },
    { name: 'mill_id', label: 'Mill', type: 'select', required: true, options: opts(mills.rows), showIf: (v) => v.type === 'mill_feed' },
    { name: 'order_id', label: 'Order', type: 'select', required: true, options: opts(openOrders, (o) => `${o.order_no} - ${o.customers?.name ?? ''}`), showIf: (v) => v.type === 'dispatch' },
    { name: 'grade_id', label: 'Grade', type: 'select', options: opts(grades.rows), showIf: (v) => v.type !== 'inbound' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
    { name: 'doc_paths', label: 'Invoice, permit and other papers (PDF or photo)', type: 'docs', folder: 'weighment-docs', showIf: (v) => v.type !== 'mill_feed' },
    { name: 'photo_paths', label: 'Photo of slip or vehicle', type: 'photos', folder: 'weighments' },
  ]

  async function rememberVehicle(row) {
    const no = (row.vehicle_no || '').trim()
    if (!no || row.type === 'mill_feed' || row.tare_kg == null) return
    if (vehicles.rows.some((x) => normVehicle(x.vehicle_no) === normVehicle(no))) return
    await supabase.from('vehicles').insert({ vehicle_no: no, default_tare_kg: row.tare_kg })
  }

  const checks = (() => {
    const g = {}
    for (const w of linked.rows) if (w.finance_purchase_id != null) (g[w.finance_purchase_id] ||= []).push(w)
    return Object.entries(g).map(([id, ws]) => {
      const p = purchaseOf(id)
      if (!p) return null
      const billed = Number(p.quantity_mt) * 1000
      const got = ws.reduce((a, w) => a + Number(w.net_kg || 0), 0)
      const pct = billed > 0 ? ((got - billed) / billed) * 100 : null
      const sup = suppliers.rows.find((x) => Number(x.finance_id) === Number(p.supplier_id))
      return { id, p, sup, billed, got, pct, loads: ws.length }
    }).filter(Boolean).sort((a, b) => Math.abs(b.pct ?? 0) - Math.abs(a.pct ?? 0))
  })()
  const checkPanel = checks.length > 0 && (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="tag">Purchase check (weighbridge vs finance bill)</div>
      <div className="tablewrap">
        <table className="stack">
          <thead><tr><th>Bill</th><th>Supplier</th><th>Billed</th><th>Received</th><th>Loads</th><th>Difference</th></tr></thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.id}>
                <td data-label="Bill">{c.p.invoice_no || c.p.po_no || '#' + c.p.id} <span className="muted">{fmtDate(c.p.p_date)}</span></td>
                <td data-label="Supplier">{c.sup?.name || '-'}</td>
                <td data-label="Billed">{fmtKg(c.billed)}</td>
                <td data-label="Received">{fmtKg(c.got)}</td>
                <td data-label="Loads">{c.loads}</td>
                <td data-label="Difference">{c.pct == null ? '-' : <Badge tone={Math.abs(c.pct) > limit ? 'red' : 'green'}>{c.pct > 0 ? '+' : ''}{c.pct.toFixed(1)}%</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <small className="muted">Flagged red when the difference is more than {limit}% (the same limit as permits, under Masters > Settings). A bill split across several trucks is added up.</small>
    </div>
  )
  const extra = only ? checkPanel || null : (
    <div className="tabs">
      {[{ value: '', label: 'All' }, ...ALL_TYPES].map((t) => (
        <button key={t.value} className={filter === t.value ? 'on' : ''} onClick={() => setFilter(t.value)}>{t.label}</button>
      ))}
    </div>
  )

  return (
    <>
      <DataPage
        key={filter + reloadKey}
        title={title}
        table="weighments"
        select="*, suppliers(name), mills(name), orders(order_no), grades(name), creator:profiles!created_by(full_name, username)"
        order="weighed_at"
        dateField="weighed_at"
        eq={filter ? ['type', filter] : undefined}
        fields={fields}
        defaults={{ type: filter && filter !== 'dispatch' ? filter : 'inbound', weighed_at: toLocalInput() }}
        extra={extra}
        offline
        afterSave={rememberVehicle}
        offlineLabel={(p) => `Weighment: ${p.type?.replace('_', ' ')} ${p.vehicle_no || ''} net ${fmtKg((p.gross_kg ?? 0) - (p.tare_kg ?? 0))}`}
        rowActions={(r) => canPapers && r.type !== 'mill_feed' && <button className="link" onClick={() => setPapers(r)}>Papers</button>}
        columns={[
          { label: 'When', render: (r) => fmtDateTime(r.weighed_at) },
          { label: 'Type', render: (r) => <Badge tone={tone[r.type]}>{r.type.replace('_', ' ')}</Badge> },
          { label: 'Vehicle', key: 'vehicle_no' },
          { label: 'Gross', render: (r) => fmtKg(r.gross_kg) },
          { label: 'Tare', render: (r) => fmtKg(r.tare_kg) },
          { label: 'Net', render: (r) => <strong>{fmtKg(r.net_kg)}</strong> },
          { label: 'Ref', render: (r) => r.orders?.order_no || r.mills?.name || r.suppliers?.name || r.lot_no || '-' },
          { label: 'Invoice', render: (r) => (r.type === 'inbound' ? r.supplier_invoice_no : r.invoice_no) || '-' },
          {
            label: 'Permit',
            render: (r) => {
              if (r.type !== 'inbound') return '-'
              const bad = permitProblems(r, limit)
              const v = permitVariance(r)
              return (
                <>
                  {r.permit_no || '-'}
                  {r.permit_qty_kg != null && v != null && <span className="muted"> ({v > 0 ? '+' : ''}{v.toFixed(1)}%)</span>}
                  {bad.length > 0 && <> <Badge tone="red" >check</Badge></>}
                </>
              )
            },
          },
          {
            label: 'Papers',
            render: (r) => {
              if (r.type === 'mill_feed') return '-'
              const m = missingPapers(r)
              return m.length ? <span className="flag" title={m.join(', ')}>missing: {m.join(', ')}</span> : <Badge tone="green">complete</Badge>
            },
          },
          { label: 'Files', render: (r) => <PhotoLink paths={[...(r.doc_paths || []), ...(r.photo_paths || [])]} /> },
          { label: 'By', render: (r) => r.creator?.full_name || r.creator?.username || '-' },
        ]}
      />
      {papers && (
        <Modal title={`Papers: ${papers.vehicle_no || papers.type}`} onClose={() => setPapers(null)}>
          {papers.type === 'inbound' ? (
            <InboundPapersForm row={papers} onDone={() => { setPapers(null); setReloadKey((k) => k + 1) }} />
          ) : (
            <AttachFiles row={papers} folder="dispatch" hint="Attach the invoice copy, e-way bill, LR and lab certificate for this truck. Invoice and e-way numbers are on the Dispatch page." onDone={() => { setPapers(null); setReloadKey((k) => k + 1) }} />
          )}
        </Modal>
      )}
    </>
  )
}
