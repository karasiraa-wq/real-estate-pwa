import Logo from './Logo.jsx'

/**
 * "RentUg Land" section identity: same brand and logo, its own earthy accent
 * (see .land-theme in styles.css). Shown on the land feed and land detail
 * pages — there is no separate app, manifest or domain.
 */
export default function LandBanner() {
  return (
    <div className="land-banner">
      <Logo size={34} tone="land" className="land-banner-logo" />
      <div>
        <p className="land-banner-name">
          RentUg <strong>Land</strong>
        </p>
        <p className="land-banner-tag">Plots and land for sale, reviewed before they go live</p>
      </div>
    </div>
  )
}
