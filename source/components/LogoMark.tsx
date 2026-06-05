/**
 * Neutral placeholder logo mark for the kit. Uses `currentColor` so it inherits
 * whatever text color you apply (e.g. `text-accent`). Swap this for your own
 * brand logo — the auth shell only depends on the `size` + `className` props.
 */
export function LogoMark({
  size = 40,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect x="2" y="2" width="20" height="20" rx="6" fill="currentColor" opacity="0.12" />
      <path
        d="M7 16 L12 7 L17 16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="9.2"
        y1="13.2"
        x2="14.8"
        y2="13.2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

export default LogoMark
