import { useRef } from 'react'
import { MAX_PHOTOS } from '../lib/validation.js'

export default function PhotoPicker({ photos, busy, error, onAdd, onRemove }) {
  const inputRef = useRef(null)

  function handleChange(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = '' // allow re-selecting the same file after removal
    if (files.length > 0) onAdd(files)
  }

  const full = photos.length >= MAX_PHOTOS

  return (
    <fieldset className="field photo-field">
      <legend>
        Photos <span className="hint">1–{MAX_PHOTOS} photos · we compress them for you</span>
      </legend>
      <div className="photo-grid">
        {photos.map((photo) => (
          <div key={photo.id} className="photo-thumb">
            <img src={photo.previewUrl} alt={photo.name} />
            <button
              type="button"
              className="photo-remove"
              aria-label={`Remove ${photo.name}`}
              onClick={() => onRemove(photo.id)}
            >
              ×
            </button>
          </div>
        ))}
        {!full && (
          <label className={`photo-add ${busy ? 'is-busy' : ''}`}>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              disabled={busy}
              onChange={handleChange}
            />
            <span aria-hidden="true" className="photo-add-icon">
              {busy ? '…' : '+'}
            </span>
            {busy ? 'Preparing…' : 'Add photos'}
          </label>
        )}
      </div>
      {error && <p className="field-error">{error}</p>}
    </fieldset>
  )
}
