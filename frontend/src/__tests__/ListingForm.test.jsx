import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ListingForm from '../components/ListingForm.jsx'

// Canvas is unavailable in jsdom; compression is exercised manually in a browser.
vi.mock('../lib/compressImage.js', () => ({
  compressImage: vi.fn(async () => new Blob(['compressed'], { type: 'image/jpeg' })),
}))

const VALID_INPUT = {
  'Listing title': 'Self-contained room in Kansanga',
  District: 'Kampala',
  'Area / Neighborhood': 'Kansanga',
  'Monthly rent (UGX)': '450000',
  Description: 'Clean room with water and power, close to the main road.',
  'Your name': 'Andrew K',
  'WhatsApp number': '0771234567',
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

async function fillValidForm(user) {
  for (const [label, value] of Object.entries(VALID_INPUT)) {
    await user.type(screen.getByLabelText(label), value)
  }
  await user.selectOptions(screen.getByLabelText('Property type'), 'single_room')
  const photo = new File(['photo-bytes'], 'house.jpg', { type: 'image/jpeg' })
  await user.upload(screen.getByLabelText(/add photos/i), photo)
}

beforeEach(() => {
  global.fetch = vi.fn()
})

describe('validation', () => {
  it('shows inline errors and does not call the API when the form is empty', async () => {
    const user = userEvent.setup()
    render(<ListingForm />)

    await user.click(screen.getByRole('button', { name: /submit for review/i }))

    expect(screen.getByText(/title must be at least 5 characters/i)).toBeInTheDocument()
    expect(screen.getByText(/choose a property type/i)).toBeInTheDocument()
    expect(screen.getByText(/enter the district/i)).toBeInTheDocument()
    expect(screen.getByText(/monthly rent in UGX/i)).toBeInTheDocument()
    expect(screen.getByText(/add at least 1 photo/i)).toBeInTheDocument()
    expect(screen.getByText(/ugandan mobile number/i)).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a non-Ugandan phone number inline', async () => {
    const user = userEvent.setup()
    render(<ListingForm />)

    await user.type(screen.getByLabelText('WhatsApp number'), '12345')
    await user.click(screen.getByRole('button', { name: /submit for review/i }))

    expect(
      screen.getByText(/enter a ugandan mobile number, e\.g\. 0771234567/i),
    ).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('clears a field error once the field is edited', async () => {
    const user = userEvent.setup()
    render(<ListingForm />)

    await user.click(screen.getByRole('button', { name: /submit for review/i }))
    expect(screen.getByText(/title must be at least 5 characters/i)).toBeInTheDocument()

    await user.type(screen.getByLabelText('Listing title'), 'Nice room in Ntinda')
    expect(screen.queryByText(/title must be at least 5 characters/i)).not.toBeInTheDocument()
  })
})

describe('successful submission', () => {
  it('submits the listing, uploads photos with the token, and shows confirmation', async () => {
    fetch
      .mockResolvedValueOnce(
        jsonResponse(
          {
            id: 42,
            status: 'pending',
            message: 'Your listing is under review. It will go live once verified.',
            photo_token: 'secret-token',
          },
          201,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({ photo_url: '/uploads/abc.jpg', photo_count: 1 }, 201),
      )

    const user = userEvent.setup()
    render(<ListingForm />)
    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /submit for review/i }))

    expect(
      await screen.findByRole('heading', { name: /your listing is under review/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/go live once verified/i)).toBeInTheDocument()
    expect(screen.getByText(/#42/)).toBeInTheDocument()

    // First call: the listing submission with normalized values.
    const [url, options] = fetch.mock.calls[0]
    expect(url).toBe('/api/listings')
    const payload = JSON.parse(options.body)
    expect(payload).toMatchObject({
      title: 'Self-contained room in Kansanga',
      property_type: 'single_room',
      district: 'Kampala',
      area: 'Kansanga',
      landmark: null,
      rent_ugx: 450000,
      landlord_name: 'Andrew K',
      whatsapp_phone: '0771234567',
    })

    // Second call: the compressed photo, gated by the submission's photo token.
    const [photoUrl, photoOptions] = fetch.mock.calls[1]
    expect(photoUrl).toBe('/api/listings/42/photos')
    expect(photoOptions.headers['X-Photo-Token']).toBe('secret-token')
    expect(photoOptions.body).toBeInstanceOf(FormData)
  })
})

describe('API errors', () => {
  it('shows an error message and keeps the form when the server fails', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ detail: 'boom' }, 500))

    const user = userEvent.setup()
    render(<ListingForm />)
    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /submit for review/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/boom/i)
    // Still on the form, nothing lost.
    expect(screen.getByRole('button', { name: /submit for review/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Listing title')).toHaveValue(
      'Self-contained room in Kansanga',
    )
  })

  it('shows the rate-limit message on 429', async () => {
    fetch.mockResolvedValueOnce(
      jsonResponse(
        { detail: 'Too many submissions from this device. Please try again later.' },
        429,
      ),
    )

    const user = userEvent.setup()
    render(<ListingForm />)
    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /submit for review/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many submissions/i)
  })

  it('shows a connection message when the network drops', async () => {
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const user = userEvent.setup()
    render(<ListingForm />)
    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /submit for review/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach the server/i)
  })

  it('maps server-side 422 validation errors onto fields', async () => {
    fetch.mockResolvedValueOnce(
      jsonResponse(
        {
          detail: [
            {
              loc: ['body', 'whatsapp_phone'],
              msg: 'Value error, must be a Ugandan mobile number, e.g. 0771234567 or +256771234567',
            },
          ],
        },
        422,
      ),
    )

    const user = userEvent.setup()
    render(<ListingForm />)
    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /submit for review/i }))

    await waitFor(() =>
      expect(
        screen.getByText(/must be a ugandan mobile number/i),
      ).toBeInTheDocument(),
    )
  })

  it('still confirms the listing when a photo upload fails after retry', async () => {
    fetch
      .mockResolvedValueOnce(
        jsonResponse(
          { id: 7, status: 'pending', message: 'Under review.', photo_token: 't' },
          201,
        ),
      )
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const user = userEvent.setup()
    render(<ListingForm />)
    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: /submit for review/i }))

    expect(
      await screen.findByRole('heading', { name: /your listing is under review/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/1 photo could not be uploaded/i)).toBeInTheDocument()
  })
})
