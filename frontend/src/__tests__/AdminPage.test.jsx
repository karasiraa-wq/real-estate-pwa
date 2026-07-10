import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminPage from '../components/AdminPage.jsx'

const PENDING = [
  {
    id: 1,
    title: 'Self-contained room in Kansanga',
    property_type: 'self_contained',
    district: 'Kampala',
    area: 'Kansanga',
    landmark: 'Near Kansanga Miracle Centre',
    rent_ugx: 450000,
    description: 'Clean room with water and power.',
    landlord_name: 'Andrew K',
    whatsapp_phone: '+256771234567',
    created_at: '2026-07-09T10:00:00Z',
    status: 'pending',
    rejection_reason: null,
    reviewed_at: null,
    photo_urls: ['/uploads/abc.jpg'],
    photo_url: '/uploads/abc.jpg',
  },
  {
    id: 2,
    title: 'Two bedroom apartment in Ntinda',
    property_type: 'apartment',
    district: 'Kampala',
    area: 'Ntinda',
    landmark: null,
    rent_ugx: 1200000,
    description: 'Spacious apartment with parking.',
    landlord_name: 'Grace N',
    whatsapp_phone: '+256701234567',
    created_at: '2026-07-10T08:00:00Z',
    status: 'pending',
    rejection_reason: null,
    reviewed_at: null,
    photo_urls: [],
    photo_url: null,
  },
]

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

async function signIn(user, queue = PENDING) {
  fetch.mockResolvedValueOnce(jsonResponse(queue)) // login check
  fetch.mockResolvedValueOnce(jsonResponse(queue)) // queue load
  render(<AdminPage />)
  await user.type(screen.getByLabelText('Admin password'), 'secret-token')
  await user.click(screen.getByRole('button', { name: /sign in/i }))
  await screen.findByRole('heading', { name: /pending listings/i })
}

beforeEach(() => {
  global.fetch = vi.fn()
  sessionStorage.clear()
})

describe('admin login', () => {
  it('rejects a wrong password and never shows the queue', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ detail: 'Invalid admin credentials' }, 401))
    const user = userEvent.setup()
    render(<AdminPage />)

    await user.type(screen.getByLabelText('Admin password'), 'wrong')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid admin credentials/i)
    expect(screen.queryByRole('heading', { name: /pending listings/i })).not.toBeInTheDocument()
    expect(sessionStorage.getItem('rentug_admin_token')).toBeNull()
  })

  it('signs in with a valid token and sends it as X-Admin-Token', async () => {
    const user = userEvent.setup()
    await signIn(user)

    expect(fetch.mock.calls[0][0]).toBe('/api/admin/listings')
    expect(fetch.mock.calls[0][1].headers['X-Admin-Token']).toBe('secret-token')
    expect(sessionStorage.getItem('rentug_admin_token')).toBe('secret-token')
  })
})

describe('review queue', () => {
  it('shows every pending listing with its details and photos', async () => {
    const user = userEvent.setup()
    await signIn(user)

    expect(screen.getByText(/pending listings/i)).toHaveTextContent('2')

    const card = screen.getByRole('article', { name: /self-contained room in kansanga/i })
    expect(within(card).getByText(/UGX 450,000/)).toBeInTheDocument()
    expect(within(card).getByText(/kansanga, kampala/i)).toBeInTheDocument()
    expect(within(card).getByText(/near kansanga miracle centre/i)).toBeInTheDocument()
    expect(within(card).getByText(/andrew k/i)).toBeInTheDocument()
    expect(within(card).getByText(/\+256771234567/)).toBeInTheDocument()
    expect(within(card).getByAltText(/photo of self-contained room/i)).toHaveAttribute(
      'src',
      '/uploads/abc.jpg',
    )

    const noPhotos = screen.getByRole('article', { name: /two bedroom apartment/i })
    expect(within(noPhotos).getByText(/no photos uploaded/i)).toBeInTheDocument()
  })

  it('shows an empty state when there is nothing to review', async () => {
    const user = userEvent.setup()
    await signIn(user, [])
    expect(screen.getByText(/no pending listings/i)).toBeInTheDocument()
  })

  it('approves a listing and removes it from the queue', async () => {
    const user = userEvent.setup()
    await signIn(user)

    fetch.mockResolvedValueOnce(jsonResponse({ ...PENDING[0], status: 'approved' }))
    const card = screen.getByRole('article', { name: /self-contained room in kansanga/i })
    await user.click(within(card).getByRole('button', { name: /^approve$/i }))

    await waitFor(() =>
      expect(
        screen.queryByRole('article', { name: /self-contained room in kansanga/i }),
      ).not.toBeInTheDocument(),
    )
    const approveCall = fetch.mock.calls.at(-1)
    expect(approveCall[0]).toBe('/api/admin/listings/1/approve')
    expect(approveCall[1].method).toBe('POST')
    expect(approveCall[1].headers['X-Admin-Token']).toBe('secret-token')
    // The other listing is still awaiting review.
    expect(screen.getByRole('article', { name: /two bedroom apartment/i })).toBeInTheDocument()
  })

  it('rejects a listing with a private reason', async () => {
    const user = userEvent.setup()
    await signIn(user)

    const card = screen.getByRole('article', { name: /two bedroom apartment/i })
    await user.click(within(card).getByRole('button', { name: /^reject$/i }))
    await user.type(
      within(card).getByLabelText(/rejection reason/i),
      'Photos do not match the description',
    )
    fetch.mockResolvedValueOnce(jsonResponse({ ...PENDING[1], status: 'rejected' }))
    await user.click(within(card).getByRole('button', { name: /confirm reject/i }))

    await waitFor(() =>
      expect(
        screen.queryByRole('article', { name: /two bedroom apartment/i }),
      ).not.toBeInTheDocument(),
    )
    const rejectCall = fetch.mock.calls.at(-1)
    expect(rejectCall[0]).toBe('/api/admin/listings/2/reject')
    expect(JSON.parse(rejectCall[1].body)).toEqual({
      reason: 'Photos do not match the description',
    })
  })

  it('keeps the card and shows an error when an action fails', async () => {
    const user = userEvent.setup()
    await signIn(user)

    fetch.mockResolvedValueOnce(jsonResponse({ detail: 'boom' }, 500))
    const card = screen.getByRole('article', { name: /self-contained room in kansanga/i })
    await user.click(within(card).getByRole('button', { name: /^approve$/i }))

    expect(await within(card).findByRole('alert')).toHaveTextContent(/boom/i)
    expect(
      screen.getByRole('article', { name: /self-contained room in kansanga/i }),
    ).toBeInTheDocument()
  })

  it('returns to the login screen when the token expires mid-session', async () => {
    const user = userEvent.setup()
    await signIn(user)

    fetch.mockResolvedValueOnce(jsonResponse({ detail: 'Invalid admin credentials' }, 401))
    await user.click(
      within(screen.getByRole('article', { name: /self-contained/i })).getByRole('button', {
        name: /^approve$/i,
      }),
    )

    expect(await screen.findByLabelText('Admin password')).toBeInTheDocument()
    expect(sessionStorage.getItem('rentug_admin_token')).toBeNull()
  })
})
