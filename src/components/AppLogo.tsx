import type { ImgHTMLAttributes } from 'react'

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> & {
  variant?: 'header' | 'auth' | 'hero'
}

export function AppLogo({ variant = 'header', className = '', ...rest }: Props) {
  return (
    <img
      src="/vault-logo.png"
      alt="Vault"
      className={`app-logo app-logo--${variant} ${className}`.trim()}
      decoding="async"
      {...rest}
    />
  )
}
