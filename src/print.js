import QRCode from 'qrcode'

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const kg = (n) => Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })

const BASE_CSS = `
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;margin:0;color:#000}
  @media screen{body{padding:12px;background:#eee}}
`

function open(title) {
  // Open synchronously from the click handler so popup blockers allow it.
  const w = window.open('', '_blank')
  if (!w) {
    alert('Please allow pop-ups for this site to print.')
    return null
  }
  w.document.write(`<!doctype html><title>${esc(title)}</title><p style="font-family:Arial">Preparing...</p>`)
  return w
}

function finish(w, html) {
  w.document.open()
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 400)
}

export function openPrintWindow(title) {
  return open(title)
}

// bags: [{bag_no, bag_type, weight_kg, packed_at}], ctx: {batch_no, grade, mill, company}
// layout: 'label' (one 70x50mm label per page, for thermal printers) or 'sheet' (A4, 3 columns)
export async function printLabels(w, bags, { layout = 'sheet', company = 'Nova Geo Resources' } = {}) {
  w = w || open('Bag labels')
  if (!w) return
  const items = await Promise.all(
    bags.map(async (b) => ({ ...b, qr: await QRCode.toDataURL(b.cert_url || b.bag_no, { margin: 0, width: 220, errorCorrectionLevel: 'M' }) }))
  )
  const label = (b) => `
    <div class="label">
      <img src="${b.qr}" />
      <div class="t">
        <div class="co">${esc(company)}</div>
        <div class="no">${esc(b.bag_no)}</div>
        <div>${esc(b.grade || '')}</div>
        ${b.kind === 'pouch' ? '<div><b>QC SAMPLE 1 kg</b></div>' : `<div><b>${kg(b.weight_kg)} kg</b> ${b.bag_type === 'jumbo' ? '(jumbo)' : ''}</div>`}
        <div class="s">Batch ${esc(b.batch_no || '')}</div>
        <div class="s">${esc(b.packed_on || '')}</div>
        ${b.cert_url && b.cert_url !== b.bag_no ? '<div class="s">Scan for lab report</div>' : ''}
      </div>
    </div>`
  const css =
    layout === 'label'
      ? `@page{size:70mm 50mm;margin:0} .label{width:70mm;height:50mm;page-break-after:always;display:flex;gap:2mm;align-items:center;padding:3mm} .label img{width:30mm;height:30mm}`
      : `@page{size:A4;margin:8mm} .sheet{display:grid;grid-template-columns:repeat(3,1fr);gap:3mm} .label{border:1px dashed #999;height:42mm;display:flex;gap:2mm;align-items:center;padding:3mm;break-inside:avoid} .label img{width:28mm;height:28mm}`
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Bag labels</title><style>${BASE_CSS}
    ${css} .t{font-size:9pt;line-height:1.25} .co{font-size:8pt;color:#444} .no{font-weight:bold;font-size:10.5pt;margin:1mm 0} .s{font-size:8pt;color:#333}
  </style></head><body><div class="sheet">${items.map(label).join('')}</div></body></html>`
  finish(w, html)
}

// slip: {no, date, company, customer, order_no, grade, vehicle, gross, tare, net, bags:[{bag_no, batch_no, weight_kg}], bag_total, notes}
export function printDispatchSlip(w, slip) {
  w = w || open('Dispatch slip')
  if (!w) return
  const diff = slip.net - slip.bag_total
  const rows = slip.bags
    .map((b, i) => `<tr><td>${i + 1}</td><td>${esc(b.bag_no)}</td><td>${esc(b.batch_no)}</td><td class="r">${kg(b.weight_kg)}</td></tr>`)
    .join('')
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Dispatch slip ${esc(slip.no)}</title><style>${BASE_CSS}
    @page{size:A4;margin:12mm} body{font-size:11pt} h1{margin:0 0 2px;font-size:18pt} .sub{color:#444;margin-bottom:12px}
    table{border-collapse:collapse;width:100%;margin:10px 0} th,td{border:1px solid #888;padding:4px 8px;text-align:left} .r{text-align:right}
    .meta td{border:0;padding:2px 8px 2px 0} .sig{display:flex;justify-content:space-between;margin-top:50px} .sig div{border-top:1px solid #000;width:30%;text-align:center;padding-top:4px}
  </style></head><body>
    <h1>${esc(slip.company)}</h1><div class="sub">Dispatch slip &nbsp;|&nbsp; ${esc(slip.no)} &nbsp;|&nbsp; ${esc(slip.date)}</div>
    <table class="meta"><tr><td><b>Customer</b></td><td>${esc(slip.customer)}</td><td><b>Order</b></td><td>${esc(slip.order_no)}</td></tr>
    <tr><td><b>Vehicle</b></td><td>${esc(slip.vehicle)}</td><td><b>Grade</b></td><td>${esc(slip.grade)}</td></tr>
    <tr><td><b>Invoice no.</b></td><td>${esc(slip.invoice_no || '')}</td><td><b>E-way bill no.</b></td><td>${esc(slip.eway_bill_no || '')}</td></tr>
    <tr><td><b>Transporter</b></td><td>${esc(slip.transporter || '')}</td><td><b>LR no.</b></td><td>${esc(slip.lr_no || '')}</td></tr></table>
    <table><tr><th>Gross (kg)</th><th>Tare (kg)</th><th>Net weighed (kg)</th><th>Bags</th><th>Bag total (kg)</th></tr>
    <tr><td>${kg(slip.gross)}</td><td>${kg(slip.tare)}</td><td><b>${kg(slip.net)}</b></td><td>${slip.bags.length}</td><td>${kg(slip.bag_total)}</td></tr></table>
    ${slip.bags.length ? `<table><tr><th>#</th><th>Bag no.</th><th>Batch</th><th class="r">Weight (kg)</th></tr>${rows}</table>
    <div>Difference (net weighed minus bag total): <b>${kg(diff)} kg</b></div>` : ''}
    ${slip.notes ? `<p>Notes: ${esc(slip.notes)}</p>` : ''}
    <div class="sig"><div>Prepared by</div><div>Driver</div><div>Received by</div></div>
  </body></html>`
  finish(w, html)
}
