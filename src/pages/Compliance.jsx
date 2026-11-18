import { useMemo, useState } from 'react'
import { ShieldCheck, FileDown, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { supabase } from '../supabase.js'
import { useAuth } from '../auth.jsx'
import { DataPage, useRows, opts, fmtDate, fmtDateTime, fmtNum, todayIso, toLocalInput, Badge, Expiry, daysLeft, toast, Modal, Form } from '../lib.jsx'
import { mineralLedger, movementIssues } from '../mineral.js'

// Plant-side compliance: one place for the mineral stock account, licences and returns,
// worker health (silica), monitoring results and incidents.

const t3 = (kg) => (Number(kg) / 1000).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
const monthStart = (m) => `${m}-01`
const monthEnd = (m) => { const [y, mm] = m.split('-').map(Number); return `${m}-${String(new Date(y, mm, 0).getDate()).padStart(2, '0')}` }
const thisMonth = () => todayIso().slice(0, 7)
const MANAGERS = ['admin', 'supervisor', 'viewer']

export default function Compliance() {
  const { role } = useAuth()
  const manager = MANAGERS.includes(role)
  const tabs = manager
    ? { Overview, 'Mineral account': MineralAccount, 'Returns & dates': Returns, 'Workers & health': Workers, Monitoring, Incidents }
    : { Incidents }
  const first = Object.keys(tabs)[0]
  const [tab, setTab] = useState(() => { const t = sessionStorage.getItem('compliance-tab'); return t && tabs[t] ? t : first })
  const Tab = tabs[tab] || tabs[first]
  const pick = (k) => { setTab(k); try { sessionStorage.setItem('compliance-tab', k) } catch {} }
  return (
    <div>
      <div className="tabs">
        {Object.keys(tabs).map((k) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => pick(k)}>{k}</button>)}
      </div>
      <Tab go={pick} />
    </div>
  )
}

// ---------------------------------------------------------------- Overview
function Overview({ go }) {
  const licences = useRows('licences', { order: 'valid_until', asc: true })
  const items = useRows('statutory_items', { order: 'next_due', asc: true })
  const health = useRows('worker_health_status', { order: 'name', asc: true })
  const mon = useRows('env_monitoring', { order: 'sampled_on', limit: 300 })
  const inc = useRows('incidents', { order: 'occurred_at', limit: 300 })
  const daily = useRows('mineral_daily', { limit: 20000 })
  const m = thisMonth()
  const w = useRows('weighments', { select: 'id, type, weighed_at, vehicle_no, net_kg, permit_no, permit_qty_kg, permit_valid_until, invoice_no, eway_bill_no, transit_pass_no', range: { field: 'weighed_at', from: `${m}-01T00:00:00+05:30` }, order: 'weighed_at', limit: 2000 })
  const settings = useRows('plant_settings')
  const setting = (k) => settings.rows.find((r) => r.key === k)?.value

  const notSetUp = [items, health, mon, inc, daily].some((x) => /does not exist|schema cache/i.test(x.error || ''))
  if (notSetUp) return <div className="card"><h3>One-time setup needed</h3><p className="muted">Run <code>migration_v8.sql</code> in the Supabase SQL editor, then reload this page.</p></div>

  const lic = licences.rows.filter((l) => l.valid_until != null || !l.licence_no)
  const licBad = lic.filter((l) => !l.valid_until || daysLeft(l.valid_until) <= 60)
  const dueItems = items.rows.filter((i) => i.active && daysLeft(i.next_due) <= (i.remind_days || 15))
  const active = health.rows.filter((h) => !h.left_on)
  const medDue = active.filter((h) => daysLeft(h.next_exam_due) <= 30)
  const medFlag = active.filter((h) => h.last_silicosis || ['unfit', 'refer'].includes(h.last_result))
  const noResp = active.filter((h) => h.exposure === 'high' && !h.respirator_issued_on)
  const yearAgo = new Date(Date.now() - 365 * 864e5).toLocaleDateString('en-CA')
  const exceeded = mon.rows.filter((r) => r.exceeded && r.sampled_on >= yearAgo)
  const monDue = Object.values(mon.rows.reduce((a, r) => { const k = `${r.kind}|${r.location}`; if (!a[k] || a[k].sampled_on < r.sampled_on) a[k] = r; return a }, {})).filter((r) => r.next_due && daysLeft(r.next_due) <= 15)
  const openInc = inc.rows.filter((i) => !i.closed)
  const unreported = inc.rows.filter((i) => ['serious', 'fatal'].includes(i.severity) && !i.reported_to_authority)
  const issues = movementIssues(w.rows, todayIso(), setting('permit_variance_pct') || 2)
  const led = daily.rows.length ? mineralLedger(daily.rows, monthStart(m), monthEnd(m)) : null

  const Row = ({ ok, title, detail, onOpen }) => (
    <div className={'checkrow ' + (ok === true ? 'ok' : ok === 'warn' ? 'warn' : 'bad')}>
      {ok === true ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
      <div style={{ flex: 1, minWidth: 0 }}><div className="checktitle">{title}</div>{detail && <div className="muted checkdetail">{detail}</div>}</div>
      {onOpen && <button className="link" onClick={onOpen}>Open</button>}
    </div>
  )
  const list = (xs, f, max = 4) => xs.slice(0, max).map(f).join(' · ') + (xs.length > max ? ` · +${xs.length - max} more` : '')

  const problems = licBad.length + dueItems.filter((i) => daysLeft(i.next_due) < 0).length + medDue.filter((h) => daysLeft(h.next_exam_due) < 0).length + exceeded.length + unreported.length + issues.filter((i) => i.level === 'red').length
  return (
    <>
      <div className="stats">
        <div className="stat"><div className="label">Needs action</div><div className="value">{problems}</div><div className="muted">red items below</div></div>
        <div className="stat"><div className="label">Licences valid</div><div className="value">{lic.length - licBad.length} / {lic.length}</div></div>
        <div className="stat"><div className="label">Workers medically current</div><div className="value">{active.length - medDue.length} / {active.length}</div></div>
        <div className="stat"><div className="label">Open incidents</div><div className="value">{openInc.length}</div></div>
      </div>
      <div className="card">
        <h3 style={{ display: 'flex', gap: 8, alignItems: 'center' }}><ShieldCheck size={18} /> Compliance checklist</h3>
        <Row ok={!licBad.length} title={licBad.length ? `${licBad.length} licence(s) expired, expiring within 60 days, or without a date` : 'All licences valid for 60+ days'}
          detail={licBad.length ? list(licBad, (l) => `${l.name}${l.valid_until ? ` (${fmtDate(l.valid_until)})` : ' (no date)'}`) : null} onOpen={() => { location.hash = 'Masters' }} />
        <Row ok={!dueItems.length || (dueItems.every((i) => daysLeft(i.next_due) >= 0) ? 'warn' : false)} title={dueItems.length ? `${dueItems.length} return(s) / duties due soon or overdue` : 'No returns due in the reminder window'}
          detail={dueItems.length ? list(dueItems, (i) => `${i.title} ${daysLeft(i.next_due) < 0 ? 'OVERDUE' : 'due ' + fmtDate(i.next_due)}`) : null} onOpen={() => go('Returns & dates')} />
        <Row ok={!issues.length ? true : issues.some((i) => i.level === 'red') ? false : 'warn'} title={issues.length ? `${issues.length} document gap(s) on this month's loads` : 'Every load this month has its permit / invoice / transit pass'}
          detail={issues.length ? list(issues, (i) => i.text, 3) : null} onOpen={() => go('Mineral account')} />
        <Row ok={led && led.negative.length ? false : true} title={led && led.negative.length ? `Stock went below zero on ${led.negative.length} day(s) this month: an entry is missing` : 'Mineral stock never negative this month'} onOpen={() => go('Mineral account')} />
        <Row ok={!medDue.length || (medDue.every((h) => daysLeft(h.next_exam_due) >= 0) ? 'warn' : false)} title={medDue.length ? `${medDue.length} worker medical(s) overdue or due within 30 days` : 'All worker medicals up to date'}
          detail={medDue.length ? list(medDue, (h) => `${h.name} (${fmtDate(h.next_exam_due)})`) : null} onOpen={() => go('Workers & health')} />
        <Row ok={!medFlag.length} title={medFlag.length ? `${medFlag.length} worker(s) unfit, referred or with suspected silicosis` : 'No worker flagged unfit or with suspected silicosis'}
          detail={medFlag.length ? 'Silicosis is a notifiable disease: inform the Factories / OSH inspector and move the worker away from dust.' : null} onOpen={() => go('Workers & health')} />
        <Row ok={!noResp.length || 'warn'} title={noResp.length ? `${noResp.length} high-exposure worker(s) with no respirator issue recorded` : 'Respirators recorded for all high-exposure workers'} onOpen={() => go('Workers & health')} />
        <Row ok={!exceeded.length} title={exceeded.length ? `${exceeded.length} monitoring result(s) above the limit in the last 12 months` : 'No monitoring result above its limit in the last 12 months'}
          detail={exceeded.length ? list(exceeded, (r) => `${r.parameter} at ${r.location || r.kind}: ${r.result} ${r.unit || ''} (limit ${r.limit_value})`) : null} onOpen={() => go('Monitoring')} />
        <Row ok={!monDue.length || 'warn'} title={monDue.length ? `${monDue.length} monitoring test(s) due` : 'No monitoring due in the next 15 days'} onOpen={() => go('Monitoring')} />
        <Row ok={!unreported.length} title={unreported.length ? `${unreported.length} serious incident(s) not marked as reported to the authority` : 'All serious incidents reported'} onOpen={() => go('Incidents')} />
      </div>
    </>
  )
}

// ---------------------------------------------------------------- Mineral account
function MineralAccount() {
  const { name } = useAuth()
  const [month, setMonth] = useState(thisMonth())
  const daily = useRows('mineral_daily', { limit: 20000 })
  const settings = useRows('plant_settings')
  const setting = (k) => settings.rows.find((r) => r.key === k)?.value
  const from = monthStart(month), to = monthEnd(month)
  const w = useRows('weighments', { select: 'id, type, weighed_at, vehicle_no, net_kg, permit_no, permit_qty_kg, permit_valid_until, invoice_no, eway_bill_no, transit_pass_no, suppliers(name)', range: { field: 'weighed_at', from: `${from}T00:00:00+05:30`, to: `${to}T23:59:59+05:30` }, order: 'weighed_at', asc: true, limit: 3000 })
  const L = useMemo(() => mineralLedger(daily.rows, from, to), [daily.rows, from, to])
  const issues = movementIssues(w.rows, todayIso(), setting('permit_variance_pct') || 2)

  const head = ['Date', 'Raw open', 'Received', 'To washing', 'To mill', 'Raw close', 'Washed made', 'Washed to mill', 'Washed close', 'Powder made', 'Despatched', 'Powder close', 'Rejects']
  const rowOf = (d) => [fmtDate(d.day), t3(d.open.raw), t3(d.raw_in_kg), t3(d.raw_to_wash_kg), t3(d.raw_to_mill_kg), t3(d.close.raw), t3(d.washed_out_kg), t3(d.washed_to_mill_kg), t3(d.close.washed), t3(d.powder_made_kg), t3(d.dispatched_kg), t3(d.close.powder), t3(d.wash_rejects_kg)]
  const T = L.totals
  const foot = ['Total', t3(L.opening.raw), t3(T.raw_in_kg), t3(T.raw_to_wash_kg), t3(T.raw_to_mill_kg), t3(L.closing.raw), t3(T.washed_out_kg), t3(T.washed_to_mill_kg), t3(L.closing.washed), t3(T.powder_made_kg), t3(T.dispatched_kg), t3(L.closing.powder), t3(T.wash_rejects_kg)]
  const label = new Date(from + 'T12:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

  async function pdf() {
    const { exportReport } = await import('../pdf.js')
    const inbound = w.rows.filter((x) => x.type === 'inbound')
    const out = w.rows.filter((x) => x.type === 'dispatch')
    await exportReport({
      title: `Mineral stock account: ${label}`,
      subtitle: `${setting('mineral_state') || 'Telangana'} Mineral Dealer rules · MDL ${setting('mdl_no') || '(set in Masters › Settings)'} · all quantities in tonnes`,
      summary: [
        ['Opening stock (raw / washed / powder)', `${t3(L.opening.raw)} / ${t3(L.opening.washed)} / ${t3(L.opening.powder)}`],
        ['Mineral received', t3(T.raw_in_kg)],
        ['Fed into plant (washing + mills)', t3(T.raw_to_wash_kg + T.raw_to_mill_kg)],
        ['Processed mineral recovered', t3(T.powder_made_kg)],
        ['Despatched', t3(T.dispatched_kg)],
        ['Washing rejects / dumped dust', `${t3(T.wash_rejects_kg)} / ${t3(T.dust_dumped_kg)}`],
        ['Closing stock (raw / washed / powder)', `${t3(L.closing.raw)} / ${t3(L.closing.washed)} / ${t3(L.closing.powder)}`],
      ],
      sections: [
        { heading: 'Daily account', columns: head.map((h, i) => ({ header: h, align: i ? 'right' : undefined })), rows: L.days.map(rowOf), foot },
        { heading: 'Receipts (with transit permits)', columns: [{ header: 'Date' }, { header: 'Vehicle' }, { header: 'From' }, { header: 'Permit no.' }, { header: 'Permit qty t', align: 'right' }, { header: 'Weighed t', align: 'right' }],
          rows: inbound.map((x) => [fmtDateTime(x.weighed_at), x.vehicle_no || '-', x.suppliers?.name || '-', x.permit_no || 'MISSING', x.permit_qty_kg != null ? t3(x.permit_qty_kg) : '-', t3(x.net_kg)]) },
        { heading: 'Despatches (with transit passes)', columns: [{ header: 'Date' }, { header: 'Vehicle' }, { header: 'Invoice' }, { header: 'Transit pass' }, { header: 'E-way bill' }, { header: 'Weighed t', align: 'right' }],
          rows: out.map((x) => [fmtDateTime(x.weighed_at), x.vehicle_no || '-', x.invoice_no || 'MISSING', x.transit_pass_no || 'MISSING', x.eway_bill_no || '-', t3(x.net_kg)]) },
      ],
    }, { user: name, filename: `mineral-account-${month}.pdf` })
  }
  function csv() {
    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`
    const lines = [head, ...L.days.map(rowOf), foot].map((r) => r.map(esc).join(','))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' }))
    a.download = `mineral-account-${month}.csv`
    a.click()
  }

  if (/does not exist|schema cache/i.test(daily.error || '')) return <div className="card"><h3>One-time setup needed</h3><p className="muted">Run <code>migration_v8.sql</code> in the Supabase SQL editor, then reload.</p></div>
  return (
    <section>
      <div className="head">
        <h2>Mineral stock account</h2>
        <div className="headbtns">
          <input type="month" value={month} max={thisMonth()} style={{ width: 'auto' }} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          <button className="btn" onClick={csv}><FileDown size={16} /> CSV</button>
          <button className="btn primary" onClick={pdf}><FileDown size={16} /> PDF for AD Mines</button>
        </div>
      </div>
      <div className="stats">
        <div className="stat"><div className="label">Received</div><div className="value">{t3(T.raw_in_kg)} t</div></div>
        <div className="stat"><div className="label">Washing recovery</div><div className="value">{L.washRecoveryPct != null ? fmtNum(L.washRecoveryPct, 1) + '%' : '-'}</div><div className="muted">{t3(T.wash_rejects_kg)} t rejects</div></div>
        <div className="stat"><div className="label">Mill yield</div><div className="value">{L.millYieldPct != null ? fmtNum(L.millYieldPct, 1) + '%' : '-'}</div><div className="muted">powder ÷ feed</div></div>
        <div className="stat"><div className="label">Despatched</div><div className="value">{t3(T.dispatched_kg)} t</div></div>
        <div className="stat"><div className="label">Closing stock</div><div className="value" style={{ fontSize: 20 }}>{t3(L.closing.raw)} / {t3(L.closing.washed)} / {t3(L.closing.powder)}</div><div className="muted">raw / washed / powder</div></div>
      </div>
      <p className="muted">Daily account of quartz received, fed into the plant, recovered and despatched, as the Mineral Dealer rules require. All figures in tonnes.</p>
      {L.negative.length > 0 && <div className="notice bad">Stock went below zero on {L.negative.map(fmtDate).join(', ')}. A receipt, washing run or mill run is probably missing or entered on the wrong date.</div>}
      {issues.length > 0 && (
        <div className="card">
          <h3>Document gaps this month ({issues.length})</h3>
          {issues.map((i, k) => <div key={k} className={i.level === 'red' ? 'flag' : 'muted'}>• {fmtDate(i.day)}: {i.text}</div>)}
        </div>
      )}
      {daily.loading ? <p className="muted">Loading...</p> : !L.days.length ? <div className="empty">No movements in {label}.</div> : (
        <div className="tablewrap">
          <table className="ledger">
            <thead>
              <tr><th rowSpan={2}>Date</th><th colSpan={5}>Raw quartz</th><th colSpan={3}>Washed quartz</th><th colSpan={3}>Powder</th><th rowSpan={2}>Rejects</th></tr>
              <tr>{head.slice(1, 12).map((h) => <th key={h}>{h.replace(/^(Raw|Washed|Powder) /, '')}</th>)}</tr>
            </thead>
            <tbody>{L.days.map((d) => <tr key={d.day} className={L.negative.includes(d.day) ? 'neg' : ''}>{rowOf(d).map((c, i) => <td key={i} className={i ? 'num' : ''}>{c}</td>)}</tr>)}</tbody>
            <tfoot><tr>{foot.map((c, i) => <td key={i} className={i ? 'num' : ''}>{c}</td>)}</tr></tfoot>
          </table>
        </div>
      )}
      <p className="muted" style={{ marginTop: 10 }}>Opening stock is everything recorded before this month. Mill feed counts against the washed heap from {fmtDate(setting('washing_tracked_from'))} (change in Masters › Settings). Check the result against a physical count every month under Plant Logs › Stock count.</p>
    </section>
  )
}

// ---------------------------------------------------------------- Returns & dates
const FREQ = [{ value: 'monthly', label: 'Every month' }, { value: 'quarterly', label: 'Every quarter' }, { value: 'half_yearly', label: 'Every 6 months' }, { value: 'yearly', label: 'Every year' }, { value: 'once', label: 'Once' }]
function Returns() {
  const { role } = useAuth()
  const [done, setDone] = useState(null)
  const licences = useRows('licences', { order: 'valid_until', asc: true })
  const canEdit = ['admin', 'supervisor'].includes(role)
  return (
    <>
      <div className="card">
        <h3>Licences & consents</h3>
        <p className="muted">Numbers, validity and copies live in Masters › Licences. Renew 60 days before expiry: pollution board consents and the mineral dealer licence take time.</p>
        <div className="tablewrap"><table className="stack"><thead><tr><th>Licence</th><th>Number</th><th>Valid until</th><th>Status</th></tr></thead>
          <tbody>{licences.rows.map((l) => <tr key={l.id}><td data-label="Licence">{l.name}</td><td data-label="Number">{l.licence_no || <span className="flag">not entered</span>}</td><td data-label="Valid until">{fmtDate(l.valid_until)}</td><td data-label="Status">{l.valid_until ? <Expiry date={l.valid_until} /> : <Badge tone="amber">no date</Badge>}</td></tr>)}</tbody></table></div>
      </div>
      <DataPage
        title="Returns & recurring duties"
        table="statutory_items"
        order="next_due"
        asc
        defaults={{ frequency: 'yearly', remind_days: '15', active: true }}
        fields={[
          { name: 'title', label: 'What', required: true },
          { name: 'authority', label: 'Authority' },
          { name: 'frequency', label: 'Repeats', type: 'select', required: true, options: FREQ },
          { name: 'next_due', label: 'Next due', type: 'date', required: true },
          { name: 'remind_days', label: 'Remind this many days before', type: 'number' },
          { name: 'notes', label: 'Notes', type: 'textarea' },
          { name: 'active', label: 'Active', type: 'checkbox' },
        ]}
        columns={[
          { label: 'Due', render: (r) => fmtDate(r.next_due) },
          { label: 'What', render: (r) => <><b>{r.title}</b>{r.notes && <div className="muted small">{r.notes}</div>}</> },
          { label: 'Authority', key: 'authority' },
          { label: 'Status', render: (r) => (!r.active ? <Badge>inactive</Badge> : <Expiry date={r.next_due} />) },
          { label: 'Last done', render: (r) => (r.last_done_on ? `${fmtDate(r.last_done_on)}${r.last_ref ? ' · ' + r.last_ref : ''}` : '-') },
        ]}
        rowActions={(r, reload) => canEdit && r.active && <button className="link" onClick={() => setDone({ r, reload })}>Mark done</button>}
      />
      {done && (
        <Modal title={`Done: ${done.r.title}`} onClose={() => setDone(null)}>
          <Form grid
            fields={[{ name: 'done_on', label: 'Done / filed on', type: 'date', required: true }, { name: 'ref', label: 'Acknowledgement / reference no.' }]}
            initial={{ done_on: todayIso() }}
            onCancel={() => setDone(null)}
            onSubmit={async (v) => {
              const { error } = await supabase.rpc('mark_statutory_done', { p_id: done.r.id, p_done: v.done_on, p_ref: v.ref || '' })
              if (error) throw error
              toast(done.r.frequency === 'once' ? 'Marked done' : 'Marked done, next due date moved forward')
              done.reload(); setDone(null)
            }} />
        </Modal>
      )}
    </>
  )
}

// ---------------------------------------------------------------- Workers & health
const AREAS = ['mill', 'packing', 'washing', 'lab', 'weighbridge', 'maintenance', 'office', 'other'].map((x) => ({ value: x, label: x[0].toUpperCase() + x.slice(1) }))
const RESULT = { fit: 'green', fit_with_restrictions: 'amber', unfit: 'red', refer: 'red' }
function Workers() {
  const { role } = useAuth()
  const status = useRows('worker_health_status', { order: 'name', asc: true })
  const byId = Object.fromEntries(status.rows.map((s) => [s.id, s]))
  const [med, setMed] = useState(null)
  const canMed = ['admin', 'supervisor'].includes(role)
  return (
    <>
      <div className="notice">Quartz dust contains free silica. Workers in the mill, packing and washing areas need a pre-employment medical, a periodic one (yearly by default, with chest X-ray and lung function), and a respirator. Medical details are visible only to admins and supervisors.</div>
      <DataPage
        title="Workers"
        table="workers"
        order="name"
        asc
        afterSave={() => status.reload()}
        defaults={{ area: 'mill', exposure: 'high', medical_every_months: '12' }}
        fields={[
          { name: 'name', label: 'Name', required: true },
          { name: 'emp_code', label: 'Employee code' },
          { name: 'area', label: 'Works in', type: 'select', required: true, options: AREAS },
          { name: 'exposure', label: 'Dust exposure', type: 'select', required: true, options: [{ value: 'high', label: 'High (mill, packing, bag filter)' }, { value: 'medium', label: 'Medium (washing, yard)' }, { value: 'low', label: 'Low (office, weighbridge)' }] },
          { name: 'phone', label: 'Phone' },
          { name: 'joined_on', label: 'Joined', type: 'date' },
          { name: 'medical_every_months', label: 'Medical every (months)', type: 'number' },
          { name: 'respirator_issued_on', label: 'Respirator last issued', type: 'date' },
          { name: 'training_on', label: 'Dust-safety training on', type: 'date' },
          { name: 'left_on', label: 'Left on', type: 'date' },
          { name: 'notes', label: 'Notes', type: 'textarea' },
        ]}
        columns={[
          { label: 'Name', render: (r) => <><b>{r.name}</b>{r.emp_code && <span className="muted"> · {r.emp_code}</span>}{r.left_on && <Badge>left</Badge>}</> },
          { label: 'Area', render: (r) => `${r.area} · ${r.exposure}` },
          { label: 'Last medical', render: (r) => { const s = byId[r.id]; return s?.last_exam_on ? <>{fmtDate(s.last_exam_on)} <Badge tone={RESULT[s.last_result]}>{s.last_result?.replace(/_/g, ' ')}</Badge>{s.last_silicosis && <Badge tone="red">silicosis?</Badge>}</> : canMed ? <Badge tone="amber">none recorded</Badge> : '-' } },
          { label: 'Next due', render: (r) => (r.left_on ? '-' : byId[r.id]?.next_exam_due ? <Expiry date={byId[r.id].next_exam_due} /> : '-') },
          { label: 'Respirator', render: (r) => (r.respirator_issued_on ? fmtDate(r.respirator_issued_on) : r.exposure === 'high' ? <span className="flag">not recorded</span> : '-') },
        ]}
        rowActions={(r) => canMed && <button className="link" onClick={() => setMed(r)}>Medicals</button>}
      />
      {med && <Medicals worker={med} onClose={() => { setMed(null); status.reload() }} />}
    </>
  )
}

function Medicals({ worker, onClose }) {
  return (
    <Modal title={`Medical record: ${worker.name}`} onClose={onClose} wide>
      <DataPage
        title="Medical examinations"
        table="worker_medicals"
        eq={['worker_id', worker.id]}
        order="exam_on"
        dateField="exam_on"
        defaults={{ worker_id: worker.id, exam_on: todayIso(), kind: 'periodic', result: 'fit', chest_xray: 'normal', lung_function: 'normal' }}
        fields={[
          { name: 'worker_id', label: 'Worker', type: 'select', required: true, readOnly: true, options: [{ value: worker.id, label: worker.name }] },
          { name: 'exam_on', label: 'Examined on', type: 'date', required: true },
          { name: 'kind', label: 'Type', type: 'select', required: true, options: [{ value: 'pre_employment', label: 'Pre-employment' }, { value: 'periodic', label: 'Periodic' }, { value: 'exit', label: 'Exit' }, { value: 'special', label: 'Special / after illness' }] },
          { name: 'doctor', label: 'Doctor / certifying surgeon' },
          { name: 'chest_xray', label: 'Chest X-ray', type: 'select', options: [{ value: 'normal', label: 'Normal' }, { value: 'abnormal', label: 'Abnormal' }, { value: 'not_done', label: 'Not done' }] },
          { name: 'lung_function', label: 'Lung function (PFT)', type: 'select', options: [{ value: 'normal', label: 'Normal' }, { value: 'reduced', label: 'Reduced' }, { value: 'not_done', label: 'Not done' }] },
          { name: 'result', label: 'Result', type: 'select', required: true, options: [{ value: 'fit', label: 'Fit' }, { value: 'fit_with_restrictions', label: 'Fit with restrictions' }, { value: 'unfit', label: 'Unfit' }, { value: 'refer', label: 'Refer to specialist' }] },
          { name: 'silicosis_suspected', label: 'Silicosis suspected', type: 'checkbox' },
          { name: 'notes', label: 'Notes', type: 'textarea' },
        ]}
        columns={[
          { label: 'Date', render: (r) => fmtDate(r.exam_on) },
          { label: 'Type', render: (r) => r.kind.replace('_', ' ') },
          { label: 'X-ray / PFT', render: (r) => `${r.chest_xray || '-'} / ${r.lung_function || '-'}` },
          { label: 'Result', render: (r) => <><Badge tone={RESULT[r.result]}>{r.result.replace(/_/g, ' ')}</Badge>{r.silicosis_suspected && <Badge tone="red">silicosis?</Badge>}</> },
          { label: 'Doctor', key: 'doctor' },
        ]}
      />
    </Modal>
  )
}

// ---------------------------------------------------------------- Monitoring
const KINDS = [
  { value: 'workplace_dust', label: 'Workplace respirable dust' }, { value: 'free_silica', label: 'Free silica in dust' },
  { value: 'stack', label: 'Stack / bag filter emission' }, { value: 'ambient_air', label: 'Ambient air (PM10 / PM2.5)' },
  { value: 'noise', label: 'Noise' }, { value: 'effluent', label: 'Wash water / effluent' }, { value: 'groundwater', label: 'Groundwater level / quality' }, { value: 'other', label: 'Other' },
]
const kindLabel = Object.fromEntries(KINDS.map((k) => [k.value, k.label]))
function Monitoring() {
  return (
    <DataPage
      title="Monitoring results"
      table="env_monitoring"
      order="sampled_on"
      dateField="sampled_on"
      defaults={{ sampled_on: todayIso(), kind: 'workplace_dust', unit: 'mg/m³' }}
      extra={<p className="muted">Enter each test report from the approved lab. The limit to compare against is in your consent order or the lab report. Anything above the limit is flagged on the Overview.</p>}
      fields={[
        { name: 'sampled_on', label: 'Sampled on', type: 'date', required: true },
        { name: 'kind', label: 'What was tested', type: 'select', required: true, options: KINDS },
        { name: 'location', label: 'Where', hint: 'e.g. Mill 1 floor, packing, bag filter stack, wash pond' },
        { name: 'parameter', label: 'Parameter', required: true, hint: 'e.g. Respirable dust, PM10, Free silica %, TSS, dB(A)' },
        { name: 'result', label: 'Result', type: 'number' },
        { name: 'unit', label: 'Unit' },
        { name: 'limit_value', label: 'Limit', type: 'number' },
        { name: 'lab', label: 'Lab' },
        { name: 'report_no', label: 'Report no.' },
        { name: 'next_due', label: 'Next test due', type: 'date' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ]}
      columns={[
        { label: 'Date', render: (r) => fmtDate(r.sampled_on) },
        { label: 'Test', render: (r) => kindLabel[r.kind] },
        { label: 'Where', key: 'location' },
        { label: 'Result', render: (r) => <>{r.parameter}: <b>{r.result ?? '-'}</b> {r.unit} {r.limit_value != null && <span className="muted">(limit {r.limit_value})</span>} {r.exceeded ? <Badge tone="red">above limit</Badge> : r.result != null && r.limit_value != null ? <Badge tone="green">ok</Badge> : null}</> },
        { label: 'Lab / report', render: (r) => [r.lab, r.report_no].filter(Boolean).join(' · ') || '-' },
        { label: 'Next due', render: (r) => (r.next_due ? <Expiry date={r.next_due} /> : '-') },
      ]}
    />
  )
}

// ---------------------------------------------------------------- Incidents
const INC = [{ value: 'injury', label: 'Injury' }, { value: 'near_miss', label: 'Near miss' }, { value: 'dangerous_occurrence', label: 'Dangerous occurrence' }, { value: 'fire', label: 'Fire' }, { value: 'environmental', label: 'Environmental (spill, pond overflow)' }, { value: 'other', label: 'Other' }]
const incLabel = Object.fromEntries(INC.map((k) => [k.value, k.label]))
function Incidents() {
  const workers = useRows('workers', { select: 'id, name, left_on', order: 'name', asc: true })
  return (
    <DataPage
      title="Incidents & near misses"
      table="incidents"
      order="occurred_at"
      dateField="occurred_at"
      offline
      offlineLabel={(p) => `Incident: ${incLabel[p.kind]}`}
      defaults={{ occurred_at: toLocalInput(), kind: 'near_miss', severity: 'none', days_lost: '0' }}
      extra={<p className="muted">Record every injury and near miss, however small. Serious injuries and dangerous occurrences must be reported to the Factories / OSH inspector within the time the rules set; tick "Reported" once done.</p>}
      fields={[
        { name: 'occurred_at', label: 'When', type: 'datetime-local', required: true },
        { name: 'kind', label: 'Type', type: 'select', required: true, options: INC },
        { name: 'severity', label: 'Severity', type: 'select', required: true, options: [{ value: 'none', label: 'No injury' }, { value: 'minor', label: 'Minor (first aid)' }, { value: 'serious', label: 'Serious (hospital / days lost)' }, { value: 'fatal', label: 'Fatal' }] },
        { name: 'area', label: 'Where' },
        { name: 'worker_id', label: 'Worker involved', type: 'select', options: opts(workers.rows.filter((x) => !x.left_on)) },
        { name: 'person', label: 'Or name (visitor / contractor)' },
        { name: 'description', label: 'What happened', type: 'textarea', required: true },
        { name: 'immediate_action', label: 'Immediate action taken', type: 'textarea' },
        { name: 'root_cause', label: 'Why it happened', type: 'textarea' },
        { name: 'corrective_action', label: 'What we changed so it does not repeat', type: 'textarea' },
        { name: 'days_lost', label: 'Days lost', type: 'number' },
        { name: 'reported_to_authority', label: 'Reported to the authority', type: 'checkbox' },
        { name: 'reported_on', label: 'Reported on', type: 'date' },
        { name: 'closed', label: 'Closed (actions complete)', type: 'checkbox' },
      ]}
      columns={[
        { label: 'When', render: (r) => fmtDateTime(r.occurred_at) },
        { label: 'Type', render: (r) => <Badge tone={['serious', 'fatal'].includes(r.severity) ? 'red' : r.severity === 'minor' ? 'amber' : 'blue'}>{incLabel[r.kind]}</Badge> },
        { label: 'What', render: (r) => r.description },
        { label: 'Days lost', render: (r) => fmtNum(r.days_lost) },
        { label: 'Reported', render: (r) => (r.reported_to_authority ? `Yes ${fmtDate(r.reported_on)}` : ['serious', 'fatal'].includes(r.severity) ? <span className="flag">NO</span> : '-') },
        { label: 'Status', render: (r) => <Badge tone={r.closed ? 'green' : 'amber'}>{r.closed ? 'closed' : 'open'}</Badge> },
      ]}
    />
  )
}
