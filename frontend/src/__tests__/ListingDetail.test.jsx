import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ListingDetail from '../components/ListingDetail.jsx'
import { clearTenant, saveTenant } from '../lib/tenant.js'
import { whatsappLink } from '../lib/whatsapp.js'

// What the public API returns now: NO whatsapp_phone — the contact only ever
// arrives via the authenticated /contact endpoint.
const LISTING = {
  id: 7,
  title: 'Self-contained room in Kansanga',
  property_type: 'self_contained',
  district: 'Kampala',
  area: 'Kansanga',
  landmark: 'Near Kansanga Miracle Centre',
  rent_ugx: 450000,
  description: 'Clean room with water and power included.',
  landlord_name: 'Andrew K',
  created_at: '2026-07-09T10:00:00Z',
  photo_url: '/uploads/a.jpg',
  photo_urls: ['/uploads/a.jpg', '/uploads/b.jpg'],
}

const EXPECTED_WA_MESSAGE = encodeURIComponent(
  'Hello Andrew K, I found your listing "Self-contained room in Kansanga" ' +
    'in Kansanga, Kampala on RentUg. Is it still available?',
)

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

/** Route fetch mocks by "METHOD url" so interleaved calls (badge, reveal) are stable. */
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
  clearTenant()
})

describe('listing detail', () => {
  it('shows the gallery and details but never the WhatsApp number', async () => {
    fetch.mockResolvedValueOnce(jsonResponse(LISTING))
    render(<ListingDetail id="7" navigate={vi.fn()} />)

    expect(screen.getByTestId('detail-skeleton')).toBeInTheDocument()
    expect(
      await screen.findByRole('heading', { name: 'Self-contained room in Kansanga' }),
    ).toBeInTheDocument()
    expect(fetch.mock.calls[0][0]).toBe('/api/listings/7')

    expect(screen.getByAltText('Photo 1 of 2 — Self-contained room in Kansanga')).toHaveAttribute(
      'src',
      '/uploads/a.jpg',
    )
    expect(screen.getByText(/UGX 450,000/)).toBeInTheDocument()
    expect(screen.getByText(/kansanga, kampala · near kansanga miracle centre/i)).toBeInTheDocument()
    expect(screen.getByText('Clean room with water and power included.')).toBeInTheDocument()
    expect(screen.getByText('Andrew K')).toBeInTheDocument()

    // Paywall invariant, client side: no number, no wa.me link before a reveal.
    expect(screen.getByRole('button', { name: /reveal whatsapp contact/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /whatsapp owner/i })).not.toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain('+2567')
  })

  it('registers a first-time tenant, then reveals the WhatsApp button (flag-off UX)', async () => {
    mockApi({
      'GET /api/listings/7': { body: LISTING },
      'POST /api/tenants/register': { body: { token: 'tok-1', phone: '+256700111222' } },
      'POST /api/listings/7/contact': {
        body: { whatsapp_phone: '+256771234567', credits_remaining: 0 },
      },
    })
    const user = userEvent.setup()
    render(<ListingDetail id="7" navigate={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: /reveal whatsapp contact/i }))
    await user.type(await screen.findByLabelText('Phone number'), '0700111222')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    const button = await screen.findByRole('link', { name: 'WhatsApp Owner' })
    expect(button).toHaveAttribute(
      'href',
      `https://wa.me/256771234567?text=${EXPECTED_WA_MESSAGE}`,
    )
    expect(button).toHaveAttribute('target', '_blank')

    const registerCall = fetch.mock.calls.find(([url]) => url === '/api/tenants/register')
    expect(JSON.parse(registerCall[1].body)).toEqual({ phone: '0700111222' })
    const contactCall = fetch.mock.calls.find(([url]) => url === '/api/listings/7/contact')
    expect(contactCall[1].headers.Authorization).toBe('Bearer tok-1')
  })

  it('reveals straight away for a returning tenant without re-registering', async () => {
    saveTenant('tok-9', '+256700111222')
    mockApi({
      'GET /api/listings/7': { body: LISTING },
      'GET /api/tenants/me': {
        body: {
          phone: '+256700111222',
          credits_remaining: 0,
          reveals_count: 2,
          paywall_enabled: false,
        },
      },
      'POST /api/listings/7/contact': {
        body: { whatsapp_phone: '+256771234567', credits_remaining: 0 },
      },
    })
    const user = userEvent.setup()
    render(<ListingDetail id="7" navigate={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: /reveal whatsapp contact/i }))
    expect(await screen.findByRole('link', { name: 'WhatsApp Owner' })).toBeInTheDocument()
    // Flag off: no payment UI, no credits badge — feels like today plus one tap.
    expect(screen.queryByText(/reveals left/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/transaction id/i)).not.toBeInTheDocument()
  })

  it('shows the payment screen on 402 and pending verification after claiming', async () => {
    saveTenant('tok-2', '+256700111222')
    mockApi({
      'GET /api/listings/7': { body: LISTING },
      'GET /api/tenants/me': {
        body: {
          phone: '+256700111222',
          credits_remaining: 0,
          reveals_count: 20,
          paywall_enabled: true,
        },
      },
      'POST /api/listings/7/contact': {
        status: 402,
        body: {
          detail: {
            category: 'rental',
            tier: 'standard',
            product: 'standard_rental',
            credits_remaining: 0,
            price_ugx: 5000,
            credits_per_purchase: 20,
            momo_number: '0779999999',
            momo_name: 'Andrew K',
            payment_instructions: 'Send UGX 5,000 by Mobile Money to 0779999999 (Andrew K).',
            pending_claim: false,
            pass_status: 'none',
          },
        },
      },
      'POST /api/tenants/payment-claims': {
        status: 201,
        body: { id: 1, momo_tx_id: '74211539062', status: 'pending', created_at: '2026-07-13' },
      },
    })
    const user = userEvent.setup()
    render(<ListingDetail id="7" navigate={vi.fn()} />)

    // Credits badge is live because the paywall is on.
    expect(await screen.findByText('0 reveals left')).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: /reveal whatsapp contact/i }))

    expect(await screen.findByText('0779999999')).toBeInTheDocument()
    expect(screen.getByText(/andrew k · mobile money/i)).toBeInTheDocument()
    expect(screen.getByText(/20 contact reveals for UGX 5,000/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /whatsapp owner/i })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/mobile money transaction id/i), '74211539062')
    await user.click(screen.getByRole('button', { name: /submit transaction id/i }))

    expect(await screen.findByText(/pending verification/i)).toBeInTheDocument()
    const claimCall = fetch.mock.calls.find(([url]) => url === '/api/tenants/payment-claims')
    expect(JSON.parse(claimCall[1].body)).toEqual({
      momo_tx_id: '74211539062',
      product: 'standard_rental',
    })
    expect(claimCall[1].headers.Authorization).toBe('Bearer tok-2')
  })

  it('shows a not-available message when the listing 404s (missing or not approved)', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ detail: 'Listing not found' }, 404))
    render(<ListingDetail id="99" navigate={vi.fn()} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/no longer available/i)
    expect(screen.queryByRole('button', { name: /reveal whatsapp contact/i })).not.toBeInTheDocument()
  })
})

describe('whatsappLink', () => {
  it('strips the + from the phone and URL-encodes the message', () => {
    const url = whatsappLink({ ...LISTING, whatsapp_phone: '+256771234567' })
    expect(url.startsWith('https://wa.me/256771234567?text=')).toBe(true)
    const message = decodeURIComponent(url.split('?text=')[1])
    expect(message).toContain('"Self-contained room in Kansanga"')
    expect(message).toContain('Kansanga, Kampala')
  })
})
