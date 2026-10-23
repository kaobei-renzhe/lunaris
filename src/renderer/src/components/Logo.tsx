interface LogoProps {
  size?: number
  className?: string
}

/** 月巢的品牌标：银色月牙 + 巢形弧线 + 三颗素材蛋 */
export default function Logo({ size = 28, className = '' }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      className={className}
      aria-label="月巢"
      role="img"
    >
      <defs>
        <linearGradient id="mn-logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#111a2b" />
          <stop offset="1" stopColor="#0b0f18" />
        </linearGradient>
        <linearGradient id="mn-logo-moon" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#b8cdf5" />
        </linearGradient>
        <linearGradient id="mn-logo-nest" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#7aa2f7" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
        <mask id="mn-logo-cut">
          <rect width="512" height="512" fill="#fff" />
          <circle cx="252" cy="150" r="108" fill="#000" />
        </mask>
      </defs>
      <rect width="512" height="512" rx="120" fill="url(#mn-logo-bg)" />
      <circle cx="256" cy="120" r="220" fill="#7aa2f7" opacity="0.08" />
      <circle cx="196" cy="186" r="118" fill="url(#mn-logo-moon)" mask="url(#mn-logo-cut)" />
      <path
        d="M92 318 C136 424 376 424 420 318"
        fill="none"
        stroke="url(#mn-logo-nest)"
        strokeWidth="38"
        strokeLinecap="round"
      />
      <path
        d="M132 360 C176 436 336 436 380 360"
        fill="none"
        stroke="#5b7fd0"
        strokeWidth="30"
        strokeLinecap="round"
        opacity="0.75"
      />
      <circle cx="190" cy="330" r="24" fill="#f2c94c" />
      <circle cx="256" cy="352" r="26" fill="#7aa2f7" />
      <circle cx="322" cy="330" r="24" fill="#e86a92" />
    </svg>
  )
}
