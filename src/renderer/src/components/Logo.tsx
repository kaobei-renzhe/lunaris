interface LogoProps {
  size?: number
  className?: string
}

/** 月相的品牌标：紫罗兰星云里的一弯银月 */
export default function Logo({ size = 28, className = '' }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      className={className}
      aria-label="月相"
      role="img"
    >
      <defs>
        <linearGradient id="lu-logo-bg" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#1D1640" />
          <stop offset="0.5" stopColor="#110D24" />
          <stop offset="1" stopColor="#07050F" />
        </linearGradient>
        <radialGradient id="lu-logo-neb1" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#7B5CE8" stopOpacity="0.42" />
          <stop offset="1" stopColor="#7B5CE8" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="lu-logo-neb2" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#E85CA8" stopOpacity="0.26" />
          <stop offset="1" stopColor="#E85CA8" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="lu-logo-moon" x1="0.05" y1="0.05" x2="0.9" y2="0.95">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.45" stopColor="#F2ECFF" />
          <stop offset="1" stopColor="#C0B2E8" />
        </linearGradient>
        <mask id="lu-logo-cut">
          <rect width="512" height="512" fill="#fff" />
          <circle cx="309.7" cy="196.1" r="138" fill="#000" />
        </mask>
      </defs>
      <rect width="512" height="512" rx="118" fill="url(#lu-logo-bg)" />
      <circle cx="180" cy="200" r="230" fill="url(#lu-logo-neb1)" />
      <circle cx="392" cy="356" r="210" fill="url(#lu-logo-neb2)" />
      <circle
        cx="250"
        cy="258"
        r="190"
        fill="none"
        stroke="#C9B8FF"
        strokeOpacity="0.15"
        strokeWidth="1.6"
      />
      <circle cx="250" cy="258" r="152" fill="url(#lu-logo-moon)" mask="url(#lu-logo-cut)" />
      <g fill="#FFFFFF">
        <circle cx="352" cy="152" r="4" fillOpacity="0.85" />
        <circle cx="398" cy="196" r="2.6" fillOpacity="0.55" />
        <circle cx="330" cy="212" r="2.2" fillOpacity="0.42" />
        <circle cx="416" cy="148" r="2" fillOpacity="0.32" />
      </g>
      <circle cx="376" cy="240" r="2.6" fill="#F5B8D8" fillOpacity="0.6" />
      <circle cx="424" cy="216" r="2" fill="#B8D8F5" fillOpacity="0.55" />
    </svg>
  )
}
