// Client-side mirror of the server's Pydantic rules (backend/app/schemas.py).
// The server remains the authority; this exists for instant inline feedback.

export const PROPERTY_TYPES = [
  { value: 'single_room', label: 'Single room' },
  { value: 'self_contained', label: 'Self-contained' },
  { value: 'apartment', label: 'Apartment' },
  { value: 'house', label: 'House' },
]

export const TENURES = [
  { value: 'freehold', label: 'Freehold' },
  { value: 'mailo', label: 'Mailo' },
  { value: 'leasehold', label: 'Leasehold' },
  { value: 'customary', label: 'Customary' },
]

export const TITLE_STATUSES = [
  { value: 'has_title', label: 'Has title' },
  { value: 'no_title', label: 'No title' },
  { value: 'processing', label: 'Title processing' },
]

// Uganda's bounding box — the server rejects anything outside it.
export const UGANDA_BOUNDS = { latMin: -1.6, latMax: 4.3, lngMin: 29.5, lngMax: 35.1 }

// Ugandan mobile numbers: 07XXXXXXXX or +2567XXXXXXXX.
export const UG_PHONE = /^(?:\+?256|0)7\d{8}$/

export const MAX_PHOTOS = 8

// Mirrors the server's YouTube-only rule (backend/app/schemas.py YOUTUBE_URL).
export const YOUTUBE_URL =
  /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[?&#][^\s]*)?$/

export function validateField(name, value) {
  const v = typeof value === 'string' ? value.trim() : value
  switch (name) {
    case 'title':
      if (v.length < 5) return 'Title must be at least 5 characters'
      if (v.length > 120) return 'Title must be at most 120 characters'
      return null
    case 'property_type':
      return v ? null : 'Choose a property type'
    case 'district':
      if (v.length < 2) return 'Enter the district, e.g. Kampala'
      return null
    case 'area':
      if (v.length < 2) return 'Enter the area or neighborhood, e.g. Kansanga'
      return null
    case 'rent_ugx': {
      const n = Number(String(v).replace(/[,\s]/g, ''))
      if (!Number.isInteger(n) || n <= 0) return 'Enter the monthly rent in UGX'
      if (n > 100_000_000) return 'Rent cannot exceed UGX 100,000,000'
      return null
    }
    case 'asking_price_ugx': {
      const n = Number(String(v).replace(/[,\s]/g, ''))
      if (!Number.isInteger(n) || n <= 0) return 'Enter the asking price in UGX'
      return null
    }
    case 'plot_size':
      if (v.length < 2) return 'Enter the plot size, e.g. 50x100'
      return null
    case 'tenure':
      return v ? null : 'Choose the land tenure'
    case 'title_status':
      return v ? null : 'Choose the title status'
    case 'video_url':
      if (!v) return null // optional
      if (!YOUTUBE_URL.test(v))
        return 'Paste a YouTube link, e.g. https://youtu.be/abc123def45'
      return null
    case 'description':
      if (v.length < 10) return 'Describe the property in at least 10 characters'
      return null
    case 'landlord_name':
      if (v.length < 2) return 'Enter your name'
      return null
    case 'whatsapp_phone':
      if (!UG_PHONE.test(String(v).replace(/[\s-]/g, '')))
        return 'Enter a Ugandan mobile number, e.g. 0771234567'
      return null
    default:
      return null
  }
}

const RENTAL_FIELDS = ['property_type', 'rent_ugx']
const LAND_FIELDS = ['plot_size', 'tenure', 'title_status', 'asking_price_ugx']

export function validateListing(values, photoCount) {
  const errors = {}
  const perCategory = values.category === 'land' ? LAND_FIELDS : RENTAL_FIELDS
  for (const name of [
    'title',
    ...perCategory,
    'district',
    'area',
    'video_url',
    'description',
    'landlord_name',
    'whatsapp_phone',
  ]) {
    const error = validateField(name, values[name] ?? '')
    if (error) errors[name] = error
  }
  if (photoCount < 1) errors.photos = 'Add at least 1 photo of the property'
  if (photoCount > MAX_PHOTOS) errors.photos = `You can add at most ${MAX_PHOTOS} photos`
  return errors
}

export function tenureLabel(value) {
  return TENURES.find((t) => t.value === value)?.label ?? value
}

export function titleStatusLabel(value) {
  return TITLE_STATUSES.find((t) => t.value === value)?.label ?? value
}

export function propertyTypeLabel(value) {
  return PROPERTY_TYPES.find((t) => t.value === value)?.label ?? value
}

export function formatUGX(value) {
  const n = Number(String(value).replace(/[,\s]/g, ''))
  if (!Number.isFinite(n) || n <= 0) return null
  return `UGX ${n.toLocaleString('en-UG')}`
}
