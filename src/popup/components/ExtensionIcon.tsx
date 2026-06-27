interface ExtensionIconProps {
  className?: string
}

export function ExtensionIcon({ className }: ExtensionIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden
      className={className}
    >
      <rect x="2" y="3" width="44" height="42" rx="6" fill="#F91212" />
      <path d="M20 11v12l10-6-10-6Z" fill="#fff" />
      <path
        d="M13.5 29.5c0-1.2 4.2-2.2 10.5-1.2s10.5 0 10.5 1.2v6.8c-2.8-1.1-6.8-1.4-10.5-1.2-3.7-.2-7.7.1-10.5 1.2v-6.8Z"
        fill="#fff"
      />
      <rect x="23.2" y="28.3" width="1.6" height="8.2" fill="#F91212" />
    </svg>
  )
}
