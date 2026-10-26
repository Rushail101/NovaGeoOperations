import { useState } from 'react'
import { FileDown, Eye } from 'lucide-react'
import { supabase } from '../supabase.js'
import { useAuth } from '../auth.jsx'
import { fmtDate, fmtDateTime } from '../lib.jsx'
import { computeDue } from './Maintenance.jsx'
import { liningProjection } from './Lining.jsx'

const n = (x, d = 2) => (x == null || x === '' ? '-' : Number(x).toLocaleString('en-IN', { maximumFractionDigits: d }))
const R = (header) => ({ header, align: 'right' })
const C = (header) => ({ header })
const sum = (rows, f) => rows.reduce((a, r) => a + Number(f(r) || 0), 0)
const group = (rows, key) => {
  const m = new Map()
  for (const r of rows) {
    const k = key(r) ?? '-'
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(r)
  }
  return [...m.entries()]
}
const must = ({ data, error }) => {
  if (error) throw new Error(error.message)
  return data || []
}
const period = (p) => `Period: ${fmtDate(p.from)} to ${fmtDate(p.to)}`
const yesNo = (b) => (b ? 'Yes' : 'No')

export const REPORTS = [
  {
    id: 'production',
    title: 'Production summary',
    desc: 'Mill run-hours, feed, output, yield and power per mill.',
    ranged: true,
    async build(p) {
      const runs = must(await supabase.from('mill_runs').select('*, mills(name), grades(name), orders(order_no)').gte('started_at', p.fromIso).lte('started_at', p.toIso).order('started_at'))
      const feed = sum(runs, (r) => r.feed_kg), out = sum(runs, (r) => r.output_kg)
      const kRuns = runs.filter((r) => r.kwh_used != null && r.output_kg > 0)
      const kwhT = kRuns.length ? sum(kRuns, (r) => r.kwh_used) / (sum(kRuns, (r) => r.output_kg) / 1000) : null
      return {
        title: 'Production summary',
        subtitle: period(p),
        summary: [
          ['Mill runs', runs.length], ['Run-hours', n(sum(runs, (r) => r.hours))], ['Feed', `${n(feed)} kg`],
          ['Powder produced', `${n(out)} kg`], ['Yield', feed > 0 ? `${n((out / feed) * 100, 1)} %` : '-'], ['Power per tonne', kwhT != null ? `${n(kwhT, 0)} kWh/t` : '-'],
        ],
        sections: [
          {
            heading: 'By mill',
            columns: [C('Mill'), R('Runs'), R('Run-hours'), R('Feed (kg)'), R('Output (kg)'), R('Yield %'), R('kWh/t')],
            rows: group(runs, (r) => r.mills?.name).map(([m, rs]) => {
              const f = sum(rs, (r) => r.feed_kg), o = sum(rs, (r) => r.output_kg)
              const kr = rs.filter((r) => r.kwh_used != null && r.output_kg > 0)
              return [m, rs.length, n(sum(rs, (r) => r.hours)), n(f), n(o), f > 0 ? n((o / f) * 100, 1) : '-', kr.length ? n(sum(kr, (r) => r.kwh_used) / (sum(kr, (r) => r.output_kg) / 1000), 0) : '-']
            }),
          },
          {
            heading: 'Run details',
            columns: [C('Started'), C('Mill'), R('Hours'), C('Grade'), R('Feed (kg)'), R('Output (kg)'), R('Yield %'), R('kWh/t'), C('Order'), C('Operator')],
            rows: runs.map((r) => [fmtDateTime(r.started_at), r.mills?.name || '-', r.hours ?? 'running', r.grades?.name || '-', n(r.feed_kg), n(r.output_kg),
              r.feed_kg > 0 && r.output_kg != null ? n((r.output_kg / r.feed_kg) * 100, 1) : '-', r.kwh_used != null && r.output_kg > 0 ? n(r.kwh_used / (r.output_kg / 1000), 0) : '-', r.orders?.order_no || '-', r.operator || '-']),
          },
        ],
      }
    },
  },
  {
    id: 'weighments',
    title: 'Weighment register',
    desc: 'Every inbound, mill feed and dispatch weighment with totals.',
    ranged: true,
    async build(p) {
      const w = must(await supabase.from('weighments').select('*, suppliers(name), mills(name), orders(order_no), creator:profiles!created_by(full_name, username)').gte('weighed_at', p.fromIso).lte('weighed_at', p.toIso).order('weighed_at'))
      const label = { inbound: 'Inbound quartz', mill_feed: 'Mill feed', dispatch: 'Dispatch' }
      return {
        title: 'Weighment register',
        subtitle: period(p),
        summary: ['inbound', 'mill_feed', 'dispatch'].map((t) => {
          const rs = w.filter((x) => x.type === t)
          return [label[t], `${n(sum(rs, (r) => r.net_kg))} kg in ${rs.length} weighments`]
        }),
        sections: [{
          columns: [C('When'), C('Type'), C('Vehicle'), R('Gross (kg)'), R('Tare (kg)'), R('Net (kg)'), C('Reference'), C('By')],
          rows: w.map((r) => [fmtDateTime(r.weighed_at), label[r.type], r.vehicle_no || '-', n(r.gross_kg), n(r.tare_kg), n(r.net_kg), r.orders?.order_no || r.mills?.name || r.suppliers?.name || r.lot_no || '-', r.creator?.full_name || r.creator?.username || '-']),
          foot: ['Total', '', '', n(sum(w, (r) => r.gross_kg)), n(sum(w, (r) => r.tare_kg)), n(sum(w, (r) => r.net_kg)), '', ''],
        }],
      }
    },
  },
  {
    id: 'dispatch',
    title: 'Dispatch report',
    desc: 'Trucks sent out, by customer and by load.',
    ranged: true,
    async build(p) {
      const w = must(await supabase.from('weighments').select('*, orders(order_no, customers(name))').eq('type', 'dispatch').gte('weighed_at', p.fromIso).lte('weighed_at', p.toIso).order('weighed_at'))
      const bags = must(await supabase.from('bags').select('dispatch_weighment_id').not('dispatch_weighment_id', 'is', null).gte('dispatched_at', p.fromIso).lte('dispatched_at', p.toIso).limit(5000))
      const cnt = {}
      bags.forEach((b) => (cnt[b.dispatch_weighment_id] = (cnt[b.dispatch_weighment_id] || 0) + 1))
      return {
        title: 'Dispatch report',
        subtitle: period(p),
        summary: [['Trucks', w.length], ['Bags dispatched', sum(w, (r) => cnt[r.id])], ['Net dispatched', `${n(sum(w, (r) => r.net_kg))} kg`]],
        sections: [
          {
            heading: 'By customer',
            columns: [C('Customer'), R('Trucks'), R('Bags'), R('Net (kg)')],
            rows: group(w, (r) => r.orders?.customers?.name).map(([c, rs]) => [c, rs.length, sum(rs, (r) => cnt[r.id]), n(sum(rs, (r) => r.net_kg))]),
          },
          {
            heading: 'Loads',
            columns: [C('When'), C('Slip'), C('Customer'), C('Order'), C('Vehicle'), R('Bags'), R('Net (kg)')],
            rows: w.map((r) => [fmtDateTime(r.weighed_at), 'D-' + r.id.slice(0, 8).toUpperCase(), r.orders?.customers?.name || '-', r.orders?.order_no || '-', r.vehicle_no || '-', cnt[r.id] || 0, n(r.net_kg)]),
            foot: ['Total', '', '', '', '', sum(w, (r) => cnt[r.id]), n(sum(w, (r) => r.net_kg))],
          },
        ],
      }
    },
  },
  {
    id: 'stock',
    title: 'Stock position',
    desc: 'Raw quartz, unpacked powder and packed bags in stock right now.',
    ranged: false,
    async build() {
      const [st] = must(await supabase.from('stock_summary').select('*'))
      const bags = must(await supabase.from('bags').select('weight_kg, bag_type, batches(batch_no, sio2_pct, fe2o3_pct, grades(name))').eq('status', 'in_stock').limit(5000))
      const bulk = Number(st.dispatched_kg) - Number(st.dispatched_bags_kg)
      return {
        title: 'Stock position',
        subtitle: `As of ${new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`,
        summary: [
          ['Raw quartz in yard', `${n(Number(st.inbound_kg) - Number(st.fed_kg))} kg`],
          ['Powder not yet packed', `${n(Number(st.produced_kg) - Number(st.packed_kg) - bulk)} kg`],
          ['Packed, ready to dispatch', `${n(st.packed_in_stock_kg)} kg in ${st.bags_in_stock} bags`],
        ],
        sections: [{
          heading: 'Packed stock by batch',
          columns: [C('Batch'), C('Grade'), C('Type'), R('Bags'), R('Weight (kg)'), R('SiO2 %'), R('Fe2O3 %')],
          rows: group(bags, (b) => `${b.batches?.batch_no}|${b.bag_type}`).map(([k, rs]) => {
            const b = rs[0]
            return [b.batches?.batch_no, b.batches?.grades?.name || '-', b.bag_type, rs.length, n(sum(rs, (x) => x.weight_kg)), n(b.batches?.sio2_pct, 3), n(b.batches?.fe2o3_pct, 4)]
          }),
          foot: ['Total', '', '', bags.length, n(sum(bags, (x) => x.weight_kg)), '', ''],
        }],
      }
    },
  },
  {
    id: 'orders',
    title: 'Order status',
    desc: 'Orders placed in the period with dispatched and pending quantities.',
    ranged: true,
    async build(p) {
      const o = must(await supabase.from('orders').select('*, customers(name), grades(name)').gte('created_at', p.fromIso).lte('created_at', p.toIso).order('created_at'))
      const pr = Object.fromEntries(must(await supabase.from('order_progress').select('*')).map((x) => [x.id, x]))
      return {
        title: 'Order status',
        subtitle: period(p) + ' (orders created in this period)',
        summary: [['Orders', o.length], ['Ordered', `${n(sum(o, (r) => r.qty_kg))} kg`], ['Dispatched', `${n(sum(o, (r) => pr[r.id]?.dispatched_kg))} kg`], ['Still to dispatch', `${n(sum(o.filter((r) => !['cancelled', 'dispatched'].includes(r.status)), (r) => pr[r.id]?.pending_kg))} kg`]],
        sections: [{
          columns: [C('Order'), C('Date'), C('Customer'), C('Grade'), R('Ordered (kg)'), R('Dispatched (kg)'), R('Pending (kg)'), C('Due'), C('Status')],
          rows: o.map((r) => [r.order_no, fmtDate(r.created_at), r.customers?.name || '-', r.grades?.name || '-', n(r.qty_kg), n(pr[r.id]?.dispatched_kg ?? 0), n(pr[r.id]?.pending_kg ?? r.qty_kg), r.due_date ? fmtDate(r.due_date) : '-', r.status.replace('_', ' ')]),
        }],
      }
    },
  },
  {
    id: 'maintenance',
    title: 'Maintenance report',
    desc: 'Work done, breakdowns and downtime, plus what is due now.',
    ranged: true,
    async build(p) {
      const logs = must(await supabase.from('maintenance_logs').select('*, assets(name)').gte('done_at', p.fromIso).lte('done_at', p.toIso).order('done_at'))
      const [sch, ast, hrs] = await Promise.all([
        supabase.from('maintenance_schedules').select('*').then(must),
        supabase.from('assets').select('*').then(must),
        supabase.from('mill_total_hours').select('*').then(must),
      ])
      const due = computeDue(sch, ast, hrs).filter((d) => d.state !== 'ok')
      const bd = logs.filter((l) => l.type === 'breakdown')
      return {
        title: 'Maintenance report',
        subtitle: period(p),
        summary: [['Jobs logged', logs.length], ['Breakdowns', bd.length], ['Breakdown downtime', `${n(sum(bd, (l) => l.downtime_hours))} h`], ['Total downtime', `${n(sum(logs, (l) => l.downtime_hours))} h`], ['Tasks due or overdue now', due.length]],
        sections: [
          { heading: 'Due or overdue now', columns: [C('Asset'), C('Task'), C('Status'), C('Detail')], rows: due.map((d) => [d.asset?.name || '-', d.task, d.state === 'due' ? 'Overdue' : 'Due soon', d.detail]) },
          { heading: 'Work log', columns: [C('When'), C('Asset'), C('Type'), C('Details'), R('Downtime (h)'), C('By')], rows: logs.map((l) => [fmtDateTime(l.done_at), l.assets?.name || '-', l.type, l.description || '-', n(l.downtime_hours), l.done_by || '-']) },
        ],
      }
    },
  },
  {
    id: 'lining',
    title: 'Resin lining report',
    desc: 'Lining inspections and wear rate for each mill.',
    ranged: false,
    async build() {
      const [ins, mills, hrs] = await Promise.all([
        supabase.from('lining_inspections').select('*, mills(name)').order('inspected_at').then(must),
        supabase.from('mills').select('*').then(must),
        supabase.from('mill_total_hours').select('*').then(must),
      ])
      return {
        title: 'Resin lining report',
        subtitle: `All inspections, as of ${fmtDate(new Date())}`,
        summary: mills.map((m) => {
          const pr = liningProjection(m, ins, hrs.find((h) => h.mill_id === m.id)?.total_hours)
          return [m.name, pr.rate > 0 ? `wear ${n(pr.rate)} mm per 100 h${pr.hoursLeft != null ? `, about ${n(pr.hoursLeft, 0)} run-hours left` : ''}` : pr.note || '-']
        }),
        sections: [{
          columns: [C('Date'), C('Mill'), R('Run-hours'), R('Min (mm)'), R('Avg (mm)'), R('Lifted %'), C('Cracks'), C('Stone loss'), C('Iron seen'), C('Condition')],
          rows: ins.map((i) => [fmtDate(i.inspected_at), i.mills?.name || '-', n(i.mill_hours_at_inspection, 1), n(i.min_thickness_mm, 1), n(i.avg_thickness_mm, 1), n(i.debonded_area_pct, 1), yesNo(i.cracks), yesNo(i.stone_loss_noted), yesNo(i.iron_contamination_noted), i.condition.replace('_', ' ')]),
        }],
      }
    },
  },
]

const iso = (d) => d.toLocaleDateString('en-CA') // yyyy-mm-dd in local time
function presets() {
  const t = new Date()
  const first = new Date(t.getFullYear(), t.getMonth(), 1)
  const lastFrom = new Date(t.getFullYear(), t.getMonth() - 1, 1)
  const lastTo = new Date(t.getFullYear(), t.getMonth(), 0)
  const wk = new Date(Date.now() - 6 * 86400000)
  return [
    ['Today', iso(t), iso(t)],
    ['Last 7 days', iso(wk), iso(t)],
    ['This month', iso(first), iso(t)],
    ['Last month', iso(lastFrom), iso(lastTo)],
  ]
}

function Preview({ report }) {
  return (
    <div className="card">
      <h3>{report.title}</h3>
      <p className="muted">{report.subtitle}</p>
      {report.summary?.length > 0 && (
        <div className="stats" style={{ margin: '10px 0' }}>
          {report.summary.map(([k, v]) => (
            <div className="stat" key={k}><div className="label">{k}</div><div className="value" style={{ fontSize: 24 }}>{v}</div></div>
          ))}
        </div>
      )}
      {report.sections.map((s, i) => (
        <div key={i} style={{ marginTop: 14 }}>
          {s.heading && <h3 style={{ marginBottom: 6 }}>{s.heading}</h3>}
          {s.rows.length === 0 ? <p className="muted">No records for this period.</p> : (
            <div className="tablewrap">
              <table className="stack">
                <thead><tr>{s.columns.map((c) => <th key={c.header} style={c.align ? { textAlign: 'right' } : null}>{c.header}</th>)}</tr></thead>
                <tbody>
                  {s.rows.slice(0, 200).map((r, j) => (
                    <tr key={j}>{r.map((x, k) => <td key={k} data-label={s.columns[k].header} style={s.columns[k].align ? { textAlign: 'right' } : null}>{x}</td>)}</tr>
                  ))}
                </tbody>
                {s.foot && <tfoot><tr>{s.foot.map((x, k) => <td key={k} style={s.columns[k].align ? { textAlign: 'right' } : null}>{x}</td>)}</tr></tfoot>}
              </table>
            </div>
          )}
          {s.rows.length > 200 && <p className="muted">Preview shows the first 200 rows. The PDF has all {s.rows.length}.</p>}
        </div>
      ))}
    </div>
  )
}

export default function Reports() {
  const { name } = useAuth()
  const pre = presets()
  const [from, setFrom] = useState(pre[2][1])
  const [to, setTo] = useState(pre[2][2])
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const [preview, setPreview] = useState(null)

  async function run(rep, mode) {
    setErr(null)
    setBusy(rep.id + mode)
    try {
      const params = { from, to, fromIso: new Date(from + 'T00:00:00+05:30').toISOString(), toIso: new Date(to + 'T23:59:59.999+05:30').toISOString() }
      const data = await rep.build(params)
      if (mode === 'pdf') {
        const { exportReport } = await import('../pdf.js')
        await exportReport(data, { user: name })
      } else setPreview(data)
    } catch (e) {
      setErr(`Could not build "${rep.title}": ${e.message}`)
    }
    setBusy(null)
  }

  return (
    <section>
      <div className="head"><h2>Reports</h2></div>
      <div className="card">
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
          <label className="form" style={{ gap: 4 }}><span className="muted">From</span><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="form" style={{ gap: 4 }}><span className="muted">To</span><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <div className="tabs" style={{ paddingTop: 10, paddingBottom: 0 }}>
          {pre.map(([l, f, t]) => (
            <button key={l} className={from === f && to === t ? 'on' : ''} onClick={() => { setFrom(f); setTo(t) }}>{l}</button>
          ))}
        </div>
      </div>
      {err && <div className="error">{err}</div>}
      <div className="stats" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {REPORTS.map((r) => (
          <div className="stat" key={r.id} style={{ display: 'grid', gap: 8, alignContent: 'space-between' }}>
            <div>
              <h3>{r.title}</h3>
              <div className="muted" style={{ marginTop: 4 }}>{r.desc}{!r.ranged && ' Not affected by the dates.'}</div>
            </div>
            <div className="row">
              <button className="btn" disabled={!!busy} onClick={() => run(r, 'view')}><Eye size={16} /> {busy === r.id + 'view' ? 'Loading...' : 'View'}</button>
              <button className="btn primary" disabled={!!busy} onClick={() => run(r, 'pdf')}><FileDown size={16} /> {busy === r.id + 'pdf' ? 'Building...' : 'PDF'}</button>
            </div>
          </div>
        ))}
      </div>
      {preview && <Preview report={preview} />}
    </section>
  )
}
