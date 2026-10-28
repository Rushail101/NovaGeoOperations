import { useState } from 'react'
import Runs from './Runs.jsx'
import Weighments from './Weighments.jsx'
import { DowntimeTab, NotesTab, DustTab, CountTab } from './PlantLog.jsx'

const FeedTab = () => <Weighments only="mill_feed" title="Mill feed (quartz taken to the mills)" />

// Run time, down time and everything else that happens on the plant floor.
export default function PlantLogs() {
  const [tab, setTab] = useState('Mill runs')
  const tabs = { 'Mill runs': Runs, 'Mill feed': FeedTab, Downtime: DowntimeTab, 'Handover notes': NotesTab, 'Dust & fines': DustTab, 'Stock count': CountTab }
  const Tab = tabs[tab]
  return (
    <div>
      <div className="tabs">
        {Object.keys(tabs).map((k) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{k}</button>
        ))}
      </div>
      <Tab key={tab} />
    </div>
  )
}
