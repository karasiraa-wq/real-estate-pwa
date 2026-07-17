/**
 * The RentUg mark: a chat bubble (we connect people) wrapped around a house
 * (what they talk about). Inline SVG so it ships in the JS bundle, scales
 * crisply at any size, and can be retinted by the land theme via
 * currentColor-free gradients selected with the `tone` prop.
 */
export default function Logo({ size = 44, tone = 'green', className = '' }) {
  const id = tone === 'land' ? 'rentug-mark-land' : 'rentug-mark-green'
  const stops =
    tone === 'land'
      ? ['#dfa554', '#8a5a1f']
      : ['#35e07c', '#149a4d']
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={stops[0]} />
          <stop offset="1" stopColor={stops[1]} />
        </linearGradient>
      </defs>
      {/* Chat bubble with a tail toward the sender (bottom left) */}
      <path
        d="M32 3C16.8 3 4.5 14 4.5 27.5c0 7.4 3.7 14 9.5 18.5V57a3 3 0 0 0 4.9 2.3l8.6-7c1.5.2 2.9.2 4.5.2 15.2 0 27.5-11 27.5-24.5S47.2 3 32 3Z"
        fill={`url(#${id})`}
      />
      {/* House: roof, walls, door */}
      <path
        d="M32 14.5 17.5 27.2c-.9.8-.3 2.3.9 2.3h2.7v10.6a2.4 2.4 0 0 0 2.4 2.4h17a2.4 2.4 0 0 0 2.4-2.4V29.5h2.7c1.2 0 1.8-1.5.9-2.3L32 14.5Z"
        fill="#fff"
      />
      <rect x="28.6" y="32.4" width="6.8" height="10.1" rx="1.2" fill={`url(#${id})`} />
    </svg>
  )
}
