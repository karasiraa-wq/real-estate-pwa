/**
 * Small marks for the Rental/Land choice, in the logo's visual language:
 * filled rounded shapes, brand gradient, white detail. Rental is the logo's
 * house in rentals green; land is a map pin in the RentUg Land earth tones.
 * Each keeps its identity color regardless of the surrounding theme.
 */
export default function CategoryMark({ kind = 'rental', size = 30 }) {
  const land = kind === 'land'
  const id = land ? 'cm-land' : 'cm-rental'
  const stops = land ? ['#dfa554', '#8a5a1f'] : ['#35e07c', '#149a4d']
  return (
    <svg
      className="category-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={stops[0]} />
          <stop offset="1" stopColor={stops[1]} />
        </linearGradient>
      </defs>
      {land ? (
        <>
          <path
            d="M16 2.5A10.5 10.5 0 0 0 5.5 13c0 7.7 9 15.7 9.4 16a1.6 1.6 0 0 0 2.2 0c.4-.3 9.4-8.3 9.4-16A10.5 10.5 0 0 0 16 2.5Z"
            fill={`url(#${id})`}
          />
          <circle cx="16" cy="13" r="4.2" fill="#fff" />
        </>
      ) : (
        <>
          <path
            d="M16 3.5 3.9 14.1c-.9.8-.3 2.2.8 2.2h2.5v9.9A2.8 2.8 0 0 0 10 29h12a2.8 2.8 0 0 0 2.8-2.8v-9.9h2.5c1.1 0 1.7-1.4.8-2.2L16 3.5Z"
            fill={`url(#${id})`}
          />
          <rect x="13.1" y="19.6" width="5.8" height="9.4" rx="1.1" fill="#fff" />
        </>
      )}
    </svg>
  )
}
