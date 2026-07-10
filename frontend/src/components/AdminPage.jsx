import { useCallback, useEffect, useState } from 'react'
import { approveListing, fetchAdminQueue, rejectListing } from '../api.js'
import { PROPERTY_TYPES, formatUGX } from '../lib/validation.js'

// sessionStorage: the token survives reloads in this tab but not a closed
// browser, and is never written to disk beyond the session.
const TOKEN_KEY = 'rentug_admin_token'

const TYPE_LABELS = Object.fromEntries(PROPERTY_TYPES.map((t) => [t.value, t.label]))

export default function AdminPage() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || '')

  function login(newToken) {
    sessionStorage.setItem(TOKEN_KEY, newToken)
    setToken(newToken)
  }

  function logout() {
    sessionStorage.removeItem(TOKEN_KEY)
    setToken('')
  }

  if (!token) return <AdminLogin onLogin={login} />
  return <AdminQueue token={token} onLogout={logout} />
}

function AdminLogin({ onLogin }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!value.trim()) {
      setError('Enter the admin password')
      return
    }
    setChecking(true)
    setError('')
    try {
      await fetchAdminQueue(value.trim())
      onLogin(value.trim())
    } catch (err) {
      setError(err.message)
      setChecking(false)
    }
  }

  return (
    <form className="card admin-login" onSubmit={handleSubmit}>
      <h2>Admin sign in</h2>
      <div className="field">
        <label htmlFor="admin_token">Admin password</label>
        <input
          id="admin_token"
          type="password"
          autoComplete="current-password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <button type="submit" className="btn-primary" disabled={checking}>
        {checking ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}

function AdminQueue({ token, onLogout }) {
  const [listings, setListings] = useState(null) // null = loading
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    setListings(null)
    try {
      setListings(await fetchAdminQueue(token))
    } catch (err) {
      if (err.status === 401) return onLogout()
      setError(err.message)
      setListings([])
    }
  }, [token, onLogout])

  useEffect(() => {
    load()
  }, [load])

  function removeListing(id) {
    setListings((l) => l.filter((x) => x.id !== id))
  }

  return (
    <section className="admin-queue">
      <div className="queue-bar">
        <h2>
          Pending listings
          {listings !== null && <span className="queue-count"> · {listings.length}</span>}
        </h2>
        <div className="queue-actions">
          <button type="button" className="btn-small" onClick={load}>
            Refresh
          </button>
          <button type="button" className="btn-small" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </div>

      {error && (
        <p className="submit-error" role="alert">
          {error}
        </p>
      )}
      {listings === null && <p className="queue-empty">Loading queue…</p>}
      {listings !== null && listings.length === 0 && !error && (
        <p className="queue-empty">No pending listings. All caught up.</p>
      )}
      {listings?.map((listing) => (
        <ReviewCard
          key={listing.id}
          listing={listing}
          token={token}
          onDone={removeListing}
          onAuthExpired={onLogout}
        />
      ))}
    </section>
  )
}

function ReviewCard({ listing, token, onDone, onAuthExpired }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')

  async function act(action) {
    setBusy(true)
    setError('')
    try {
      await action()
      onDone(listing.id)
    } catch (err) {
      if (err.status === 401) return onAuthExpired()
      // 409 = already reviewed elsewhere; either way this card is stale.
      if (err.status === 409) return onDone(listing.id)
      setError(err.message)
      setBusy(false)
    }
  }

  const submitted = new Date(listing.created_at).toLocaleDateString('en-UG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  return (
    <article className="card review-card" aria-label={listing.title}>
      <div className="review-head">
        <h3>{listing.title}</h3>
        <p className="review-meta">
          #{listing.id} · {TYPE_LABELS[listing.property_type] || listing.property_type} ·
          submitted {submitted}
        </p>
      </div>

      <p className="review-rent">{formatUGX(listing.rent_ugx)} /month</p>
      <p className="review-location">
        {listing.area}, {listing.district}
        {listing.landmark ? ` — ${listing.landmark}` : ''}
      </p>
      <p className="review-description">{listing.description}</p>

      {listing.photo_urls.length > 0 ? (
        <div className="photo-grid review-photos">
          {listing.photo_urls.map((url) => (
            <a key={url} href={url} target="_blank" rel="noreferrer" className="photo-thumb">
              <img src={url} alt={`Photo of ${listing.title}`} />
            </a>
          ))}
        </div>
      ) : (
        <p className="review-no-photos">No photos uploaded</p>
      )}

      <p className="review-contact">
        <strong>{listing.landlord_name}</strong> · {listing.whatsapp_phone}
      </p>

      {error && (
        <p className="submit-error" role="alert">
          {error}
        </p>
      )}

      {rejecting ? (
        <div className="reject-panel">
          <label htmlFor={`reason-${listing.id}`}>Rejection reason (optional, private)</label>
          <textarea
            id={`reason-${listing.id}`}
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="review-actions">
            <button
              type="button"
              className="btn-danger"
              disabled={busy}
              onClick={() => act(() => rejectListing(token, listing.id, reason.trim()))}
            >
              {busy ? 'Rejecting…' : 'Confirm reject'}
            </button>
            <button
              type="button"
              className="btn-small"
              disabled={busy}
              onClick={() => setRejecting(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="review-actions">
          <button
            type="button"
            className="btn-approve"
            disabled={busy}
            onClick={() => act(() => approveListing(token, listing.id))}
          >
            {busy ? 'Approving…' : 'Approve'}
          </button>
          <button
            type="button"
            className="btn-danger-outline"
            disabled={busy}
            onClick={() => setRejecting(true)}
          >
            Reject
          </button>
        </div>
      )}
    </article>
  )
}
