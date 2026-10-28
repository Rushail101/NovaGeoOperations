import { useEffect, useState } from 'react'
import { Mountain, FileDown } from 'lucide-react'
import { supabase } from '../supabase.js'
import { fmtDate, gradeLabel } from '../fmt.js'
import { coaRows, coaVerdict, buildCoa } from '../coa.js'

// Opened by scanning the QR on a bag: no sign-in, shows the quality of that bag's batch only.
export default function PublicCertificate({ bagNo, token }) {
  const [state, setState] = useState({ loading: true })
  useEffect(() => {
    let live = true
    supabase.rpc('public_bag_certificate', { p_bag_no: bagNo, p_token: token }).then(({ data, error }) => {
      if (!live) return
      setState(error ? { error: 'Could not load the certificate. Check your internet connection and scan again.' } : { data })
    })
    return () => { live = false }
  }, [bagNo, token])

  const c = state.data
  const report = c && !c.held ? { ...c, ...(c.report || {}), sio2_pct: c.sio2_pct, fe2o3_pct: c.fe2o3_pct, moisture_pct: c.moisture_pct, whiteness_pct: c.whiteness_pct, tested_on: c.report?.tested_on || c.tested_on } : null
  const res = report ? coaRows(report, c.limits) : null

  async function download() {
    const { exportReport } = await import('../pdf.js')
    await exportReport(
      buildCoa({ report, batch: { batch_no: c.batch_no, produced_on: c.produced_on }, bag: { bag_no: c.bag_no }, grade: { name: c.grade }, mesh: c.mesh ? { mesh: c.mesh } : null, limits: c.limits }),
      { user: 'Nova Geo Resources', filename: `certificate-${c.batch_no}-${c.bag_no}` }
    )
  }

  return (
    <div className="pubcert">
      <div className="pubhead"><span className="brand-mark"><Mountain size={18} /></span><span>Nova Geo Resources</span></div>
      {state.loading && <p className="muted">Loading...</p>}
      {state.error && <div className="card error">{state.error}</div>}
      {!state.loading && !state.error && !c && <div className="card"><h3>Certificate not found</h3><p className="muted">This code is not valid. Please check the bag or contact Nova Geo Resources.</p></div>}
      {c?.held && <div className="card"><h3>Batch under review</h3><p className="muted">Bag {c.bag_no} belongs to a batch that is being re-checked. Please contact Nova Geo Resources before using it.</p></div>}
      {report && (
        <>
          <div className="card">
            <div className="tag">Quality certificate</div>
            <h1 style={{ margin: '6px 0 4px' }}>{gradeLabel({ name: c.grade }, c.mesh ? { mesh: c.mesh } : null)}</h1>
            <div className="muted">Bag {c.bag_no} | {c.bag_type === 'jumbo' ? 'jumbo bag' : 'bag'}, {Number(c.weight_kg)} kg</div>
            <div className="muted">Batch {c.batch_no} | produced {c.produced_on ? fmtDate(c.produced_on) : '-'}</div>
            {c.report?.for_this_bag && <div className="muted">Tested on this bag</div>}
            {c.report && <div className="muted">Lab report {c.report.report_no} | {c.report.lab_name} | tested {fmtDate(c.report.tested_on)}</div>}
            <p style={{ margin: '12px 0 0' }}><span className={'badge ' + (res.judged === 0 ? '' : res.fails ? 'red' : 'green')}>{coaVerdict(res)}</span></p>
          </div>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Parameter</th><th>Result</th><th>Limit</th><th>Status</th></tr></thead>
              <tbody>{res.rows.map((r) => <tr key={r[0]}>{r.map((x, i) => <td key={i}>{x}</td>)}</tr>)}</tbody>
            </table>
          </div>
          {res.rows.length === 0 && <p className="muted">No test results have been recorded for this batch yet.</p>}
          <div style={{ marginTop: 14 }}><button className="btn" onClick={download}><FileDown size={17} /> Download PDF</button></div>
        </>
      )}
    </div>
  )
}
