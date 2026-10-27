// Which maintenance tasks are due. Shared by the app, the reports and the alert script (no JSX here).
export function computeDue(schedules, assets, hours) {
  const assetMap = Object.fromEntries(assets.map((a) => [a.id, a]))
  const hrs = Object.fromEntries(hours.map((h) => [h.mill_id, Number(h.total_hours)]))
  return schedules.map((s) => {
    const a = assetMap[s.asset_id]
    const mh = a?.mill_id ? hrs[a.mill_id] ?? 0 : null
    let state = 'ok'
    const detail = []
    if (!s.last_done_at) {
      state = 'due'
      detail.push('never done')
    }
    if (s.every_days && s.last_done_at) {
      const days = (Date.now() - new Date(s.last_done_at).getTime()) / 86400000
      const left = s.every_days - days
      detail.push(left >= 0 ? `${Math.ceil(left)} d left` : `${Math.ceil(-left)} d overdue`)
      if (left < 0) state = 'due'
      else if (left < s.every_days * 0.15 && state === 'ok') state = 'soon'
    }
    if (s.every_hours && mh != null) {
      const used = mh - Number(s.last_done_hours ?? 0)
      const left = s.every_hours - used
      detail.push(left >= 0 ? `${left.toFixed(0)} h left` : `${(-left).toFixed(0)} h overdue`)
      if (left < 0) state = 'due'
      else if (left < s.every_hours * 0.1 && state === 'ok') state = 'soon'
    }
    return { ...s, asset: a, mill_hours: mh, state, detail: detail.join(' | ') }
  })
}
