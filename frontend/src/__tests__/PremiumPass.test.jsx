import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminPage from '../components/AdminPage.jsx'
import CreditsBadge from '../components/CreditsBadge.jsx'
import FeedPage from '../components/FeedPage.jsx'
import ListingDetail from '../components/ListingDetail.jsx'
import { clearTenant, saveTenant } from '../lib/tenant.js'

// Tiered rental pricing UI: the Premium badge, the day-pass payment screen
// (always "up to N contacts", never "unlimited"), the pass chip in the
// credits badge, and the product-aware admin payments tab.

const PREMIUM_DETAIL = {
  id: 7,
  title: 'Executive apartment in Kololo',
  category: 'rental',
  property_type: 'apartment',
  district: 'Kampala',
  area: 'Kololo',
  landmark: null,
  rent_ugx: 900000,
  tier: 'premium',
  description: 'Serviced two-bedroom apartment.',
  landlord_name: 'Andrew K',
  created_at: '2026-07-09T10:00:00Z',
  photo_url: null,
  photo_urls: [],
}

const PREMIUM_402 = {
  category: 'rental',
  tier: 'premium',
  product: 'premium_pass',
  credits_remaining: 0,
  price_ugx: 20000,
  credits_per_purchase: null,
  momo_number: '0779999999',
  momo_name: 'Andrew K',
  payment_instructions:
    'Send UGX 20,000 by Mobile Money to 0779999999 (Andrew K), then enter the ' +
    'transaction ID below. You get a Premium Day Pass — access to ALL rental ' +
    'listings until midnight today, up to 30 contacts — once we verify the payment.',
  pending_claim: false,
  pass_status: 'none',
  pass_price_ugx: 20000,
  pass_max_reveals: 30,
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function mockApi(routes) {
  fetch.mockImplementation((url, options = {}) => {
    const key = `${options.method || 'GET'} ${url}`
    const handler = routes[key]
    if (!handler) return Promise.reject(new Error(`no mock for ${key}`))
    const { body, status = 200 } = typeof handler === 'function' ? handler() : handler
    return Promise.resolve(jsonResponse(body, status))
  })
}

beforeEach(() => {
  global.fetch = vi.fn()
  localStorage.clear()
  sessionStorage.clear()
  clearTenant()
})

describe('premium badge', () => {
  it('marks premium cards in the feed and on the detail page, standard ones never', async () => {
    fetch.mockResolvedValueOnce(
      jsonResponse([
        { ...PREMIUM_DETAIL, photo_urls: undefined },
        {
          id: 1,
          title: 'Room in Kansanga',
          property_type: 'single_room',
          district: 'Kampala',
          area: 'Kansanga',
          rent_ugx: 250000,
          tier: 'standard',
          photo_url: null,
        },
      ]),
    )
    render(<FeedPage navigate={vi.fn()} />)

    const cards = await screen.findAllByRole('link')
    expect(within(cards[0]).getByText('Premium')).toBeInTheDocument()
    expect(within(cards[1]).queryByText('Premium')).not.toBeInTheDocument()
  })

  it('hides the badge while the paywall ships dark (no tier from the API)', async () => {
    fetch.mockResolvedValueOnce(jsonResponse([{ ...PREMIUM_DETAIL, tier: null }]))
    render(<FeedPage navigate={vi.fn()} />)
    await screen.findAllByRole('link')
    expect(screen.queryByText('Premium')).not.toBeInTheDocument()
  })

  it('shows the badge on a premium detail page', async () => {
    fetch.mockResolvedValueOnce(jsonResponse(PREMIUM_DETAIL))
    render(<ListingDetail id="7" navigate={vi.fn()} />)
    await screen.findByRole('heading', { name: PREMIUM_DETAIL.title })
    expect(screen.getByText('Premium')).toBeInTheDocument()
  })
})

describe('day-pass payment screen', () => {
  it('offers the day pass on a premium 402 with capped wording and claims the right product', async () => {
    saveTenant('tok-2', '+256700111222')
    mockApi({
      'GET /api/listings/7': { body: PREMIUM_DETAIL },
      'GET /api/tenants/me': {
        body: {
          phone: '+256700111222',
          credits_remaining: 4,
          land_credits_remaining: 0,
          reveals_count: 16,
          paywall_enabled: true,
          premium_pass_status: 'none',
          premium_pass_expires_at: null,
          premium_pass_reveals_remaining: null,
        },
      },
      'POST /api/listings/7/contact': { status: 402, body: { detail: PREMIUM_402 } },
      'POST /api/tenants/payment-claims': {
        status: 201,
        body: {
          id: 1,
          momo_tx_id: 'MTN777',
          product: 'premium_pass',
          status: 'pending',
          created_at: '2026-07-17',
        },
      },
    })
    const user = userEvent.setup()
    render(<ListingDetail id="7" navigate={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: /reveal whatsapp contact/i }))

    expect(
      await screen.findByRole('heading', { name: /get a premium day pass/i }),
    ).toBeInTheDocument()
    // Both the offer line and the server instructions carry the wording.
    expect(screen.getAllByText(/all rental listings until midnight today/i)).not.toHaveLength(0)
    expect(screen.getAllByText(/up to 30 contacts/i)).not.toHaveLength(0)
    expect(screen.getAllByText(/UGX 20,000/)).not.toHaveLength(0)
    // The promise is always a capped count, never unlimited access.
    expect(document.body.innerHTML.toLowerCase()).not.toContain('unlimited')

    await user.type(screen.getByLabelText(/mobile money transaction id/i), 'MTN777')
    await user.click(screen.getByRole('button', { name: /submit transaction id/i }))

    expect(await screen.findByText(/pending verification/i)).toBeInTheDocument()
    const claimCall = fetch.mock.calls.find(([url]) => url === '/api/tenants/payment-claims')
    expect(JSON.parse(claimCall[1].body)).toEqual({
      momo_tx_id: 'MTN777',
      product: 'premium_pass',
    })
  })

  it('explains an expired pass on the pay screen', async () => {
    saveTenant('tok-2', '+256700111222')
    mockApi({
      'GET /api/listings/7': { body: PREMIUM_DETAIL },
      'GET /api/tenants/me': { status: 401, body: { detail: 'nope' } },
      'POST /api/listings/7/contact': {
        status: 402,
        body: { detail: { ...PREMIUM_402, pass_status: 'expired' } },
      },
    })
    const user = userEvent.setup()
    render(<ListingDetail id="7" navigate={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: /reveal whatsapp contact/i }))
    expect(await screen.findByText(/expired at midnight/i)).toBeInTheDocument()
  })
})

describe('credits badge with a pass', () => {
  it('shows standard credits plus the pass expiry and remaining reveals', async () => {
    saveTenant('tok-3', '+256700111222')
    mockApi({
      'GET /api/tenants/me': {
        body: {
          phone: '+256700111222',
          credits_remaining: 4,
          land_credits_remaining: 0,
          reveals_count: 16,
          paywall_enabled: true,
          premium_pass_status: 'active',
          premium_pass_expires_at: '2026-07-17T21:00:00Z',
          premium_pass_reveals_remaining: 12,
        },
      },
    })
    render(<CreditsBadge />)

    expect(await screen.findByText(/premium until \d{2}:\d{2} · 12 left/i)).toBeInTheDocument()
    expect(screen.getByText(/4 reveals left/)).toBeInTheDocument()
  })

  it('shows no pass chip without an active pass', async () => {
    saveTenant('tok-3', '+256700111222')
    mockApi({
      'GET /api/tenants/me': {
        body: {
          phone: '+256700111222',
          credits_remaining: 4,
          land_credits_remaining: 0,
          reveals_count: 0,
          paywall_enabled: true,
          premium_pass_status: 'expired',
          premium_pass_expires_at: '2026-07-16T21:00:00Z',
          premium_pass_reveals_remaining: 0,
        },
      },
    })
    render(<CreditsBadge />)
    expect(await screen.findByText(/4 reveals left/)).toBeInTheDocument()
    expect(screen.queryByText(/premium until/i)).not.toBeInTheDocument()
  })
})

describe('admin payments with products', () => {
  async function signIn(user) {
    fetch.mockResolvedValueOnce(jsonResponse([]))
    render(<AdminPage />)
    await user.type(screen.getByLabelText(/admin password/i), 'secret-token')
    await user.click(screen.getByRole('button', { name: /sign in/i }))
    await screen.findByRole('heading', { name: /pending listings/i })
  }

  it('labels a premium pass claim and grants a pass manually', async () => {
    const user = userEvent.setup()
    await signIn(user)

    fetch.mockResolvedValueOnce(
      jsonResponse([
        {
          id: 5,
          momo_tx_id: 'MTN-PP',
          tenant_phone: '+256700111222',
          category: 'rental',
          product: 'premium_pass',
          status: 'pending',
          created_at: '2026-07-17T10:00:00Z',
        },
      ]),
    )
    await user.click(screen.getByRole('button', { name: 'Payments' }))
    await screen.findByRole('heading', { name: /pending payments/i })

    const card = screen.getByRole('article', { name: /claim mtn-pp/i })
    expect(within(card).getByText('Premium pass')).toBeInTheDocument()
    expect(within(card).getByText(/premium day pass/i)).toBeInTheDocument()

    // Manual grant with the day-pass product selected.
    await user.type(screen.getByLabelText(/tenant phone number/i), '0700111222')
    await user.type(screen.getByLabelText(/momo transaction id/i), 'MTN-MANUAL')
    await user.selectOptions(screen.getByLabelText(/what they paid for/i), 'premium_pass')
    fetch.mockResolvedValueOnce(
      jsonResponse(
        {
          id: 9,
          tenant_phone: '+256700111222',
          credits: null,
          category: 'rental',
          product: 'premium_pass',
          momo_tx_id: 'MTN-MANUAL',
          source: 'manual',
          expires_at: '2026-07-17T21:00:00Z',
        },
        201,
      ),
    )
    await user.click(screen.getByRole('button', { name: /^grant reveals$/i }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      /granted a premium day pass to \+256700111222/i,
    )
    const call = fetch.mock.calls.at(-1)
    expect(call[0]).toBe('/api/admin/credit-grants')
    expect(JSON.parse(call[1].body)).toEqual({
      phone: '0700111222',
      momo_tx_id: 'MTN-MANUAL',
      product: 'premium_pass',
    })
  })
})
