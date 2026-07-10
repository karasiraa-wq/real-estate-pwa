import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ListingDetail from '../components/ListingDetail.jsx'
import { whatsappLink } from '../lib/whatsapp.js'

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
  whatsapp_phone: '+256771234567',
  created_at: '2026-07-09T10:00:00Z',
  photo_url: '/uploads/a.jpg',
  photo_urls: ['/uploads/a.jpg', '/uploads/b.jpg'],
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

beforeEach(() => {
  global.fetch = vi.fn()
})

describe('listing detail', () => {
  it('shows the gallery, description, location, rent and landlord name', async () => {
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
    expect(screen.getByAltText('Photo 2 of 2 — Self-contained room in Kansanga')).toHaveAttribute(
      'src',
      '/uploads/b.jpg',
    )
    expect(screen.getByText(/UGX 450,000/)).toBeInTheDocument()
    expect(screen.getByText(/kansanga, kampala · near kansanga miracle centre/i)).toBeInTheDocument()
    expect(screen.getByText('Clean room with water and power included.')).toBeInTheDocument()
    expect(screen.getByText('Andrew K')).toBeInTheDocument()
  })

  it('WhatsApp Owner button opens wa.me with a pre-filled message naming the listing and location', async () => {
    fetch.mockResolvedValueOnce(jsonResponse(LISTING))
    render(<ListingDetail id="7" navigate={vi.fn()} />)

    const button = await screen.findByRole('link', { name: 'WhatsApp Owner' })
    const expectedMessage = encodeURIComponent(
      'Hello Andrew K, I found your listing "Self-contained room in Kansanga" ' +
        'in Kansanga, Kampala on RentUg. Is it still available?',
    )
    expect(button).toHaveAttribute('href', `https://wa.me/256771234567?text=${expectedMessage}`)
    expect(button).toHaveAttribute('target', '_blank')
  })

  it('shows a not-available message when the listing 404s (missing or not approved)', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ detail: 'Listing not found' }, 404))
    render(<ListingDetail id="99" navigate={vi.fn()} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/no longer available/i)
    expect(screen.queryByRole('link', { name: 'WhatsApp Owner' })).not.toBeInTheDocument()
  })
})

describe('whatsappLink', () => {
  it('strips the + from the phone and URL-encodes the message', () => {
    const url = whatsappLink(LISTING)
    expect(url.startsWith('https://wa.me/256771234567?text=')).toBe(true)
    const message = decodeURIComponent(url.split('?text=')[1])
    expect(message).toContain('"Self-contained room in Kansanga"')
    expect(message).toContain('Kansanga, Kampala')
  })
})
