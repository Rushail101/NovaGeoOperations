import { useState } from 'react'
import { CloudOff, RefreshCw, Cloud } from 'lucide-react'
import { useSync, discard, retryItem, flush } from './offline.js'
import Modal from './Modal.jsx'
import { fmtDateTime } from './fmt.js'

export function OutboxList({ filter, title = 'Saved on this device, waiting to send' }) {
  const { items } = useSync()
  const mine = items.filter(filter || (() => true))
  if (!mine.length) return null
  return (
    <div className="card pending">
      <strong>{title} ({mine.length})</strong>
      {mine.map((it) => (
        <div className="pend" key={it.qid}>
          <div>
            <div>{it.label || it.table || it.fn}</div>
            <div className="muted">{fmtDateTime(it.createdAt)}{it.failed ? '' : ' - will send when online'}</div>
            {it.failed && <div className="error">Could not save: {it.error}</div>}
          </div>
          <div className="row">
            {it.failed && <button className="link" onClick={() => retryItem(it.qid)}>Try again</button>}
            <button className="link danger" onClick={() => confirm('Throw away this entry? It has not been saved to the server.') && discard(it.qid)}>Discard</button>
          </div>
        </div>
      ))}
    </div>
  )
}

export function SyncStatus() {
  const s = useSync()
  const [open, setOpen] = useState(false)
  const online = s.onLine && !s.netDown
  const waiting = s.items.filter((i) => !i.failed).length
  const failed = s.items.filter((i) => i.failed).length
  return (
    <>
      <button className={'syncpill' + (online ? '' : ' off')} onClick={() => setOpen(true)}>
        {online ? <Cloud size={15} /> : <CloudOff size={15} />}
        {online ? (waiting || failed ? `${waiting + failed} to send` : 'Online') : `Offline${waiting ? `, ${waiting} saved` : ''}`}
        {failed > 0 && <span className="badge red">{failed} failed</span>}
      </button>
      {open && (
        <Modal title="Sync" onClose={() => setOpen(false)}>
          <p>{online ? 'Connected.' : 'No connection. You can keep entering weighments, runs, logs, packing and dispatch; they are saved on this device and sent when the signal returns.'}</p>
          <div className="row" style={{ marginBottom: 8 }}>
            <button className="btn" onClick={() => flush()} disabled={s.flushing || !s.items.length}><RefreshCw size={16} /> {s.flushing ? 'Sending...' : 'Send now'}</button>
          </div>
          {s.items.length ? <OutboxList title="Waiting" /> : <p className="muted">Nothing waiting. Everything is saved on the server.</p>}
        </Modal>
      )}
    </>
  )
}
