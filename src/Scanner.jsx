import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

// Camera QR scanner. Calls onScan(text) for each code read (same code is ignored for 2.5s).
export default function Scanner({ onScan, onClose }) {
  const video = useRef(null)
  const canvas = useRef(null)
  const cb = useRef(onScan)
  const [err, setErr] = useState(null)
  cb.current = onScan

  useEffect(() => {
    let stream, raf, stopped = false, last = '', lastAt = 0
    function tick() {
      if (stopped) return
      const v = video.current
      if (v && v.readyState === v.HAVE_ENOUGH_DATA) {
        const c = canvas.current
        c.width = v.videoWidth
        c.height = v.videoHeight
        const ctx = c.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(v, 0, 0, c.width, c.height)
        const img = ctx.getImageData(0, 0, c.width, c.height)
        const code = jsQR(img.data, img.width, img.height)
        if (code?.data && (code.data !== last || Date.now() - lastAt > 2500)) {
          last = code.data
          lastAt = Date.now()
          cb.current(code.data.trim())
        }
      }
      raf = requestAnimationFrame(tick)
    }
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        stream = s
        video.current.srcObject = s
        video.current.play()
        tick()
      })
      .catch(() => setErr('Camera not available. Allow camera access, or type the bag number instead.'))
    if (!navigator.mediaDevices) setErr('Camera needs a secure (https) connection.')
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return (
    <div>
      <div className="scanbox">
        <video ref={video} playsInline muted />
        <canvas ref={canvas} style={{ display: 'none' }} />
      </div>
      {err && <div className="error">{err}</div>}
      <button className="btn" style={{ marginTop: 8 }} onClick={onClose}>Close camera</button>
    </div>
  )
}
