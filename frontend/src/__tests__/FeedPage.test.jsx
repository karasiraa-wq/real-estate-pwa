import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FeedPage from '../components/FeedPage.jsx'

// What the public endpoint returns: approved listings only, newest first.
const APPROVED = [
  {
    id: 3,
    title: 'Two bedroom apartment in Ntinda',
    property_type: 'apartment',
    district: 'Kampala',
    area: 'Ntinda',
    rent_ugx: 1200000,
    photo_url: '/uploads/b.jpg',
  },
  {
    id: 1,
    title: 'Self-contained room in Kansanga',
    property_type: 'self_contained',
    district: 'Kampala',
    area: 'Kansanga',
    rent_ugx: 450000,
    photo_url: null,
  },
]

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

beforeEach(() => {
  global.fetch = vi.fn()
})

describe('tenant feed', () => {
  it('shows skeletons, then only the listings the approved-only endpoint returns', async () => {
    fetch.mockResolvedValueOnce(jsonResponse(APPROVED))
    render(<FeedPage navigate={vi.fn()} />)

    expect(screen.getByTestId('feed-skeleton')).toBeInTheDocument()

    const cards = await screen.findAllByRole('link')
    // The feed's only data source is the public endpoint, which the backend
    // restricts to approved listings — no client-side path can widen that.
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe('/api/listings')

    expect(cards).toHaveLength(APPROVED.length)
    // Server order (newest first) is preserved.
    expect(cards[0]).toHaveAccessibleName('Two bedroom apartment in Ntinda — Ntinda, Kampala')
    expect(cards[1]).toHaveAccessibleName('Self-contained room in Kansanga — Kansanga, Kampala')

    // Photo-forward card: photo, title, location, rent in UGX.
    expect(within(cards[0]).getByRole('img')).toHaveAttribute('src', '/uploads/b.jpg')
    expect(within(cards[0]).getByText(/UGX 1,200,000/)).toBeInTheDocument()
    expect(within(cards[0]).getByText(/Ntinda, Kampala · Apartment/)).toBeInTheDocument()
    expect(within(cards[1]).getByText(/UGX 450,000/)).toBeInTheDocument()
    expect(screen.queryByTestId('feed-skeleton')).not.toBeInTheDocument()
  })

  it('searches by location text', async () => {
    fetch.mockResolvedValueOnce(jsonResponse(APPROVED))
    const user = userEvent.setup()
    render(<FeedPage navigate={vi.fn()} />)
    await screen.findAllByRole('link')

    fetch.mockResolvedValueOnce(jsonResponse([APPROVED[0]]))
    await user.type(screen.getByLabelText('Search by location'), 'Ntinda')

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(fetch.mock.calls[1][0]).toBe('/api/listings?q=Ntinda')
    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(1))
    expect(screen.queryByText(/kansanga/i)).not.toBeInTheDocument()
  })

  it('filters by property type and rent range', async () => {
    fetch.mockResolvedValue(jsonResponse(APPROVED))
    const user = userEvent.setup()
    render(<FeedPage navigate={vi.fn()} />)
    await screen.findAllByRole('link')

    await user.selectOptions(screen.getByLabelText('Property type'), 'apartment')
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(fetch.mock.calls[1][0]).toBe('/api/listings?property_type=apartment')

    await user.selectOptions(screen.getByLabelText('Rent range'), '500k_1m')
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    expect(fetch.mock.calls[2][0]).toBe(
      '/api/listings?property_type=apartment&min_rent=500000&max_rent=1000000',
    )
  })

  it('shows an empty state when nothing matches', async () => {
    fetch.mockResolvedValueOnce(jsonResponse([]))
    render(<FeedPage navigate={vi.fn()} />)
    expect(await screen.findByText(/no listings match/i)).toBeInTheDocument()
  })

  it('shows an error with retry when the feed cannot load', async () => {
    fetch.mockRejectedValueOnce(new TypeError('network down'))
    const user = userEvent.setup()
    render(<FeedPage navigate={vi.fn()} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach the server/i)

    fetch.mockResolvedValueOnce(jsonResponse(APPROVED))
    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findAllByRole('link')).toHaveLength(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('navigates to the listing detail page when a card is tapped', async () => {
    fetch.mockResolvedValueOnce(jsonResponse(APPROVED))
    const navigate = vi.fn()
    const user = userEvent.setup()
    render(<FeedPage navigate={navigate} />)

    await user.click((await screen.findAllByRole('link'))[0])
    expect(navigate).toHaveBeenCalledWith('/listing/3')
  })
})
