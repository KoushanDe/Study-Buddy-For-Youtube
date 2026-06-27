const HINT_ID = 'study-buddy-for-youtube-playlist-hint'

function isDarkMode(): boolean {
  return (
    document.documentElement.hasAttribute('dark') ||
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

export function mountPlaylistHint(): () => void {
  unmountPlaylistHint()

  const dark = isDarkMode()
  const host = document.createElement('div')
  host.id = HINT_ID
  host.style.cssText =
    'position:fixed;top:72px;right:24px;z-index:9998;pointer-events:auto;max-width:320px;'

  const card = document.createElement('div')
  card.style.cssText = [
    'padding:14px 16px',
    'border-radius:12px',
    `border:1px solid ${dark ? '#3f3f3f' : '#e5e5e5'}`,
    `background:${dark ? '#212121' : '#ffffff'}`,
    `color:${dark ? '#f1f1f1' : '#0f0f0f'}`,
    'box-shadow:0 4px 16px rgba(0,0,0,0.24)',
    "font-family:'Roboto',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    'font-size:13px',
    'line-height:1.45',
  ].join(';')

  const row = document.createElement('div')
  row.style.cssText = 'display:flex;align-items:flex-start;gap:12px;'

  const text = document.createElement('p')
  text.style.cssText = 'margin:0;flex:1;'
  text.textContent =
    'Open the Study Buddy for YouTube extension menu and click "Show playlist duration" to see total watch time.'

  const close = document.createElement('button')
  close.type = 'button'
  close.setAttribute('aria-label', 'Dismiss')
  close.textContent = '×'
  close.style.cssText = [
    'border:none',
    'background:transparent',
    `color:${dark ? '#aaa' : '#606060'}`,
    'font-size:20px',
    'line-height:1',
    'padding:0',
    'cursor:pointer',
    'flex-shrink:0',
  ].join(';')
  close.addEventListener('click', () => unmountPlaylistHint())

  row.appendChild(text)
  row.appendChild(close)
  card.appendChild(row)
  host.appendChild(card)
  document.body.appendChild(host)

  return unmountPlaylistHint
}

export function unmountPlaylistHint(): void {
  document.getElementById(HINT_ID)?.remove()
}
