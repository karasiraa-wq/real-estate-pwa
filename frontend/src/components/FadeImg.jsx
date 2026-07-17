import { useEffect, useRef, useState } from 'react'

/**
 * <img> that fades in once its bytes arrive (.img-fade in styles.css), so
 * photos appear smoothly instead of popping in scanline-by-scanline on 3G.
 * Cached images can fire `load` before React attaches the handler, so the
 * effect double-checks `complete` after mount.
 */
export default function FadeImg({ className = '', ...props }) {
  const ref = useRef(null)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (ref.current?.complete) setLoaded(true)
  }, [])
  return (
    <img
      ref={ref}
      {...props}
      className={`${className} img-fade${loaded ? ' is-loaded' : ''}`.trim()}
      onLoad={() => setLoaded(true)}
    />
  )
}
