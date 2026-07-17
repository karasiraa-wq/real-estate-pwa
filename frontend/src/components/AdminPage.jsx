import { useCallback, useEffect, useState } from 'react'
import {
  approveListing,
  approvePaymentClaim,
  fetchAdminQueue,
  fetchPaymentClaims,
  grantCredits,
  rejectListing,
} from '../api.js'
import {
  PROPERTY_TYPES,
  UG_PHONE,
  formatUGX,
  tenureLabel,
  titleStatusLabel,
} from '../lib/validation.js'

// sessionStorage: the token survives reloads in this tab but not a closed
// browser, and is never written to disk beyond the session.
const TOKEN_KEY = 'rentug_admin_token'

const TYPE_LABELS = Object.fromEntries(PROPERTY_TYPES.map((t) => [t.value, t.label]))

export default function AdminPage() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || '')
  const [tab, setTab] = useState('listings')

  function login(newToken) {
    sessionStorage.setItem(TOKEN_KEY, newToken)
    setToken(newToken)
  }

  function logout() {
    sessionStorage.removeItem(TOKEN_KEY)
    setToken('')
  }

  if (!token) return <AdminLogin onLogin={login} />
  return (
    <>
      <nav className="admin-tabs" aria-label="Admin sections">
        <button
          type="button"
          className={tab === 'listings' ? 'admin-tab active' : 'admin-tab'}
          onClick={() => setTab('listings')}
        >
          Listings
        </button>
        <button
          type="button"
          className={tab === 'payments' ? 'admin-tab active' : 'admin-tab'}
          onClick={() => setTab('payments')}
        >
          Payments
        </button>
      </nav>
      {tab === 'listings' ? (
        <AdminQueue token={token} onLogout={logout} />
      ) : (
        <PaymentsPanel token={token} onLogout={logout} />
      )}
    </>
  )
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

  const isLand = listing.category === 'land'

  return (
    <article className="card review-card" aria-label={listing.title}>
      <div className="review-head">
        <h3>
          <span className={isLand ? 'category-badge category-badge-land' : 'category-badge'}>
            {isLand ? 'Land' : 'Rental'}
          </span>{' '}
          {listing.title}
        </h3>
        <p className="review-meta">
          #{listing.id} ·{' '}
          {isLand
            ? `Plot ${listing.plot_size}`
            : TYPE_LABELS[listing.property_type] || listing.property_type}{' '}
          · submitted {submitted}
        </p>
      </div>

      {isLand ? (
        <>
          <p className="review-rent">{formatUGX(listing.asking_price_ugx)} asking price</p>
          <p className="review-land-fields">
            Tenure: <strong>{tenureLabel(listing.tenure)}</strong> · Title:{' '}
            <strong>{titleStatusLabel(listing.title_status)}</strong> (as stated by the seller)
          </p>
        </>
      ) : (
        <p className="review-rent">{formatUGX(listing.rent_ugx)} /month</p>
      )}
      <p className="review-location">
        {listing.area}, {listing.district}
        {listing.landmark ? ` — ${listing.landmark}` : ''}
        {listing.latitude != null && (
          <>
            {' · '}
            <a
              href={`https://www.openstreetmap.org/?mlat=${listing.latitude}&mlon=${listing.longitude}#map=16/${listing.latitude}/${listing.longitude}`}
              target="_blank"
              rel="noreferrer"
            >
              pinned location
            </a>
          </>
        )}
      </p>
      {listing.video_url && (
        <p className="review-video">
          Video:{' '}
          <a href={listing.video_url} target="_blank" rel="noreferrer">
            {listing.video_url}
          </a>
        </p>
      )}
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

function PaymentsPanel({ token, onLogout }) {
  const [claims, setClaims] = useState(null) // null = loading
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    setClaims(null)
    try {
      setClaims(await fetchPaymentClaims(token))
    } catch (err) {
      if (err.status === 401) return onLogout()
      setError(err.message)
      setClaims([])
    }
  }, [token, onLogout])

  useEffect(() => {
    load()
  }, [load])

  function removeClaim(id) {
    setClaims((c) => c.filter((x) => x.id !== id))
  }

  return (
    <section className="admin-queue">
      <div className="queue-bar">
        <h2>
          Pending payments
          {claims !== null && <span className="queue-count"> · {claims.length}</span>}
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
      {claims === null && <p className="queue-empty">Loading claims…</p>}
      {claims !== null && claims.length === 0 && !error && (
        <p className="queue-empty">No pending payment claims.</p>
      )}
      {claims?.map((claim) => (
        <ClaimCard
          key={claim.id}
          claim={claim}
          token={token}
          onDone={removeClaim}
          onAuthExpired={onLogout}
        />
      ))}

      <ManualGrantForm token={token} onAuthExpired={onLogout} />
    </section>
  )
}

function ClaimCard({ claim, token, onDone, onAuthExpired }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submitted = new Date(claim.created_at).toLocaleString('en-UG', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

  async function approve() {
    setBusy(true)
    setError('')
    try {
      await approvePaymentClaim(token, claim.id)
      onDone(claim.id)
    } catch (err) {
      if (err.status === 401) return onAuthExpired()
      // 409 = approved elsewhere or tx already granted; the card is stale.
      if (err.status === 409) return onDone(claim.id)
      setError(err.message)
      setBusy(false)
    }
  }

  const PRODUCT_LABELS = {
    standard_rental: 'rental credit bundle',
    premium_pass: 'Premium Day Pass (until midnight on approval day)',
    land: 'land credit bundle',
  }
  return (
    <article className="card review-card claim-card" aria-label={`Claim ${claim.momo_tx_id}`}>
      <div className="review-head">
        <h3>
          {claim.product === 'land' && (
            <span className="category-badge category-badge-land">Land</span>
          )}
          {claim.product === 'premium_pass' && (
            <span className="category-badge category-badge-premium">Premium pass</span>
          )}{' '}
          {claim.tenant_phone}
        </h3>
        <p className="review-meta">
          Transaction <strong>{claim.momo_tx_id}</strong> ·{' '}
          {PRODUCT_LABELS[claim.product] || 'rental credit bundle'} · submitted {submitted}
        </p>
      </div>
      {error && (
        <p className="submit-error" role="alert">
          {error}
        </p>
      )}
      <div className="review-actions">
        <button type="button" className="btn-approve" disabled={busy} onClick={approve}>
          {busy ? 'Approving…' : 'Approve — grant reveals'}
        </button>
      </div>
    </article>
  )
}

function ManualGrantForm({ token, onAuthExpired }) {
  const [phone, setPhone] = useState('')
  const [txId, setTxId] = useState('')
  const [product, setProduct] = useState('standard_rental')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setSuccess('')
    const cleanPhone = phone.replace(/[\s-]/g, '')
    if (!UG_PHONE.test(cleanPhone)) {
      setError('Enter the tenant phone number, e.g. 0771234567')
      return
    }
    if (!txId.trim()) {
      setError('Enter the MoMo transaction ID')
      return
    }
    setBusy(true)
    setError('')
    try {
      const grant = await grantCredits(token, {
        phone: cleanPhone,
        momo_tx_id: txId.trim(),
        product,
      })
      setSuccess(
        grant.product === 'premium_pass'
          ? `Granted a Premium Day Pass to ${grant.tenant_phone} — valid until midnight today`
          : `Granted ${grant.credits} ${grant.category === 'land' ? 'land ' : ''}reveals to ${grant.tenant_phone}`
      )
      setPhone('')
      setTxId('')
    } catch (err) {
      if (err.status === 401) return onAuthExpired()
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card manual-grant" onSubmit={handleSubmit}>
      <h3>Manual grant</h3>
      <p className="review-meta">
        For tenants who paid without submitting a claim in the app.
      </p>
      <div className="field">
        <label htmlFor="grant_phone">Tenant phone number</label>
        <input
          id="grant_phone"
          type="tel"
          inputMode="tel"
          placeholder="0771234567"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="grant_tx">MoMo transaction ID</label>
        <input
          id="grant_tx"
          autoComplete="off"
          value={txId}
          onChange={(e) => setTxId(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="grant_product">What they paid for</label>
        <select
          id="grant_product"
          value={product}
          onChange={(e) => setProduct(e.target.value)}
        >
          <option value="standard_rental">Rental reveals (default bundle)</option>
          <option value="premium_pass">Premium Day Pass (until midnight today)</option>
          <option value="land">Land reveals (default bundle)</option>
        </select>
      </div>
      {error && (
        <p className="submit-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="grant-success" role="status">
          ✓ {success}
        </p>
      )}
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? 'Granting…' : 'Grant reveals'}
      </button>
    </form>
  )
}
