import { useEffect, useRef, useState } from 'react'
import { fetchListings } from '../api.js'
import {
  PROPERTY_TYPES,
  formatUGX,
  propertyTypeLabel,
  tenureLabel,
  titleStatusLabel,
} from '../lib/validation.js'
import CreditsBadge from './CreditsBadge.jsx'
import FadeImg from './FadeImg.jsx'
import LandBanner from './LandBanner.jsx'
import Logo from './Logo.jsx'
import PinIcon from './PinIcon.jsx'

// Predefined bands beat free-number inputs on a phone; each maps to the
// API's min_rent/max_rent params.
const RENT_BANDS = [
  { value: '', label: 'Any price' },
  { value: 'under_500k', label: 'Under 500k', max_rent: 500_000 },
  { value: '500k_1m', label: '500k – 1M', min_rent: 500_000, max_rent: 1_000_000 },
  { value: '1m_2m', label: '1M – 2M', min_rent: 1_000_000, max_rent: 2_000_000 },
  { value: 'above_2m', label: 'Above 2M', min_rent: 2_000_000 },
]

export default function FeedPage({ navigate, category = 'rental' }) {
  const isLand = category === 'land'
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
          // The server defaults to rentals; only the land feed needs the param.
          category: isLand ? 'land' : undefined,
          // Rent filters only make sense for rentals; land has no rent.
          property_type: isLand ? undefined : propertyType,
          min_rent: isLand ? undefined : range.min_rent,
          max_rent: isLand ? undefined : range.max_rent,
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
  }, [q, category, isLand, propertyType, band, retryTick])

  return (
    <div className={isLand ? 'feed land-theme' : 'feed'}>
      <CreditsBadge />
      <div className="feed-hero">
        {/* Buttons, not links: cards are the feed's only links, and these tabs
          navigate through the app's own history routing anyway. */}
        <nav className="feed-tabs" aria-label="Listing category">
          <button
            type="button"
            className={isLand ? 'feed-tab' : 'feed-tab active'}
            aria-pressed={!isLand}
            onClick={() => navigate('/')}
          >
            Rentals
          </button>
          <button
            type="button"
            className={isLand ? 'feed-tab active' : 'feed-tab'}
            aria-pressed={isLand}
            onClick={() => navigate('/land')}
          >
            Land
          </button>
        </nav>

        {isLand && <LandBanner />}

        <div className="feed-filters" role="search">
          <input
            type="search"
            className="feed-search"
            aria-label="Search by location"
            placeholder={
              isLand ? 'Search district or area…' : 'Search area, district or landmark…'
            }
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {!isLand && (
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
          )}
        </div>
      </div>

      {error ? (
        <div className="card feed-error empty-state" role="alert">
          <Logo size={52} tone={isLand ? 'land' : 'green'} className="placeholder-logo" />
          <h3>Something went wrong</h3>
          <p>{error}</p>
          {!navigator.onLine && (
            <p className="offline-hint">
              You look offline — fresh listings will load when you reconnect.
            </p>
          )}
          <button className="btn-secondary" onClick={() => setRetryTick((t) => t + 1)}>
            Try again
          </button>
        </div>
      ) : listings === null ? (
        <SkeletonFeed />
      ) : listings.length === 0 ? (
        <div className="card feed-empty empty-state">
          <Logo size={52} tone={isLand ? 'land' : 'green'} className="placeholder-logo" />
          <h3>No listings here yet</h3>
          <p>
            {isLand
              ? 'No land listings match your search yet. Every plot is reviewed before it goes live — check back soon.'
              : 'No listings match your search yet. Try a different area or price range.'}
          </p>
        </div>
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
  const isLand = listing.category === 'land'
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
            <FadeImg
              className="feed-photo"
              src={listing.photo_url}
              alt={`Photo of ${listing.title}`}
              loading="lazy"
            />
          ) : (
            <div className="feed-photo feed-photo-empty" aria-hidden="true">
              <Logo size={54} tone={isLand ? 'land' : 'green'} className="placeholder-logo" />
            </div>
          )}
          {/* Land wording is deliberate: RentUg reviews listings, it does NOT
              verify land titles — never imply otherwise. */}
          <span className="verified-chip">
            {isLand ? 'Listing reviewed by RentUg' : '✓ Verified'}
          </span>
          {/* tier only arrives from the API once the paywall is live */}
          {!isLand && listing.tier === 'premium' && (
            <span className="premium-badge">Premium</span>
          )}
          <p className="price-badge">
            {isLand ? (
              formatUGX(listing.asking_price_ugx)
            ) : (
              <>
                {formatUGX(listing.rent_ugx)} <span>/month</span>
              </>
            )}
          </p>
        </div>
        <div className="feed-card-body">
          <h3 className="feed-title">{listing.title}</h3>
          <p className="feed-location">
            <PinIcon />
            {listing.area}, {listing.district}
          </p>
          {isLand ? (
            <p className="land-badges">
              <span className="land-badge">{listing.plot_size}</span>
              <span className="land-badge">{tenureLabel(listing.tenure)}</span>
              <span className="land-badge land-badge-title">
                {titleStatusLabel(listing.title_status)}
              </span>
            </p>
          ) : (
            <p className="card-chips">
              <span className="type-chip">{propertyTypeLabel(listing.property_type)}</span>
            </p>
          )}
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
