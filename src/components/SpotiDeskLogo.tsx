interface SpotiDeskLogoProps {
  size?: number;
  className?: string;
}

/**
 * Custom architectural monochrome emblem for SpotiDesk:
 * Precision outer acoustic ring + three tapered soundwave arcs.
 */
export function SpotiDeskLogo({ size = 24, className = "" }: SpotiDeskLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect
        x="1.5"
        y="1.5"
        width="29"
        height="29"
        rx="8.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeOpacity="0.28"
      />
      <path
        d="M8.5 11.4C13.3 9.7 19.2 10.1 23.5 12.2"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      <path
        d="M9.8 16.2C13.9 14.9 18.6 15.2 22.1 17"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeOpacity="0.82"
      />
      <path
        d="M11.3 20.8C14.5 19.8 18 20.1 20.6 21.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeOpacity="0.58"
      />
    </svg>
  );
}
