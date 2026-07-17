// Tenant identity for the contact paywall. The opaque bearer token from
// /api/tenants/register is kept in memory and mirrored to localStorage so it
// survives reloads and PWA restarts. The token only unlocks contact reveals;
// entitlement itself is always checked server-side.

const TOKEN_KEY = 'rentug_tenant_token'
const PHONE_KEY = 'rentug_tenant_phone'

let memory = { token: null, phone: null }

function readStorage(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null // private mode / storage disabled: memory still works this session
  }
}

export function getTenantToken() {
  if (!memory.token) memory.token = readStorage(TOKEN_KEY)
  return memory.token
}

export function getTenantPhone() {
  if (!memory.phone) memory.phone = readStorage(PHONE_KEY)
  return memory.phone
}

export function saveTenant(token, phone) {
  memory = { token, phone }
  try {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(PHONE_KEY, phone)
  } catch {
    /* memory-only fallback */
  }
}

export function clearTenant() {
  memory = { token: null, phone: null }
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(PHONE_KEY)
  } catch {
    /* nothing to clear */
  }
}

// Lets the credits badge update instantly after a reveal without refetching.
// Credits are category-scoped (rental | land), so the event says which balance moved.
export function announceCredits(credits, category = 'rental') {
  window.dispatchEvent(new CustomEvent('rentug:credits', { detail: { credits, category } }))
}
