import { useEffect, useRef, useState } from 'react'
import { fetchListings } from '../api.js'
import { PROPERTY_TYPES, formatUGX, propertyTypeLabel } from '../lib/validation.js'

// Predefined bands beat free-number inputs on a phone; each maps to the
// API's min_rent/max_rent params.
const RENT_BANDS = [
  { value: '', label: 'Any price' },
  { value: 'under_500k', label: 'Under 500k', max_rent: 500_000 },
  { value: '500k_1m', label: '500k – 1M', min_rent: 500_000, max_rent: 1_000_000 },
  { value: '1m_2m', label: '1M – 2M', min_rent: 1_000_000, max_rent: 2_000_000 },
  { value: 'above_2m', label: 'Above 2M', min_rent: 2_000_000 },
]

export default function FeedPage({ navigate }) {
  const [q, setQ] = useState('')
  const [propertyType, setPropertyType] = useState('')
  const [band, setBand] = useState('')
  const [listings, setListings] = useState(null) // null = first load in flight
  const [error, setError] = useState(null)
  const [retryTick, setRetryTick] = useState(0)
  const requestId = useRef(0)

  useEffect(() => {
    const id = ++requestId.current
    const load = async () => {
      try {
        const range = RENT_BANDS.find((b) => b.value === band) ?? {}
        const results = await fetchListings({
          q,
          property_type: propertyType,
          min_rent: range.min_rent,
          max_rent: range.max_rent,
        })
        if (requestId.current !== id) return // a newer query superseded this one
        setListings(results)
        setError(null)
      } catch (err) {
        if (requestId.current !== id) return
        setError(err.message)
      }
    }
    // One debounce covers typing; while it runs the previous results stay
    // visible, so filter taps never flash the skeletons.
    const timer = setTimeout(load, 250)
    return () => clearTimeout(timer)
  }, [q, propertyType, band, retryTick])

  return (
    <div className="feed">
      <div className="feed-filters" role="search">
        <input
          type="search"
          className="feed-search"
          aria-label="Search by location"
          placeholder="Search area, district or landmark…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="feed-filter-row">
          <select
            aria-label="Property type"
            value={propertyType}
            onChange={(e) => setPropertyType(e.target.value)}
          >
            <option value="">All types</option>
            {PROPERTY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <select aria-label="Rent range" value={band} onChange={(e) => setBand(e.target.value)}>
            {RENT_BANDS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? (
        <div className="card feed-error" role="alert">
          <p>{error}</p>
          <button className="btn-secondary" onClick={() => setRetryTick((t) => t + 1)}>
            Try again
          </button>
        </div>
      ) : listings === null ? (
        <SkeletonFeed />
      ) : listings.length === 0 ? (
        <p className="feed-empty">
          No listings match your search yet. Try a different area or price range.
        </p>
      ) : (
        <ul className="feed-grid">
          {listings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} navigate={navigate} />
          ))}
        </ul>
      )}
    </div>
  )
}

function ListingCard({ listing, navigate }) {
  const href = `/listing/${listing.id}`
  return (
    <li className="feed-card">
      <a
        href={href}
        aria-label={`${listing.title} — ${listing.area}, ${listing.district}`}
        onClick={(e) => {
          e.preventDefault()
          navigate(href)
        }}
      >
        <div className="feed-photo-wrap">
          {listing.photo_url ? (
            <img
              className="feed-photo"
              src={listing.photo_url}
              alt={`Photo of ${listing.title}`}
              loading="lazy"
            />
          ) : (
            <div className="feed-photo feed-photo-empty" aria-hidden="true">
              🏠
            </div>
          )}
          <span className="verified-chip">✓ Verified</span>
        </div>
        <div className="feed-card-body">
          <p className="feed-rent">
            {formatUGX(listing.rent_ugx)} <span>/month</span>
          </p>
          <h3 className="feed-title">{listing.title}</h3>
          <p className="feed-location">
            {listing.area}, {listing.district} · {propertyTypeLabel(listing.property_type)}
          </p>
        </div>
      </a>
    </li>
  )
}

function SkeletonFeed() {
  return (
    <ul className="feed-grid" aria-hidden="true" data-testid="feed-skeleton">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="feed-card">
          <div className="skeleton skeleton-photo" />
          <div className="feed-card-body">
            <div className="skeleton skeleton-line w-40" />
            <div className="skeleton skeleton-line w-80" />
            <div className="skeleton skeleton-line w-60" />
          </div>
        </li>
      ))}
    </ul>
  )
}
