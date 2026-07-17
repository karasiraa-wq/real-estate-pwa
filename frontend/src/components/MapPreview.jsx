import { useEffect, useRef } from 'react'
import { directionsUrl, loadLeaflet, osmLayer, pinIcon } from '../lib/leaflet.js'

/**
 * Detail-page map. Leaflet loads lazily, and only once the section scrolls
 * into view (3G budget). Two modes, enforcing the location privacy rule:
 *  - approximate: a ~300m circle around the server-displaced point, no pin and
 *    no directions — a rental's exact location is paid content.
 *  - exact: a pin plus "Get directions" (land listings, or a rental after its
 *    contact was revealed).
 * Rendered only when coordinates exist — a guessed location is never shown.
 */
export default function MapPreview({ latitude, longitude, approximate }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null) // { map, L, marker, circle }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return undefined
    let cancelled = false

    const init = async () => {
      const L = await loadLeaflet()
      if (cancelled || mapRef.current) return
      const map = L.map(el, {
        zoomControl: false,
        attributionControl: true,
        scrollWheelZoom: false,
        dragging: false,
        tap: false,
      })
      osmLayer(L).addTo(map)
      mapRef.current = { map, L, marker: null, circle: null }
      draw()
    }

    const draw = () => {
      const state = mapRef.current
      if (!state) return
      const { map, L } = state
      if (state.marker) state.marker.remove()
      if (state.circle) state.circle.remove()
      state.marker = null
      state.circle = null
      if (approximate) {
        state.circle = L.circle([latitude, longitude], {
          radius: 300,
          color: '#16a34a',
          weight: 2,
          fillOpacity: 0.15,
        }).addTo(map)
        map.setView([latitude, longitude], 14)
      } else {
        state.marker = L.marker([latitude, longitude], { icon: pinIcon(L) }).addTo(map)
        map.setView([latitude, longitude], 16)
      }
    }

    if (mapRef.current) {
      draw()
      return undefined
    }
    // Defer Leaflet until the map scrolls into view; environments without
    // IntersectionObserver just load it immediately.
    if (typeof IntersectionObserver === 'undefined') {
      init()
      return () => {
        cancelled = true
      }
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect()
          init()
        }
      },
      { rootMargin: '200px' }
    )
    observer.observe(el)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [latitude, longitude, approximate])

  useEffect(
    () => () => {
      if (mapRef.current) {
        mapRef.current.map.remove()
        mapRef.current = null
      }
    },
    []
  )

  return (
    <section className="card map-card" aria-label="Location map">
      <div className="map-head">
        <h3 className="detail-heading">Location</h3>
        {approximate ? (
          <span className="map-note">Approximate area — exact spot shown after you reveal the contact</span>
        ) : (
          <a
            className="btn-directions"
            href={directionsUrl(latitude, longitude)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Get directions
          </a>
        )}
      </div>
      <div ref={containerRef} className="map-canvas" data-testid="map-canvas" />
    </section>
  )
}
