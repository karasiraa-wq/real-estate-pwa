// Leaflet is ~40KB gzipped and only needed on pages that actually show a map,
// so it is always loaded through this dynamic import (its own Vite chunk) and
// never lands in the main bundle (3G budget).

let promise = null

export function loadLeaflet() {
  if (!promise) {
    promise = Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]).then(
      ([mod]) => mod.default ?? mod
    )
  }
  return promise
}

// Kampala, the default map view before a pin exists.
export const KAMPALA = [0.3476, 32.5825]

// CSS pin (see .map-pin in styles.css): no image assets to bundle or fetch.
export function pinIcon(L) {
  return L.divIcon({ className: 'map-pin', iconSize: [24, 24], iconAnchor: [12, 24] })
}

export function osmLayer(L) {
  return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  })
}

export function directionsUrl(lat, lng) {
  // Opens the Google Maps app via URL scheme — no API key, no billing.
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
}
