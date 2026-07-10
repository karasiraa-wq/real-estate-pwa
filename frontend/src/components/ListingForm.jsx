import { useRef, useState } from 'react'
import { submitListing, uploadPhoto } from '../api.js'
import { compressImage } from '../lib/compressImage.js'
import {
  MAX_PHOTOS,
  PROPERTY_TYPES,
  formatUGX,
  validateListing,
} from '../lib/validation.js'
import Confirmation from './Confirmation.jsx'
import PhotoPicker from './PhotoPicker.jsx'

const EMPTY = {
  title: '',
  property_type: '',
  district: '',
  area: '',
  landmark: '',
  rent_ugx: '',
  description: '',
  landlord_name: '',
  whatsapp_phone: '',
}

export default function ListingForm() {
  const [values, setValues] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [photos, setPhotos] = useState([])
  const [preparingPhotos, setPreparingPhotos] = useState(false)
  const [phase, setPhase] = useState('editing') // editing | submitting | done
  const [progress, setProgress] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [result, setResult] = useState(null)
  const nextPhotoId = useRef(1)

  function setValue(name, value) {
    setValues((v) => ({ ...v, [name]: value }))
    setErrors((e) => (e[name] ? { ...e, [name]: null } : e))
  }

  async function addPhotos(files) {
    setErrors((e) => ({ ...e, photos: null }))
    setPreparingPhotos(true)
    const prepared = []
    let failed = 0
    for (const file of files.slice(0, MAX_PHOTOS - photos.length)) {
      try {
        const blob = await compressImage(file)
        prepared.push({
          id: nextPhotoId.current++,
          name: file.name,
          blob,
          previewUrl: URL.createObjectURL(blob),
        })
      } catch {
        failed += 1
      }
    }
    setPhotos((p) => [...p, ...prepared])
    if (failed > 0) {
      setErrors((e) => ({
        ...e,
        photos: `${failed} file${failed > 1 ? 's' : ''} could not be read as an image`,
      }))
    }
    setPreparingPhotos(false)
  }

  function removePhoto(id) {
    setPhotos((p) => {
      const photo = p.find((x) => x.id === id)
      if (photo) URL.revokeObjectURL(photo.previewUrl)
      return p.filter((x) => x.id !== id)
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitError('')
    const found = validateListing(values, photos.length)
    if (Object.keys(found).some((k) => found[k])) {
      setErrors(found)
      return
    }

    setPhase('submitting')
    setProgress('Submitting your listing…')
    try {
      const submission = await submitListing({
        title: values.title.trim(),
        property_type: values.property_type,
        district: values.district.trim(),
        area: values.area.trim(),
        landmark: values.landmark.trim() || null,
        rent_ugx: Number(String(values.rent_ugx).replace(/[,\s]/g, '')),
        description: values.description.trim(),
        landlord_name: values.landlord_name.trim(),
        whatsapp_phone: values.whatsapp_phone.replace(/[\s-]/g, ''),
      })

      let failedPhotos = 0
      for (let i = 0; i < photos.length; i++) {
        setProgress(`Uploading photo ${i + 1} of ${photos.length}…`)
        try {
          await uploadPhoto(submission.id, submission.photo_token, photos[i].blob)
        } catch {
          // One retry per photo: mobile networks here drop requests routinely.
          try {
            await uploadPhoto(submission.id, submission.photo_token, photos[i].blob)
          } catch {
            failedPhotos += 1
          }
        }
      }

      setResult({ id: submission.id, message: submission.message, failedPhotos })
      setPhase('done')
    } catch (error) {
      if (error.fieldErrors && Object.keys(error.fieldErrors).length > 0) {
        setErrors(error.fieldErrors)
      }
      setSubmitError(error.message)
      setPhase('editing')
    }
  }

  function reset() {
    photos.forEach((p) => URL.revokeObjectURL(p.previewUrl))
    setValues(EMPTY)
    setErrors({})
    setPhotos([])
    setResult(null)
    setSubmitError('')
    setPhase('editing')
  }

  if (phase === 'done') return <Confirmation result={result} onReset={reset} />

  const submitting = phase === 'submitting'
  const rentPreview = formatUGX(values.rent_ugx)

  return (
    <form className="card listing-form" onSubmit={handleSubmit} noValidate>
      <h2>List your property</h2>
      <p className="form-intro">
        Free to list. We verify every listing before tenants see it — usually within
        24 hours.
      </p>

      <Field label="Listing title" name="title" error={errors.title}>
        <input
          id="title"
          type="text"
          maxLength={120}
          placeholder="e.g. Self-contained room in Kansanga"
          value={values.title}
          onChange={(e) => setValue('title', e.target.value)}
        />
      </Field>

      <Field label="Property type" name="property_type" error={errors.property_type}>
        <select
          id="property_type"
          value={values.property_type}
          onChange={(e) => setValue('property_type', e.target.value)}
        >
          <option value="">Select type…</option>
          {PROPERTY_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>

      <div className="field-row">
        <Field label="District" name="district" error={errors.district}>
          <input
            id="district"
            type="text"
            placeholder="e.g. Kampala"
            value={values.district}
            onChange={(e) => setValue('district', e.target.value)}
          />
        </Field>
        <Field label="Area / Neighborhood" name="area" error={errors.area}>
          <input
            id="area"
            type="text"
            placeholder="e.g. Kansanga"
            value={values.area}
            onChange={(e) => setValue('area', e.target.value)}
          />
        </Field>
      </div>

      <Field label="Nearby landmark (optional)" name="landmark" error={errors.landmark}>
        <input
          id="landmark"
          type="text"
          placeholder="e.g. Near Kansanga Miracle Centre"
          value={values.landmark}
          onChange={(e) => setValue('landmark', e.target.value)}
        />
      </Field>

      <Field
        label="Monthly rent (UGX)"
        name="rent_ugx"
        error={errors.rent_ugx}
        hint={rentPreview ? `${rentPreview} per month` : null}
      >
        <input
          id="rent_ugx"
          type="text"
          inputMode="numeric"
          placeholder="e.g. 450000"
          value={values.rent_ugx}
          onChange={(e) => setValue('rent_ugx', e.target.value)}
        />
      </Field>

      <Field label="Description" name="description" error={errors.description}>
        <textarea
          id="description"
          rows={4}
          maxLength={5000}
          placeholder="Describe the property: rooms, water, power, access road…"
          value={values.description}
          onChange={(e) => setValue('description', e.target.value)}
        />
      </Field>

      <PhotoPicker
        photos={photos}
        busy={preparingPhotos}
        error={errors.photos}
        onAdd={addPhotos}
        onRemove={removePhoto}
      />

      <h3 className="section-heading">Your contact details</h3>
      <p className="form-intro">Tenants will contact you directly on WhatsApp.</p>

      <Field label="Your name" name="landlord_name" error={errors.landlord_name}>
        <input
          id="landlord_name"
          type="text"
          autoComplete="name"
          placeholder="e.g. Andrew K"
          value={values.landlord_name}
          onChange={(e) => setValue('landlord_name', e.target.value)}
        />
      </Field>

      <Field label="WhatsApp number" name="whatsapp_phone" error={errors.whatsapp_phone}>
        <input
          id="whatsapp_phone"
          type="tel"
          autoComplete="tel"
          placeholder="e.g. 0771234567"
          value={values.whatsapp_phone}
          onChange={(e) => setValue('whatsapp_phone', e.target.value)}
        />
      </Field>

      {submitError && (
        <p className="submit-error" role="alert">
          {submitError}
        </p>
      )}

      <button type="submit" className="btn-primary" disabled={submitting || preparingPhotos}>
        {submitting ? progress : 'Submit for review'}
      </button>
      <p className="form-footnote">
        Your listing will not be public until it has been verified.
      </p>
    </form>
  )
}

function Field({ label, name, error, hint, children }) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      {children}
      {hint && !error && <p className="field-hint">{hint}</p>}
      {error && (
        <p className="field-error" id={`${name}-error`}>
          {error}
        </p>
      )}
    </div>
  )
}
