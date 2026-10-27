import { useEffect, useState } from 'react'
import { Camera, X, Image as ImageIcon, FileText, Paperclip } from 'lucide-react'
import { supabase } from './supabase.js'
import { uuid, isNetworkError, useOnline } from './offline.js'

const MAX_PDF = 8 * 1024 * 1024
export const isPdf = (p) => /\.pdf$/i.test(p || '')
const niceName = (p) => (p || '').split('/').pop().replace(/^[0-9a-f]{8}-/, '')

const signed = new Map() // path -> { url, at }
async function signUrls(paths) {
  const need = paths.filter((p) => !signed.has(p) || Date.now() - signed.get(p).at > 50 * 60 * 1000)
  if (need.length) {
    const { data } = await supabase.storage.from('photos').createSignedUrls(need, 3600)
    ;(data || []).forEach((d) => d.signedUrl && signed.set(d.path, { url: d.signedUrl, at: Date.now() }))
  }
  return Object.fromEntries(paths.map((p) => [p, signed.get(p)?.url]))
}
export function useSigned(paths) {
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

// Upload files and return their storage paths. Used by the form field and by "attach later" dialogs.
export async function uploadFiles(files, folder) {
  const added = []
  for (const f of files) {
    if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
      if (f.size > MAX_PDF) throw new Error(`${f.name} is larger than 8 MB`)
      const safe = f.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-60)
      const path = `${folder}/${uuid().slice(0, 8)}-${safe}`
      const { error } = await supabase.storage.from('photos').upload(path, f, { contentType: 'application/pdf' })
      if (error) throw error
      added.push(path)
    } else {
      const path = `${folder}/${uuid()}.jpg`
      const { error } = await supabase.storage.from('photos').upload(path, await shrink(f), { contentType: 'image/jpeg' })
      if (error) throw error
      added.push(path)
    }
  }
  return added
}

export default function PhotoField({ value = [], onChange, folder, docs = false }) {
  const online = useOnline()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const urls = useSigned(value)

  async function add(files) {
    setBusy(true)
    setErr(null)
    try {
      const added = await uploadFiles(files, folder)
      onChange([...(value || []), ...added])
    } catch (e) {
      setErr(isNetworkError(e) ? 'No connection. Files can only be added while online.' : e.message)
    }
    setBusy(false)
  }

  return (
    <div className="photos">
      {value.map((p) => (
        <div className={'thumb' + (isPdf(p) ? ' pdf' : '')} key={p} title={niceName(p)}>
          {isPdf(p) ? (
            <a href={urls[p]} target="_blank" rel="noreferrer"><FileText size={22} /><span>{niceName(p)}</span></a>
          ) : urls[p] ? <img src={urls[p]} alt="" /> : <ImageIcon size={20} />}
          <button type="button" aria-label="Remove file" onClick={() => onChange(value.filter((x) => x !== p))}><X size={14} /></button>
        </div>
      ))}
      <label className={'btn' + (!online || busy ? ' disabled' : '')}>
        {docs ? <Paperclip size={17} /> : <Camera size={17} />} {busy ? 'Uploading...' : docs ? 'Add PDF or photo' : 'Add photo'}
        <input type="file" accept={docs ? 'image/*,application/pdf' : 'image/*'} capture={docs ? undefined : 'environment'} multiple hidden disabled={!online || busy}
          onChange={(e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) add(f) }} />
      </label>
      {!online && <span className="muted">Uploads need a connection.</span>}
      {err && <div className="error">{err}</div>}
    </div>
  )
}

// "3 files" link that opens a gallery
export function PhotoLink({ paths, label }) {
  const [open, setOpen] = useState(false)
  const urls = useSigned(open ? paths : [])
  if (!paths?.length) return '-'
  const anyPdf = paths.some(isPdf)
  const noun = label || (anyPdf ? 'file' : 'photo')
  return (
    <>
      <button className="link" onClick={() => setOpen(true)}>{paths.length} {noun}{paths.length > 1 ? 's' : ''}</button>
      {open && (
        <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="modal" style={{ width: 'min(900px, 100%)' }}>
            <div className="modal-head"><h3>Files</h3><button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close"><X size={20} /></button></div>
            <div className="modal-body gallery">
              {paths.map((p) =>
                !urls[p] ? <div key={p} className="muted">Loading...</div>
                : isPdf(p) ? <a key={p} className="filecard" href={urls[p]} target="_blank" rel="noreferrer"><FileText size={28} /><span>{niceName(p)}</span></a>
                : <a key={p} href={urls[p]} target="_blank" rel="noreferrer"><img src={urls[p]} alt="" /></a>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
