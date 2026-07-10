// Client-side mirror of the server's Pydantic rules (backend/app/schemas.py).
// The server remains the authority; this exists for instant inline feedback.

export const PROPERTY_TYPES = [
  { value: 'single_room', label: 'Single room' },
  { value: 'self_contained', label: 'Self-contained' },
  { value: 'apartment', label: 'Apartment' },
  { value: 'house', label: 'House' },
]

// Ugandan mobile numbers: 07XXXXXXXX or +2567XXXXXXXX.
export const UG_PHONE = /^(?:\+?256|0)7\d{8}$/

export const MAX_PHOTOS = 8

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

export function validateListing(values, photoCount) {
  const errors = {}
  for (const name of [
    'title',
    'property_type',
    'district',
    'area',
    'rent_ugx',
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

export function formatUGX(value) {
  const n = Number(String(value).replace(/[,\s]/g, ''))
  if (!Number.isFinite(n) || n <= 0) return null
  return `UGX ${n.toLocaleString('en-UG')}`
}
