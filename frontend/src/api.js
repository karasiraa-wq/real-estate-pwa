const BASE = import.meta.env.VITE_API_BASE_URL || ''

export class ApiError extends Error {
  constructor(message, { status = 0, fieldErrors = {}, detail = null } = {}) {
    super(message)
    this.status = status
    this.fieldErrors = fieldErrors
    // Structured error payload, e.g. the 402 paywall body (price, MoMo details).
    this.detail = detail
  }
}

const NETWORK_MESSAGE =
  'Could not reach the server. Please check your connection and try again.'

/** Map FastAPI 422 validation details onto our form field names. */
function fieldErrorsFrom422(detail) {
  const errors = {}
  if (Array.isArray(detail)) {
    for (const item of detail) {
      const field = item?.loc?.[item.loc.length - 1]
      if (typeof field === 'string' && item?.msg) {
        errors[field] = item.msg.replace(/^Value error, /, '')
      }
    }
  }
  return errors
}

async function parseError(response) {
  let detail
  try {
    detail = (await response.json()).detail
  } catch {
    detail = null
  }
  if (response.status === 422) {
    const fieldErrors = fieldErrorsFrom422(detail)
    return new ApiError('Please fix the highlighted fields and try again.', {
      status: 422,
      fieldErrors,
    })
  }
  const message =
    typeof detail === 'string'
      ? detail
      : response.status === 402
        ? 'You have used all your contact reveals.'
        : 'Something went wrong on our side. Please try again.'
  return new ApiError(message, {
    status: response.status,
    detail: typeof detail === 'object' && detail !== null ? detail : null,
  })
}

/**
 * Submit a listing. Resolves to { id, status, message, photo_token }.
 * Throws ApiError with a user-facing message on failure.
 */
export async function submitListing(data) {
  let response
  try {
    response = await fetch(`${BASE}/api/listings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  } catch {
    throw new ApiError(NETWORK_MESSAGE)
  }
  if (!response.ok) throw await parseError(response)
  return response.json()
}

/**
 * Approved listings for the tenant feed, newest first (the public endpoint
 * only ever returns approved listings). Empty filter values are omitted.
 */
export async function fetchListings({ q, category, property_type, min_rent, max_rent } = {}) {
  const params = new URLSearchParams()
  if (q && q.trim()) params.set('q', q.trim())
  if (category) params.set('category', category) // omitted = rentals (server default)
  if (property_type) params.set('property_type', property_type)
  if (min_rent != null) params.set('min_rent', min_rent)
  if (max_rent != null) params.set('max_rent', max_rent)
  const query = params.toString()
  let response
  try {
    response = await fetch(`${BASE}/api/listings${query ? `?${query}` : ''}`)
  } catch {
    throw new ApiError(NETWORK_MESSAGE)
  }
  if (!response.ok) throw await parseError(response)
  return response.json()
}

/** One approved listing with full details; 404s if it is not approved. */
export async function fetchListing(id) {
  let response
  try {
    response = await fetch(`${BASE}/api/listings/${id}`)
  } catch {
    throw new ApiError(NETWORK_MESSAGE)
  }
  if (!response.ok) throw await parseError(response)
  return response.json()
}

/**
 * Register (or re-register) a tenant by phone number. Resolves to
 * { token, phone }; the token is shown exactly once, store it via lib/tenant.
 */
export async function registerTenant(phone) {
  let response
  try {
    response = await fetch(`${BASE}/api/tenants/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    })
  } catch {
    throw new ApiError(NETWORK_MESSAGE)
  }
  if (!response.ok) throw await parseError(response)
  return response.json()
}

async function tenantRequest(path, token, options = {}) {
  let response
  try {
    response = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
    })
  } catch {
    throw new ApiError(NETWORK_MESSAGE)
  }
  if (!response.ok) throw await parseError(response)
  return response.json()
}

/** { phone, credits_remaining, reveals_count, paywall_enabled } */
export function fetchTenantMe(token) {
  return tenantRequest('/api/tenants/me', token)
}

/**
 * Reveal a listing's WhatsApp contact. Resolves to
 * { whatsapp_phone, credits_remaining }. Throws ApiError 402 with the payment
 * payload in .detail when the tenant is out of credits.
 */
export function revealContact(token, listingId) {
  return tenantRequest(`/api/listings/${listingId}/contact`, token, { method: 'POST' })
}

/** Submit a MoMo transaction ID for manual verification by the owner.
 * category says which credit bundle was paid for (rental | land). */
export function submitPaymentClaim(token, momoTxId, category = 'rental') {
  return tenantRequest('/api/tenants/payment-claims', token, {
    method: 'POST',
    body: JSON.stringify({ momo_tx_id: momoTxId, category }),
  })
}

async function adminRequest(path, token, options = {}) {
  let response
  try {
    response = await fetch(`${BASE}/api/admin${path}`, {
      ...options,
      headers: {
        'X-Admin-Token': token,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
    })
  } catch {
    throw new ApiError(NETWORK_MESSAGE)
  }
  if (!response.ok) throw await parseError(response)
  return response.json()
}

/** Pending listings, oldest first. Also serves as the login check (401 on bad token). */
export function fetchAdminQueue(token) {
  return adminRequest('/listings', token)
}

export function approveListing(token, listingId) {
  return adminRequest(`/listings/${listingId}/approve`, token, { method: 'POST' })
}

export function rejectListing(token, listingId, reason) {
  return adminRequest(`/listings/${listingId}/reject`, token, {
    method: 'POST',
    body: JSON.stringify({ reason: reason || null }),
  })
}

/** Pending payment claims, oldest first: { id, momo_tx_id, tenant_phone, ... }. */
export function fetchPaymentClaims(token) {
  return adminRequest('/payment-claims', token)
}

/** Approve a claim: grants the default credit bundle to its tenant. */
export function approvePaymentClaim(token, claimId) {
  return adminRequest(`/payment-claims/${claimId}/approve`, token, { method: 'POST' })
}

/** Manual grant for tenants who paid without submitting a claim. */
export function grantCredits(token, { phone, momo_tx_id, credits, category }) {
  return adminRequest('/credit-grants', token, {
    method: 'POST',
    body: JSON.stringify({
      phone,
      momo_tx_id,
      ...(credits ? { credits } : {}),
      ...(category ? { category } : {}),
    }),
  })
}

/** Upload one compressed photo blob to a just-submitted listing. */
export async function uploadPhoto(listingId, photoToken, blob, name = 'photo.jpg') {
  const form = new FormData()
  form.append('photo', blob, name)
  let response
  try {
    response = await fetch(`${BASE}/api/listings/${listingId}/photos`, {
      method: 'POST',
      headers: { 'X-Photo-Token': photoToken },
      body: form,
    })
  } catch {
    throw new ApiError(NETWORK_MESSAGE)
  }
  if (!response.ok) throw await parseError(response)
  return response.json()
}
