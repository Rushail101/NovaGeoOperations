import { useState } from 'react'
import { useAuth } from '../auth.jsx'
import { canDispatch } from '../perms.js'
import Weighments from './Weighments.jsx'
import Dispatch from './Dispatch.jsx'

// One place for everything that crosses the weighbridge: quartz coming in, powder going out.
export default function Shipments() {
  const { role } = useAuth()
  const out = canDispatch(role)
  const [dir, setDir] = useState('in')
  return (
    <div>
      <div className="tabs">
        <button className={dir === 'in' ? 'on' : ''} onClick={() => setDir('in')}>Inbound: quartz received</button>
        {out && <button className={dir === 'out' ? 'on' : ''} onClick={() => setDir('out')}>Outbound: goods shipped</button>}
      </div>
      {dir === 'in' || !out ? (
        <Weighments only="inbound" title="Inbound quartz" />
      ) : (
        <>
          <p className="muted">Scan or type each bag's serial number, enter the weighbridge gross and tare, and the app compares the bag total with the weighbridge net before you confirm.</p>
          <Dispatch />
        </>
      )}
    </div>
  )
}
