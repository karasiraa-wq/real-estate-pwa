import { useEffect, useState } from 'react'
import { fetchTenantMe } from '../api.js'
import { getTenantToken } from '../lib/tenant.js'

/**
 * "N reveals left" chip for registered tenants. Renders nothing when the
 * tenant is not registered or the paywall ships dark (paywall_enabled=false),
 * so the launch UX is untouched.
 */
export default function CreditsBadge() {
  const [balances, setBalances] = useState(null) // null = hidden

  useEffect(() => {
    let cancelled = false
    const token = getTenantToken()
    if (token) {
      fetchTenantMe(token)
        .then((me) => {
          if (!cancelled && me.paywall_enabled)
            setBalances({ rental: me.credits_remaining, land: me.land_credits_remaining })
        })
        .catch(() => {}) // badge is decoration; never surface errors for it
    }
    const onCredits = (e) =>
      setBalances((current) =>
        current === null ? current : { ...current, [e.detail.category]: e.detail.credits }
      )
    window.addEventListener('rentug:credits', onCredits)
    return () => {
      cancelled = true
      window.removeEventListener('rentug:credits', onCredits)
    }
  }, [])

  if (balances === null) return null
  return (
    <span className="credits-badge">
      {balances.rental} reveal{balances.rental === 1 ? '' : 's'} left
      {balances.land > 0 ? ` · ${balances.land} land` : ''}
    </span>
  )
}
