type GlitchubLogoProps = {
  className?: string
  size?: number
  alt?: string
}

export function GlitchubLogo({
  className,
  size = 28,
  alt = 'Glitchub',
}: GlitchubLogoProps) {
  return (
    <img
      className={className}
      src="/logo.svg"
      alt={alt}
      width={size}
      height={size}
      decoding="async"
      draggable={false}
    />
  )
}
