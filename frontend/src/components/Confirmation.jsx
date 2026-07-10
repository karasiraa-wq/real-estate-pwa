export default function Confirmation({ result, onReset }) {
  return (
    <section className="card confirmation" aria-live="polite">
      <div className="confirmation-check" aria-hidden="true">
        ✓
      </div>
      <h2>Your listing is under review</h2>
      <p>{result.message}</p>
      {result.failedPhotos > 0 && (
        <p className="confirmation-warning">
          {result.failedPhotos} photo{result.failedPhotos > 1 ? 's' : ''} could not be
          uploaded. Your listing was still received and will be reviewed.
        </p>
      )}
      <p className="confirmation-meta">Reference number: #{result.id}</p>
      <div className="confirmation-next">
        <h3>What happens next?</h3>
        <ol>
          <li>Our team verifies your listing details.</li>
          <li>Once approved, it goes live for tenants to see.</li>
          <li>Tenants contact you directly on WhatsApp.</li>
        </ol>
      </div>
      <button type="button" className="btn-secondary" onClick={onReset}>
        Submit another listing
      </button>
    </section>
  )
}
