import { useEffect, useRef, useState } from 'react'
import { fetchTenantMe } from '../api.js'
import { getTenantToken } from '../lib/tenant.js'

/**
 * "N reveals left" chip for registered tenants. Renders nothing when the
 * tenant is not registered or the paywall ships dark (paywall_enabled=false),
 * so the launch UX is untouched. With an active Premium Day Pass it also
 * shows "Premium until 23:59 · N left" — always a capped count, never
 * "unlimited".
 */

// The pass dies at midnight; its last valid minute is what we display.
function passUntilLabel(expiresAt) {
  const lastMinute = new Date(new Date(expiresAt).getTime() - 60_000)
  return lastMinute.toLocaleTimeString('en-UG', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export default function CreditsBadge() {
  const [balances, setBalances] = useState(null) // null = hidden
  const [pulse, setPulse] = useState(false)
  const lastShown = useRef(null)

  // Pulse the chip when a balance it shows changes (a reveal was spent or
  // credits arrived) — never on first paint.
  useEffect(() => {
    if (balances === null) return undefined
    const shown = `${balances.rental}|${balances.land}|${balances.passRemaining ?? ''}`
    const changed = lastShown.current !== null && lastShown.current !== shown
    lastShown.current = shown
    if (!changed) return undefined
    setPulse(true)
    const timer = setTimeout(() => setPulse(false), 500)
    return () => clearTimeout(timer)
  }, [balances])

  useEffect(() => {
    let cancelled = false
    const token = getTenantToken()
    if (token) {
      fetchTenantMe(token)
        .then((me) => {
          if (!cancelled && me.paywall_enabled)
            setBalances({
              rental: me.credits_remaining,
              land: me.land_credits_remaining,
              passActive: me.premium_pass_status === 'active',
              passExpiresAt: me.premium_pass_expires_at,
              passRemaining: me.premium_pass_reveals_remaining,
            })
        })
        .catch(() => {}) // badge is decoration; never surface errors for it
    }
    const onCredits = (e) =>
      setBalances((current) =>
        current === null ? current : { ...current, [e.detail.category]: e.detail.credits }
      )
    const onPass = (e) =>
      setBalances((current) =>
        current === null
          ? current
          : {
              ...current,
              // null remaining = no live pass (expired); a number keeps it live.
              passActive: e.detail.remaining != null && current.passExpiresAt != null,
              passRemaining: e.detail.remaining,
            }
      )
    window.addEventListener('rentug:credits', onCredits)
    window.addEventListener('rentug:pass', onPass)
    return () => {
      cancelled = true
      window.removeEventListener('rentug:credits', onCredits)
      window.removeEventListener('rentug:pass', onPass)
    }
  }, [])

  if (balances === null) return null
  return (
    <span className={pulse ? 'credits-badge count-bump' : 'credits-badge'}>
      {balances.passActive && (
        <span className="pass-chip">
          Premium until {passUntilLabel(balances.passExpiresAt)} · {balances.passRemaining} left
        </span>
      )}
      {balances.rental} reveal{balances.rental === 1 ? '' : 's'} left
      {balances.land > 0 ? ` · ${balances.land} land` : ''}
    </span>
  )
}
