// PDF reports (A4). jsPDF is loaded on demand so it does not slow down the first page load.
// report = { title, subtitle?, summary?: [[label, value]], sections: [{ heading?, columns:[{header, align?}], rows:[[...]], foot?:[...] }] }

export async function exportReport(report, { user = '', company = 'Nova Geo Resources', filename } = {}) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])

  const widest = Math.max(0, ...report.sections.map((s) => s.columns.length))
  const doc = new jsPDF({ orientation: widest > 7 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const M = 36
  const INK = [23, 32, 36]
  const MUTED = [86, 100, 105]
  const ACCENT = [140, 196, 26]

  // letterhead
  doc.setFont('helvetica', 'bold').setFontSize(17).setTextColor(...INK).text(company, M, 44)
  doc.setFillColor(...ACCENT).rect(M, 52, 46, 3, 'F')
  doc.setFont('helvetica', 'bold').setFontSize(13).text(report.title, M, 76)
  let y = 76
  if (report.subtitle) {
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...MUTED).text(report.subtitle, M, (y += 15))
  }
  y += 14

  // headline numbers
  if (report.summary?.length) {
    autoTable(doc, {
      startY: y,
      body: report.summary.map(([k, v]) => [k, String(v)]),
      theme: 'plain',
      margin: { left: M, right: M },
      styles: { fontSize: 10, cellPadding: { top: 2, bottom: 2, left: 0, right: 8 }, textColor: INK },
      columnStyles: { 0: { textColor: MUTED, cellWidth: 170 }, 1: { fontStyle: 'bold' } },
    })
    y = doc.lastAutoTable.finalY + 14
  }

  for (const s of report.sections) {
    if (s.heading) {
      if (y > doc.internal.pageSize.getHeight() - 110) {
        doc.addPage()
        y = 50
      }
      doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...INK).text(s.heading, M, y + 4)
      y += 10
    }
    if (!s.rows.length) {
      doc.setFont('helvetica', 'italic').setFontSize(9.5).setTextColor(...MUTED).text('No records for this period.', M, y + 12)
      y += 30
      continue
    }
    const columnStyles = {}
    s.columns.forEach((c, i) => {
      if (c.align === 'right') columnStyles[i] = { halign: 'right' }
    })
    autoTable(doc, {
      startY: y,
      head: [s.columns.map((c) => c.header)],
      body: s.rows,
      foot: s.foot ? [s.foot] : undefined,
      margin: { left: M, right: M, top: 40, bottom: 40 },
      styles: { fontSize: 8.5, cellPadding: 4, textColor: INK, lineColor: [203, 211, 212], lineWidth: 0.4 },
      headStyles: { fillColor: [15, 15, 15], textColor: [197, 242, 77], fontStyle: 'bold' },
      footStyles: { fillColor: [230, 233, 233], textColor: INK, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [247, 248, 248] },
      columnStyles,
      didParseCell: (d) => {
        const al = s.columns[d.column.index]?.align
        if (al === 'right') d.cell.styles.halign = 'right'
      },
    })
    y = doc.lastAutoTable.finalY + 22
  }

  // footer on every page
  const pages = doc.getNumberOfPages()
  const H = doc.internal.pageSize.getHeight()
  const stamp = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED)
    doc.text(`${company} | generated ${stamp}${user ? ' by ' + user : ''}`, M, H - 20)
    doc.text(`Page ${i} of ${pages}`, W - M, H - 20, { align: 'right' })
  }

  const safe = (filename || report.title).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
  doc.save(`${safe}-${new Date().toISOString().slice(0, 10)}.pdf`)
}
