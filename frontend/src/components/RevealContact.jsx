import { useState } from 'react'
import { registerTenant, revealContact, submitPaymentClaim } from '../api.js'
import {
  announceCredits,
  announcePassReveals,
  clearTenant,
  getTenantToken,
  saveTenant,
} from '../lib/tenant.js'
import { UG_PHONE, formatUGX } from '../lib/validation.js'
import { whatsappLink } from '../lib/whatsapp.js'

/**
 * Gate around the WhatsApp button. The number never arrives with the listing;
 * it only exists client-side after POST /api/listings/{id}/contact succeeds.
 * Steps: idle → (register once) → revealed, or → pay → pending when the
 * paywall is on and the tenant is out of credits.
 */
export default function RevealContact({ listing, onRevealed }) {
  const [step, setStep] = useState('idle') // idle | register | pay | pending | revealed
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [phone, setPhone] = useState('')
  const [payInfo, setPayInfo] = useState(null)
  const [txId, setTxId] = useState('')
  const [whatsappPhone, setWhatsappPhone] = useState(null)
  const isLand = listing.category === 'land'
  const ownerNoun = isLand ? 'Seller' : 'Owner'

  async function doReveal(token) {
    setBusy(true)
    setError('')
    try {
      const res = await revealContact(token, listing.id)
      setWhatsappPhone(res.whatsapp_phone)
      announceCredits(res.credits_remaining, listing.category)
      announcePassReveals(res.pass_reveals_remaining ?? null)
      // Hands the exact coordinates (paid content for rentals) to the page.
      onRevealed?.(res)
      setStep('revealed')
    } catch (err) {
      if (err.status === 401) {
        clearTenant()
        setStep('register')
      } else if (err.status === 402 && err.detail) {
        setPayInfo(err.detail)
        setStep(err.detail.pending_claim ? 'pending' : 'pay')
      } else {
        setError(err.message)
      }
    } finally {
      setBusy(false)
    }
  }

  function start() {
    const token = getTenantToken()
    if (token) doReveal(token)
    else setStep('register')
  }

  async function handleRegister(e) {
    e.preventDefault()
    const clean = phone.replace(/[\s-]/g, '')
    if (!UG_PHONE.test(clean)) {
      setError('Enter a Ugandan mobile number, e.g. 0771234567')
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await registerTenant(clean)
      saveTenant(res.token, res.phone)
      await doReveal(res.token)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  async function handleClaim(e) {
    e.preventDefault()
    const clean = txId.trim()
    if (!clean) {
      setError('Enter the Mobile Money transaction ID')
      return
    }
    setBusy(true)
    setError('')
    try {
      // The claim carries the product from the 402 payload, so the admin
      // grants the right thing (standard bundle vs day pass vs land credits).
      const fallback = listing.category === 'land' ? 'land' : 'standard_rental'
      await submitPaymentClaim(getTenantToken(), clean, payInfo?.product ?? fallback)
      setStep('pending')
    } catch (err) {
      // 409 = this transaction ID was already submitted; same outcome for the user.
      if (err.status === 409) setStep('pending')
      else setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (step === 'revealed') {
    return (
      <a
        className="btn-whatsapp"
        href={whatsappLink({ ...listing, whatsapp_phone: whatsappPhone })}
        target="_blank"
        rel="noopener noreferrer"
      >
        WhatsApp {ownerNoun}
      </a>
    )
  }

  if (step === 'register') {
    return (
      <form className="card reveal-panel" onSubmit={handleRegister}>
        <h3>Your phone number</h3>
        <p className="reveal-hint">
          Register once with your phone number to contact {isLand ? 'sellers' : 'landlords'} on
          RentUg.
        </p>
        <div className="field">
          <label htmlFor="tenant_phone">Phone number</label>
          <input
            id="tenant_phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="0771234567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'One moment…' : 'Continue'}
        </button>
      </form>
    )
  }

  if (step === 'pay' && payInfo) {
    // Price and product come from the 402 payload, so this screen always
    // sells what THIS listing needs: standard bundle (5,000/20), Premium Day
    // Pass (20,000, capped — never "unlimited"), or land bundle (50,000/3).
    const payLand = payInfo.category === 'land'
    const payPass = payInfo.product === 'premium_pass'
    return (
      <div className="card reveal-panel">
        <h3>
          {payPass
            ? 'Get a Premium Day Pass'
            : payLand
              ? 'Buy land contact reveals'
              : 'Buy contact reveals'}
        </h3>
        {payPass && payInfo.pass_status === 'expired' && (
          <p className="pass-status-note">Your last day pass expired at midnight.</p>
        )}
        {payPass && payInfo.pass_status === 'exhausted' && (
          <p className="pass-status-note">
            Your day pass has used all {payInfo.pass_max_reveals} contacts for today.
          </p>
        )}
        <p className="reveal-hint">
          {payPass ? (
            <>
              Access ALL rental listings until midnight today · up to{' '}
              {payInfo.pass_max_reveals} contacts, for {formatUGX(payInfo.price_ugx)}.
            </>
          ) : (
            <>
              {payInfo.credits_per_purchase}{' '}
              {payLand ? 'land seller contact reveals' : 'contact reveals'} for{' '}
              {formatUGX(payInfo.price_ugx)}.
            </>
          )}
        </p>
        <div className="momo-box">
          <p className="momo-number">{payInfo.momo_number}</p>
          <p className="momo-name">{payInfo.momo_name} · Mobile Money</p>
        </div>
        <p className="reveal-instructions">{payInfo.payment_instructions}</p>
        <form onSubmit={handleClaim}>
          <div className="field">
            <label htmlFor="momo_tx_id">Mobile Money transaction ID</label>
            <input
              id="momo_tx_id"
              inputMode="text"
              autoComplete="off"
              placeholder="e.g. 74211539062"
              value={txId}
              onChange={(e) => setTxId(e.target.value)}
            />
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Submitting…' : 'Submit transaction ID'}
          </button>
        </form>
      </div>
    )
  }

  if (step === 'pending') {
    return (
      <div className="card reveal-panel reveal-pending" role="status">
        <h3>Pending verification</h3>
        <p className="reveal-hint">
          We are confirming your payment. Your reveals will be added shortly —
          this is done by a person, so it can take a little while.
        </p>
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() => doReveal(getTenantToken())}
        >
          {busy ? 'Checking…' : 'I have been verified — try again'}
        </button>
      </div>
    )
  }

  return (
    <>
      {error && (
        <p className="submit-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="btn-whatsapp btn-reveal" disabled={busy} onClick={start}>
        {busy
          ? 'One moment…'
          : isLand
            ? "Reveal seller's WhatsApp contact"
            : 'Reveal WhatsApp contact'}
      </button>
    </>
  )
}
