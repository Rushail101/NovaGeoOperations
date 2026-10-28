export const fmtKg = (n) => (n == null ? '-' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }) + ' kg')
export const fmtNum = (n, d = 2) => (n == null || n === '' ? '-' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: d }))
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN') : '-')
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '-')
export const toLocalInput = (d = new Date()) => {
  const x = new Date(d)
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset())
  return x.toISOString().slice(0, 16)
}
export const gradeLabel = (g, m) => (g ? `${g.name}${m?.mesh ? ` - ${m.mesh} mesh` : ''}` : '-')
// The QR on a bag opens the batch certificate: /#/c/<bag no>/<batch token>. Scanning inside the app still finds the bag number.
export const certUrl = (bagNo, token) => (token ? `${location.origin}/#/c/${bagNo}/${token}` : bagNo)
export const bagNoFromScan = (text) => {
  const m = String(text || '').toUpperCase().match(/NG-\d{6}-\d{4,}/)
  return m ? m[0] : String(text || '').trim().toUpperCase()
}
export const todayIso = () => new Date().toLocaleDateString('en-CA')
