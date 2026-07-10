import { useEffect, useState } from 'react'
import { fetchListing } from '../api.js'
import { formatUGX, propertyTypeLabel } from '../lib/validation.js'
import { whatsappLink } from '../lib/whatsapp.js'

export default function ListingDetail({ id, navigate }) {
  const [listing, setListing] = useState(null)
  const [error, setError] = useState(null)

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
    <button className="detail-back" onClick={() => navigate('/')}>
      ← All listings
    </button>
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

  const photos = listing.photo_urls ?? []
  return (
    <article className="detail">
      {back}
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
          🏠
        </div>
      )}

      <div className="card detail-card">
        <p className="feed-rent detail-rent">
          {formatUGX(listing.rent_ugx)} <span>/month</span>
        </p>
        <h2 className="detail-title">{listing.title}</h2>
        <p className="detail-location">
          📍 {listing.area}, {listing.district}
          {listing.landmark ? ` · ${listing.landmark}` : ''}
        </p>
        <span className="detail-type">{propertyTypeLabel(listing.property_type)}</span>

        <h3 className="detail-heading">About this property</h3>
        <p className="detail-description">{listing.description}</p>

        <div className="detail-landlord">
          <p>
            Listed by <strong>{listing.landlord_name}</strong>
          </p>
          <p className="detail-verified">✓ Verified by RentUg before going live</p>
        </div>
      </div>

      <a
        className="btn-whatsapp"
        href={whatsappLink(listing)}
        target="_blank"
        rel="noopener noreferrer"
      >
        WhatsApp Owner
      </a>
    </article>
  )
}
