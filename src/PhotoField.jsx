import { useEffect, useState } from 'react'
import { Camera, X, Image as ImageIcon } from 'lucide-react'
import { supabase } from './supabase.js'
import { uuid, isNetworkError, useOnline } from './offline.js'

const signed = new Map() // path -> { url, at }
async function signUrls(paths) {
  const need = paths.filter((p) => !signed.has(p) || Date.now() - signed.get(p).at > 50 * 60 * 1000)
  if (need.length) {
    const { data } = await supabase.storage.from('photos').createSignedUrls(need, 3600)
    ;(data || []).forEach((d) => d.signedUrl && signed.set(d.path, { url: d.signedUrl, at: Date.now() }))
  }
  return Object.fromEntries(paths.map((p) => [p, signed.get(p)?.url]))
}
function useSigned(paths) {
  const [urls, setUrls] = useState({})
  const key = (paths || []).join('|')
  useEffect(() => {
    let live = true
    if (paths?.length) signUrls(paths).then((u) => live && setUrls(u)).catch(() => {})
    return () => { live = false }
  }, [key])
  return urls
}

// Phone photos are 4-8 MB; shrink to ~1600px JPEG (a few hundred KB) before uploading.
async function shrink(file) {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * k)
  c.height = Math.round(bmp.height * k)
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
  return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8))
}

export default function PhotoField({ value = [], onChange, folder }) {
  const online = useOnline()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const urls = useSigned(value)

  async function add(files) {
    setBusy(true)
    setErr(null)
    try {
      const added = []
      for (const f of files) {
        const path = `${folder}/${uuid()}.jpg`
        const { error } = await supabase.storage.from('photos').upload(path, await shrink(f), { contentType: 'image/jpeg' })
        if (error) throw error
        added.push(path)
      }
      onChange([...(value || []), ...added])
    } catch (e) {
      setErr(isNetworkError(e) ? 'No connection. Photos can only be added while online.' : e.message)
    }
    setBusy(false)
  }

  return (
    <div className="photos">
      {value.map((p) => (
        <div className="thumb" key={p}>
          {urls[p] ? <img src={urls[p]} alt="" /> : <ImageIcon size={20} />}
          <button type="button" aria-label="Remove photo" onClick={() => onChange(value.filter((x) => x !== p))}><X size={14} /></button>
        </div>
      ))}
      <label className={'btn' + (!online || busy ? ' disabled' : '')}>
        <Camera size={17} /> {busy ? 'Uploading...' : 'Add photo'}
        <input type="file" accept="image/*" capture="environment" multiple hidden disabled={!online || busy}
          onChange={(e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) add(f) }} />
      </label>
      {!online && <span className="muted">Photos need a connection.</span>}
      {err && <div className="error">{err}</div>}
    </div>
  )
}

// "3 photos" link that opens a gallery
export function PhotoLink({ paths }) {
  const [open, setOpen] = useState(false)
  const urls = useSigned(open ? paths : [])
  if (!paths?.length) return '-'
  return (
    <>
      <button className="link" onClick={() => setOpen(true)}>{paths.length} photo{paths.length > 1 ? 's' : ''}</button>
      {open && (
        <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="modal" style={{ width: 'min(900px, 100%)' }}>
            <div className="modal-head"><h3>Photos</h3><button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close"><X size={20} /></button></div>
            <div className="modal-body gallery">
              {paths.map((p) => (urls[p] ? <a key={p} href={urls[p]} target="_blank" rel="noreferrer"><img src={urls[p]} alt="" /></a> : <div key={p} className="muted">Loading...</div>))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
