import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FeedPage from '../components/FeedPage.jsx'
import ListingDetail from '../components/ListingDetail.jsx'
import ListingForm from '../components/ListingForm.jsx'
import { clearTenant } from '../lib/tenant.js'
import { youtubeId } from '../lib/video.js'

// Leaflet never loads in jsdom; the map sections must still render their
// privacy notes and directions links without it.
vi.mock('../lib/leaflet.js', () => ({
  loadLeaflet: vi.fn(() => new Promise(() => {})),
  KAMPALA: [0.3476, 32.5825],
  pinIcon: vi.fn(),
  osmLayer: vi.fn(),
  directionsUrl: (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
}))

vi.mock('../lib/compressImage.js', () => ({
  compressImage: vi.fn(async () => new Blob(['compressed'], { type: 'image/jpeg' })),
}))

const LAND_CARD = {
  id: 9,
  title: '50x100 titled plot in Gayaza',
  category: 'land',
  district: 'Wakiso',
  area: 'Gayaza',
  rent_ugx: null,
  asking_price_ugx: 35000000,
  plot_size: '50x100',
  tenure: 'mailo',
  title_status: 'has_title',
  photo_url: '/uploads/plot.jpg',
}

const LAND_DETAIL = {
  ...LAND_CARD,
  landmark: null,
  description: 'Quarter-acre plot with a private mailo title, ready to transfer.',
  landlord_name: 'Andrew K',
  created_at: '2026-07-10T10:00:00Z',
  video_url: 'https://youtu.be/dQw4w9WgXcQ',
  public_latitude: 0.4602,
  public_longitude: 32.6417,
  location_approximate: false,
  photo_urls: ['/uploads/plot.jpg'],
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

beforeEach(() => {
  global.fetch = vi.fn()
  localStorage.clear()
  clearTenant()
})

describe('land feed', () => {
  it('queries the land category and renders land cards with plot fields', async () => {
    fetch.mockResolvedValueOnce(jsonResponse([LAND_CARD]))
    render(<FeedPage navigate={vi.fn()} category="land" />)

    const card = (await screen.findAllByRole('link'))[0]
    expect(fetch.mock.calls[0][0]).toBe('/api/listings?category=land')

    // Asking price, not rent — and no "/month".
    expect(within(card).getByText('UGX 35,000,000')).toBeInTheDocument()
    expect(within(card).queryByText(/\/month/)).not.toBeInTheDocument()
    expect(within(card).getByText('50x100')).toBeInTheDocument()
    expect(within(card).getByText('Mailo')).toBeInTheDocument()
    expect(within(card).getByText('Has title')).toBeInTheDocument()

    // Honesty constraint: reviewed, never "verified".
    expect(within(card).getByText('Listing reviewed by RentUg')).toBeInTheDocument()
    expect(within(card).queryByText(/✓ Verified/)).not.toBeInTheDocument()

    // RentUg Land section identity.
    expect(screen.getByText('Plots and land for sale, reviewed before they go live')).toBeInTheDocument()
  })

  it('keeps the default feed on rentals and switches category via the tabs', async () => {
    fetch.mockResolvedValue(jsonResponse([]))
    const navigate = vi.fn()
    const user = userEvent.setup()
    render(<FeedPage navigate={navigate} />)

    await screen.findByText(/no listings match/i)
    expect(fetch.mock.calls[0][0]).toBe('/api/listings')

    await user.click(screen.getByRole('button', { name: 'Land' }))
    expect(navigate).toHaveBeenCalledWith('/land')
  })

  it('hides rental-only filters on the land feed', async () => {
    fetch.mockResolvedValueOnce(jsonResponse([]))
    render(<FeedPage navigate={vi.fn()} category="land" />)
    await screen.findByText(/no land listings match/i)
    expect(screen.queryByLabelText('Property type')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Rent range')).not.toBeInTheDocument()
  })
})

describe('land detail', () => {
  it('shows seller-attributed title claims and the reviewed badge — never "verified"', async () => {
    fetch.mockResolvedValueOnce(jsonResponse(LAND_DETAIL))
    render(<ListingDetail id="9" navigate={vi.fn()} />)

    await screen.findByRole('heading', { name: LAND_DETAIL.title })
    expect(screen.getByText('UGX 35,000,000')).toBeInTheDocument()
    expect(screen.queryByText(/\/month/)).not.toBeInTheDocument()

    // Title claims belong to the seller, prominently displayed.
    const claim = screen.getByText(/seller states:/i).closest('.land-title-box')
    expect(within(claim).getByText('Mailo')).toBeInTheDocument()
    expect(within(claim).getByText('Has title')).toBeInTheDocument()
    expect(screen.getByText(/always verify the title at the land registry/i)).toBeInTheDocument()

    // RentUg reviews listings; it does not verify land titles.
    expect(screen.getByText('Listing reviewed by RentUg')).toBeInTheDocument()
    expect(screen.queryByText(/verified by rentug/i)).not.toBeInTheDocument()

    // Land coordinates are public: directions available without any reveal.
    expect(screen.getByRole('link', { name: /get directions/i })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/dir/?api=1&destination=0.4602,32.6417',
    )
  })

  it('plays the YouTube video only after a tap (lite embed)', async () => {
    fetch.mockResolvedValueOnce(jsonResponse(LAND_DETAIL))
    const user = userEvent.setup()
    render(<ListingDetail id="9" navigate={vi.fn()} />)

    const poster = await screen.findByRole('button', { name: /play video tour/i })
    // Poster only: no iframe yet, just YouTube's thumbnail.
    expect(document.querySelector('iframe')).toBeNull()
    expect(poster.querySelector('img')).toHaveAttribute(
      'src',
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    )

    await user.click(poster)
    const iframe = document.querySelector('iframe')
    expect(iframe.src).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ')
  })

  it('shows an approximate-area note for rentals and no directions before a reveal', async () => {
    fetch.mockResolvedValueOnce(
      jsonResponse({
        ...LAND_DETAIL,
        id: 7,
        category: 'rental',
        property_type: 'self_contained',
        rent_ugx: 450000,
        asking_price_ugx: null,
        plot_size: null,
        tenure: null,
        title_status: null,
        video_url: null,
        location_approximate: true,
      }),
    )
    render(<ListingDetail id="7" navigate={vi.fn()} />)

    await screen.findByRole('heading', { name: LAND_DETAIL.title })
    expect(screen.getByText(/approximate area/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /get directions/i })).not.toBeInTheDocument()
  })

  it('renders no map section when a listing has no coordinates', async () => {
    fetch.mockResolvedValueOnce(
      jsonResponse({
        ...LAND_DETAIL,
        public_latitude: null,
        public_longitude: null,
        video_url: null,
      }),
    )
    render(<ListingDetail id="9" navigate={vi.fn()} />)
    await screen.findByRole('heading', { name: LAND_DETAIL.title })
    expect(screen.queryByTestId('map-canvas')).not.toBeInTheDocument()
    expect(screen.queryByText(/location/i)).not.toBeInTheDocument()
  })
})

describe('land submission form', () => {
  it('switches to land fields and submits the land payload', async () => {
    fetch
      .mockResolvedValueOnce(
        jsonResponse(
          { id: 51, status: 'pending', message: 'Under review.', photo_token: 't' },
          201,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ photo_url: '/uploads/p.jpg', photo_count: 1 }, 201))
    const user = userEvent.setup()
    render(<ListingForm />)

    // First question: what are you listing?
    await user.click(screen.getByRole('radio', { name: /land/i }))

    // Rental-only fields are gone; land fields are in.
    expect(screen.queryByLabelText('Property type')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/monthly rent/i)).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Listing title'), '50x100 titled plot in Gayaza')
    await user.type(screen.getByLabelText('Plot size'), '50x100')
    await user.selectOptions(screen.getByLabelText('Tenure'), 'mailo')
    await user.selectOptions(screen.getByLabelText('Title status'), 'has_title')
    await user.type(screen.getByLabelText('District'), 'Wakiso')
    await user.type(screen.getByLabelText('Area / Neighborhood'), 'Gayaza')
    await user.type(screen.getByLabelText(/asking price/i), '35000000')
    await user.type(
      screen.getByLabelText('Description'),
      'Quarter-acre plot with a private mailo title.',
    )
    const photo = new File(['photo-bytes'], 'plot.jpg', { type: 'image/jpeg' })
    await user.upload(screen.getByLabelText(/add photos/i), photo)
    await user.type(
      screen.getByLabelText(/video link/i),
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    )
    await user.type(screen.getByLabelText('Your name'), 'Andrew K')
    await user.type(screen.getByLabelText('WhatsApp number'), '0772345678')
    await user.click(screen.getByRole('button', { name: /submit for review/i }))

    await screen.findByRole('heading', { name: /your listing is under review/i })
    const payload = JSON.parse(fetch.mock.calls[0][1].body)
    expect(payload).toMatchObject({
      category: 'land',
      plot_size: '50x100',
      tenure: 'mailo',
      title_status: 'has_title',
      asking_price_ugx: 35000000,
      video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      latitude: null,
      longitude: null,
    })
    expect(payload.rent_ugx).toBeUndefined()
    expect(payload.property_type).toBeUndefined()
  })

  it('requires the land fields before calling the API', async () => {
    const user = userEvent.setup()
    render(<ListingForm />)
    await user.click(screen.getByRole('radio', { name: /land/i }))
    await user.click(screen.getByRole('button', { name: /submit for review/i }))

    expect(screen.getByText(/enter the plot size/i)).toBeInTheDocument()
    expect(screen.getByText(/choose the land tenure/i)).toBeInTheDocument()
    expect(screen.getByText(/choose the title status/i)).toBeInTheDocument()
    expect(screen.getByText(/asking price in UGX/i)).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a non-YouTube video link inline', async () => {
    const user = userEvent.setup()
    render(<ListingForm />)
    await user.type(screen.getByLabelText(/video link/i), 'https://vimeo.com/12345')
    await user.click(screen.getByRole('button', { name: /submit for review/i }))
    expect(screen.getByText(/paste a youtube link/i)).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('youtube helper', () => {
  it('extracts ids from watch, short and youtu.be URLs and rejects the rest', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youtubeId('https://youtu.be/dQw4w9WgXcQ?t=30')).toBe('dQw4w9WgXcQ')
    expect(youtubeId('https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=1s')).toBe('dQw4w9WgXcQ')
    expect(youtubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youtubeId('https://vimeo.com/12345678')).toBeNull()
    expect(youtubeId('http://youtube.com.evil.example/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(youtubeId(null)).toBeNull()
  })
})
