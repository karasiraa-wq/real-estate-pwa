import { useRef, useState } from 'react'
import { submitListing, uploadPhoto } from '../api.js'
import { compressImage } from '../lib/compressImage.js'
import {
  MAX_PHOTOS,
  PROPERTY_TYPES,
  TENURES,
  TITLE_STATUSES,
  formatUGX,
  validateListing,
} from '../lib/validation.js'
import CategoryMark from './CategoryMark.jsx'
import Confirmation from './Confirmation.jsx'
import MapPicker from './MapPicker.jsx'
import PhotoPicker from './PhotoPicker.jsx'

const EMPTY = {
  category: 'rental',
  title: '',
  property_type: '',
  district: '',
  area: '',
  landmark: '',
  rent_ugx: '',
  plot_size: '',
  tenure: '',
  title_status: '',
  asking_price_ugx: '',
  video_url: '',
  description: '',
  landlord_name: '',
  whatsapp_phone: '',
}

export default function ListingForm() {
  const [values, setValues] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [photos, setPhotos] = useState([])
  const [pin, setPin] = useState(null) // { latitude, longitude } | null
  const [preparingPhotos, setPreparingPhotos] = useState(false)
  const [phase, setPhase] = useState('editing') // editing | submitting | done
  const [progress, setProgress] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [result, setResult] = useState(null)
  const nextPhotoId = useRef(1)

  const isLand = values.category === 'land'

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
      const common = {
        category: values.category,
        title: values.title.trim(),
        district: values.district.trim(),
        area: values.area.trim(),
        landmark: values.landmark.trim() || null,
        video_url: values.video_url.trim() || null,
        latitude: pin ? pin.latitude : null,
        longitude: pin ? pin.longitude : null,
        description: values.description.trim(),
        landlord_name: values.landlord_name.trim(),
        whatsapp_phone: values.whatsapp_phone.replace(/[\s-]/g, ''),
      }
      const submission = await submitListing(
        isLand
          ? {
              ...common,
              plot_size: values.plot_size.trim(),
              tenure: values.tenure,
              title_status: values.title_status,
              asking_price_ugx: Number(String(values.asking_price_ugx).replace(/[,\s]/g, '')),
            }
          : {
              ...common,
              property_type: values.property_type,
              rent_ugx: Number(String(values.rent_ugx).replace(/[,\s]/g, '')),
            }
      )

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
    setPin(null)
    setResult(null)
    setSubmitError('')
    setPhase('editing')
  }

  if (phase === 'done') return <Confirmation result={result} onReset={reset} />

  const submitting = phase === 'submitting'
  const rentPreview = formatUGX(values.rent_ugx)
  const pricePreview = formatUGX(values.asking_price_ugx)

  // Section completeness for the progress strip: purely visual encouragement,
  // validation stays with validateListing on submit.
  const filled = (v) => String(v ?? '').trim() !== ''
  const steps = [
    {
      label: 'Details',
      done:
        filled(values.title) &&
        filled(values.description) &&
        (isLand
          ? filled(values.plot_size) &&
            filled(values.tenure) &&
            filled(values.title_status) &&
            filled(values.asking_price_ugx)
          : filled(values.property_type) && filled(values.rent_ugx)),
    },
    { label: 'Location', done: filled(values.district) && filled(values.area) },
    { label: 'Photos', done: photos.length > 0 },
    { label: 'Contact', done: filled(values.landlord_name) && filled(values.whatsapp_phone) },
  ]

  return (
    <form
      className={isLand ? 'listing-form land-theme' : 'listing-form'}
      onSubmit={handleSubmit}
      noValidate
    >
      <header className="form-hero">
        <h2>{isLand ? 'List your land' : 'List your property'}</h2>
        <p className="form-intro">
          Free to list. We verify every listing before tenants see it — usually within
          24 hours.
        </p>
      </header>

      <ol className="form-progress" aria-label="Form sections">
        {steps.map((step, i) => (
          <li key={step.label} className={step.done ? 'progress-step done' : 'progress-step'}>
            <span className="step-dot" aria-hidden="true">
              {step.done ? '✓' : i + 1}
            </span>
            <span className="step-label">{step.label}</span>
          </li>
        ))}
      </ol>

      <section className="card form-section">
        <h3 className="form-section-title">
          <span className="step-chip">1</span>Property details
        </h3>

        <fieldset className="field category-choice">
          <legend>What are you listing?</legend>
          <div className="category-options">
            <label className={!isLand ? 'category-option selected' : 'category-option'}>
              <input
                type="radio"
                name="category"
                value="rental"
                checked={!isLand}
                onChange={() => setValue('category', 'rental')}
              />
              <CategoryMark kind="rental" />
              <span className="category-text">
                <span className="category-name">Rental</span>
                <span className="category-sub">Rooms, apartments, houses</span>
              </span>
            </label>
            <label className={isLand ? 'category-option selected' : 'category-option'}>
              <input
                type="radio"
                name="category"
                value="land"
                checked={isLand}
                onChange={() => setValue('category', 'land')}
              />
              <CategoryMark kind="land" />
              <span className="category-text">
                <span className="category-name">Land</span>
                <span className="category-sub">Plots for sale</span>
              </span>
            </label>
          </div>
        </fieldset>

        <Field label="Listing title" name="title" error={errors.title}>
        <input
          id="title"
          type="text"
          maxLength={120}
          placeholder={
            isLand ? 'e.g. 50x100 titled plot in Gayaza' : 'e.g. Self-contained room in Kansanga'
          }
          value={values.title}
          onChange={(e) => setValue('title', e.target.value)}
        />
      </Field>

      {!isLand && (
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
      )}

      {isLand && (
        <>
          <div className="field-row">
            <Field label="Plot size" name="plot_size" error={errors.plot_size}>
              <input
                id="plot_size"
                type="text"
                maxLength={40}
                placeholder="e.g. 50x100"
                value={values.plot_size}
                onChange={(e) => setValue('plot_size', e.target.value)}
              />
            </Field>
            <Field label="Tenure" name="tenure" error={errors.tenure}>
              <select
                id="tenure"
                value={values.tenure}
                onChange={(e) => setValue('tenure', e.target.value)}
              >
                <option value="">Select tenure…</option>
                {TENURES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field
            label="Title status"
            name="title_status"
            error={errors.title_status}
            hint="Buyers will see this as stated by you, the seller."
          >
            <select
              id="title_status"
              value={values.title_status}
              onChange={(e) => setValue('title_status', e.target.value)}
            >
              <option value="">Select title status…</option>
              {TITLE_STATUSES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}

      {isLand ? (
        <Field
          label="Asking price (UGX)"
          name="asking_price_ugx"
          error={errors.asking_price_ugx}
          hint={pricePreview ? `${pricePreview} asking price` : null}
        >
          <input
            id="asking_price_ugx"
            type="text"
            inputMode="numeric"
            placeholder="e.g. 35000000"
            value={values.asking_price_ugx}
            onChange={(e) => setValue('asking_price_ugx', e.target.value)}
          />
        </Field>
      ) : (
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
      )}

      <Field label="Description" name="description" error={errors.description}>
        <textarea
          id="description"
          rows={4}
          maxLength={5000}
          placeholder={
            isLand
              ? 'Describe the plot: access road, neighborhood, utilities, boundaries…'
              : 'Describe the property: rooms, water, power, access road…'
          }
          value={values.description}
          onChange={(e) => setValue('description', e.target.value)}
        />
      </Field>
      </section>

      <section className="card form-section">
        <h3 className="form-section-title">
          <span className="step-chip">2</span>Location
        </h3>
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
        <MapPicker value={pin} onChange={setPin} error={errors.latitude || errors.longitude} />
      </section>

      <section className="card form-section">
        <h3 className="form-section-title">
          <span className="step-chip">3</span>Photos &amp; video
        </h3>
      <PhotoPicker
        photos={photos}
        busy={preparingPhotos}
        error={errors.photos}
        onAdd={addPhotos}
        onRemove={removePhoto}
      />

      <Field
        label="Video link (YouTube, optional)"
        name="video_url"
        error={errors.video_url}
        hint="Upload your video to YouTube and paste the link here"
      >
        <input
          id="video_url"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder="https://youtu.be/…"
          value={values.video_url}
          onChange={(e) => setValue('video_url', e.target.value)}
        />
      </Field>
      </section>

      <section className="card form-section">
        <h3 className="form-section-title">
          <span className="step-chip">4</span>Contact
        </h3>
        <p className="form-section-hint">
          {isLand
            ? 'Buyers will contact you directly on WhatsApp.'
            : 'Tenants will contact you directly on WhatsApp.'}
        </p>

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
      </section>

      <div className="form-submit">
        {submitError && (
          <p className="submit-error" role="alert">
            {submitError}
          </p>
        )}
        <button type="submit" className="btn-primary" disabled={submitting || preparingPhotos}>
          {submitting ? progress : 'Submit for review'}
        </button>
        {submitting && <div className="submit-progress" aria-hidden="true" />}
        <p className="form-footnote">
          Your listing will not be public until it has been verified.
        </p>
      </div>
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
