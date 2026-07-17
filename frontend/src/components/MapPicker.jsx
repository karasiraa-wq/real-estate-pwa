import { useEffect, useRef, useState } from 'react'
import { KAMPALA, loadLeaflet, osmLayer, pinIcon } from '../lib/leaflet.js'
import { UGANDA_BOUNDS } from '../lib/validation.js'

/**
 * Optional "pin location" step of the submission form. The map (Leaflet +
 * OpenStreetMap tiles — no API key, no billing) only loads after the landlord
 * chooses to add a pin; skipping keeps the form as light as before.
 */
export default function MapPicker({ value, onChange, error }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)
  const stateRef = useRef(null) // { map, L, marker }
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    const init = async () => {
      const L = await loadLeaflet()
      const el = containerRef.current
      if (cancelled || !el || stateRef.current) return
      const center = value ? [value.latitude, value.longitude] : KAMPALA
      const map = L.map(el, { zoomControl: true }).setView(center, value ? 15 : 12)
      osmLayer(L).addTo(map)
      const state = { map, L, marker: null }
      const place = (lat, lng) => {
        const latitude = Number(lat.toFixed(5))
        const longitude = Number(lng.toFixed(5))
        if (state.marker) state.marker.setLatLng([latitude, longitude])
        else state.marker = L.marker([latitude, longitude], { icon: pinIcon(L) }).addTo(map)
        onChangeRef.current({ latitude, longitude })
      }
      if (value) place(value.latitude, value.longitude)
      map.on('click', (e) => place(e.latlng.lat, e.latlng.lng))
      stateRef.current = state
    }
    init()
    return () => {
      cancelled = true
      if (stateRef.current) {
        stateRef.current.map.remove()
        stateRef.current = null
      }
    }
    // The map owns the pin once open; value is only the starting point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function clear() {
    if (stateRef.current?.marker) {
      stateRef.current.marker.remove()
      stateRef.current.marker = null
    }
    onChange(null)
  }

  const outsideUganda =
    value &&
    (value.latitude < UGANDA_BOUNDS.latMin ||
      value.latitude > UGANDA_BOUNDS.latMax ||
      value.longitude < UGANDA_BOUNDS.lngMin ||
      value.longitude > UGANDA_BOUNDS.lngMax)

  if (!open) {
    return (
      <div className="field map-picker">
        <span className="map-picker-label">Location pin (optional)</span>
        <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
          📍 Pin location on map
        </button>
        <p className="field-hint">
          {value
            ? `Pinned at ${value.latitude}, ${value.longitude}`
            : 'Helps buyers and tenants find the property. You can skip this.'}
        </p>
      </div>
    )
  }

  return (
    <div className="field map-picker">
      <span className="map-picker-label">Location pin (optional)</span>
      <p className="field-hint">Tap the map to place the pin, tap again to move it.</p>
      <div ref={containerRef} className="map-canvas map-canvas-picker" data-testid="map-picker" />
      <div className="map-picker-actions">
        <button
          type="button"
          className="btn-small"
          onClick={() => {
            clear()
            setOpen(false)
          }}
        >
          Skip — no pin
        </button>
        {value && (
          <button type="button" className="btn-small" onClick={clear}>
            Remove pin
          </button>
        )}
      </div>
      {(error || outsideUganda) && (
        <p className="field-error" role="alert">
          {error || 'The pin must be inside Uganda'}
        </p>
      )}
    </div>
  )
}
