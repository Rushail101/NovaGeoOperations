// Certificate of Analysis: builds the document for exportReport() from a lab report.
import { gradeLabel, fmtDate } from './fmt.js'

// spec = key in the limits object (see spec.js effectiveSpec); min_* means "at least", max_* "at most"
const PARAMS = [
  { k: 'sio2_pct', label: 'SiO2', unit: '%', spec: 'min_sio2' },
  { k: 'fe2o3_pct', label: 'Fe2O3', unit: '%', spec: 'max_fe2o3' },
  { k: 'al2o3_pct', label: 'Al2O3', unit: '%' },
  { k: 'tio2_pct', label: 'TiO2', unit: '%' },
  { k: 'cao_pct', label: 'CaO', unit: '%' },
  { k: 'loi_pct', label: 'Loss on ignition', unit: '%' },
  { k: 'moisture_pct', label: 'Moisture', unit: '%', spec: 'max_moisture' },
  { k: 'whiteness_pct', label: 'Whiteness / brightness', unit: '%', spec: 'min_whiteness' },
  { k: 'd50_um', label: 'Particle size D50', unit: 'micron' },
  { k: 'd97_um', label: 'Particle size D97', unit: 'micron' },
  { k: 'residue_pct', label: 'Residue on sieve', unit: '%' },
  { k: 'bulk_density', label: 'Bulk density', unit: 'g/cc' },
]
const has = (v) => v !== null && v !== undefined && v !== ''

export function coaRows(report, limits = {}) {
  let fails = 0
  let judged = 0
  const rows = []
  for (const p of PARAMS) {
    const v = report[p.k]
    if (!has(v)) continue
    const lim = p.spec ? limits[p.spec] : null
    let limit = '-'
    let status = '-'
    if (has(lim)) {
      const min = p.spec.startsWith('min_')
      limit = `${min ? '>=' : '<='} ${lim} ${p.unit}`
      const ok = min ? Number(v) >= Number(lim) : Number(v) <= Number(lim)
      status = ok ? 'Pass' : 'FAIL'
      judged++
      if (!ok) fails++
    }
    rows.push([p.label, `${Number(v)} ${p.unit}`, limit, status])
  }
  return { rows, fails, judged }
}

export function coaVerdict({ fails, judged }) {
  return judged === 0 ? 'No limits set' : fails ? 'OUTSIDE LIMITS' : 'Within limits'
}

// report: lab report fields; batch: { batch_no, produced_on }; grade/mesh for the product name; limits from effectiveSpec
export function buildCoa({ report, batch, bag, grade, mesh, limits, approved = true }) {
  const res = coaRows(report, limits)
  return {
    title: 'Certificate of Analysis',
    subtitle: `${report.report_no ? `Report ${report.report_no}  |  ` : ''}Lot ${batch?.batch_no ?? '-'}${bag?.bag_no ? `  |  Bag ${bag.bag_no}` : ''}`,
    summary: [
      ['Product', gradeLabel(grade, mesh)],
      ['Lot / batch', batch?.batch_no ?? '-'],
      ['Bag serial no.', bag?.bag_no ?? 'whole lot'],
      ['Production date', batch?.produced_on ? fmtDate(batch.produced_on) : '-'],
      ...(report.sample_ref ? [['Sample', report.sample_ref]] : []),
      ['Tested on', report.tested_on ? fmtDate(report.tested_on) : '-'],
      ['Laboratory', report.lab_name || '-'],
      ...(report.tested_by ? [['Tested by', report.tested_by]] : []),
      ['Result against limits', coaVerdict(res)],
      ['Report status', approved ? 'Approved' : 'DRAFT - not approved, do not issue'],
    ],
    sections: [
      { heading: 'Test results', columns: [{ header: 'Parameter' }, { header: 'Result', align: 'right' }, { header: 'Limit', align: 'right' }, { header: 'Status' }], rows: res.rows },
      ...(report.remarks ? [{ heading: 'Remarks', columns: [{ header: 'Note' }], rows: [[report.remarks]] }] : []),
    ],
  }
}
