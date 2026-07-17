import { useEffect, useState } from 'react'
import { fetchListing } from '../api.js'
import {
  formatUGX,
  propertyTypeLabel,
  tenureLabel,
  titleStatusLabel,
} from '../lib/validation.js'
import CreditsBadge from './CreditsBadge.jsx'
import LandBanner from './LandBanner.jsx'
import MapPreview from './MapPreview.jsx'
import RevealContact from './RevealContact.jsx'
import VideoEmbed from './VideoEmbed.jsx'

export default function ListingDetail({ id, navigate }) {
  const [listing, setListing] = useState(null)
  const [error, setError] = useState(null)
  // Exact coordinates only ever arrive from the authenticated contact reveal;
  // until then a rental's map shows the server's approximate area.
  const [revealedCoords, setRevealedCoords] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchListing(id)
      .then((data) => !cancelled && setListing(data))
      .catch((err) => !cancelled && setError(err))
    return () => {
      cancelled = true
    }
  }, [id])

  const back = (
    <div className="detail-topbar">
      <button className="detail-back" onClick={() => navigate('/')}>
        ← All listings
      </button>
      <CreditsBadge />
    </div>
  )

  if (error) {
    // Pending/rejected listings 404 exactly like missing ones, so this is all
    // a tenant ever learns about a non-approved listing.
    const gone = error.status === 404
    return (
      <div className="detail">
        {back}
        <div className="card detail-missing" role="alert">
          <h2>{gone ? 'This listing is no longer available' : 'Could not load this listing'}</h2>
          <p>{gone ? 'It may have been rented out or taken down.' : error.message}</p>
          <button className="btn-secondary" onClick={() => navigate('/')}>
            Back to listings
          </button>
        </div>
      </div>
    )
  }

  if (!listing) {
    return (
      <div className="detail" aria-hidden="true" data-testid="detail-skeleton">
        {back}
        <div className="skeleton skeleton-photo gallery-skeleton" />
        <div className="card">
          <div className="skeleton skeleton-line w-40" />
          <div className="skeleton skeleton-line w-80" />
          <div className="skeleton skeleton-line w-60" />
        </div>
      </div>
    )
  }

  const isLand = listing.category === 'land'
  const photos = listing.photo_urls ?? []
  // Never show a guessed location: no coordinates, no map section.
  const hasCoords = listing.public_latitude != null && listing.public_longitude != null
  const mapCoords = revealedCoords ?? {
    latitude: listing.public_latitude,
    longitude: listing.public_longitude,
  }
  const mapApproximate = listing.location_approximate && revealedCoords === null

  return (
    <article className={isLand ? 'detail land-theme' : 'detail'}>
      {back}
      {isLand && <LandBanner />}
      {photos.length > 0 ? (
        <div className="gallery" aria-label={`${photos.length} photos`}>
          {photos.map((url, i) => (
            <img
              key={url}
              src={url}
              alt={`Photo ${i + 1} of ${photos.length} — ${listing.title}`}
              loading={i === 0 ? 'eager' : 'lazy'}
            />
          ))}
        </div>
      ) : (
        <div className="feed-photo feed-photo-empty gallery-empty" aria-hidden="true">
          {isLand ? '🌍' : '🏠'}
        </div>
      )}

      <div className="card detail-card">
        {isLand ? (
          <p className="feed-rent detail-rent">{formatUGX(listing.asking_price_ugx)}</p>
        ) : (
          <p className="feed-rent detail-rent">
            {formatUGX(listing.rent_ugx)} <span>/month</span>
            {/* tier only arrives from the API once the paywall is live */}
            {listing.tier === 'premium' && <span className="premium-badge">Premium</span>}
          </p>
        )}
        <h2 className="detail-title">{listing.title}</h2>
        <p className="detail-location">
          📍 {listing.area}, {listing.district}
          {listing.landmark ? ` · ${listing.landmark}` : ''}
        </p>
        {isLand ? (
          <span className="detail-type">Plot · {listing.plot_size}</span>
        ) : (
          <span className="detail-type">{propertyTypeLabel(listing.property_type)}</span>
        )}

        {isLand && (
          /* HONESTY CONSTRAINT: tenure and title claims belong to the seller.
             RentUg reviews listings; it does not verify land titles — the UI
             must never say or imply that it does. */
          <div className="land-title-box">
            <p className="land-title-claim">
              Seller states: <strong>{tenureLabel(listing.tenure)}</strong> ·{' '}
              <strong>{titleStatusLabel(listing.title_status)}</strong>
            </p>
            <p className="land-title-note">
              Tenure and title details are provided by the seller. Always verify the title at
              the land registry before paying.
            </p>
          </div>
        )}

        <h3 className="detail-heading">{isLand ? 'About this plot' : 'About this property'}</h3>
        <p className="detail-description">{listing.description}</p>

        <div className="detail-landlord">
          <p>
            Listed by <strong>{listing.landlord_name}</strong>
          </p>
          <p className="detail-verified">
            {isLand ? 'Listing reviewed by RentUg' : '✓ Verified by RentUg before going live'}
          </p>
        </div>
      </div>

      {listing.video_url && <VideoEmbed url={listing.video_url} title={listing.title} />}

      {hasCoords && (
        <MapPreview
          latitude={mapCoords.latitude}
          longitude={mapCoords.longitude}
          approximate={mapApproximate}
        />
      )}

      <RevealContact
        listing={listing}
        onRevealed={(res) => {
          if (res.latitude != null && res.longitude != null) {
            setRevealedCoords({ latitude: res.latitude, longitude: res.longitude })
          }
        }}
      />
    </article>
  )
}
