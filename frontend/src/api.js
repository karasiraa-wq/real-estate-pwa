const BASE = import.meta.env.VITE_API_BASE_URL || ''

export class ApiError extends Error {
  constructor(message, { status = 0, fieldErrors = {} } = {}) {
    super(message)
    this.status = status
    this.fieldErrors = fieldErrors
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
      : 'Something went wrong on our side. Please try again.'
  return new ApiError(message, { status: response.status })
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
