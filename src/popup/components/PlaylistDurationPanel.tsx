import type { PlaylistDurationResult } from '../../shared/types/playlist'

interface PlaylistDurationPanelProps {
  result: PlaylistDurationResult | null
  loading: boolean
  failed: boolean
}

function formatVideoCount(count: number, hiddenCount: number | null): string {
  const base = count === 1 ? '1 video' : `${count} videos`
  if (hiddenCount && hiddenCount > 0) {
    const hidden = hiddenCount === 1 ? '1 hidden' : `${hiddenCount} hidden`
    return `${base} · ${hidden}`
  }
  return base
}

export function PlaylistDurationPanel({ result, loading, failed }: PlaylistDurationPanelProps) {
  if (failed) {
    return (
      <div className="text-sm text-[var(--yn-muted)]">
        Couldn&apos;t load this playlist. Refresh the page and try again.
      </div>
    )
  }

  if (loading || !result) {
    return <div className="text-sm text-[var(--yn-muted)]">Refresh to load</div>
  }

  const title = result.title ?? 'Untitled playlist'
  const displayCount = result.availableCount ?? result.totalCount ?? result.loadedCount
  const metaParts = [
    result.owner,
    formatVideoCount(displayCount, result.hiddenCount),
  ].filter(Boolean)

  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-semibold leading-snug">{title}</div>
        {metaParts.length > 0 ? (
          <div className="mt-1 text-xs text-[var(--yn-muted)]">{metaParts.join(' · ')}</div>
        ) : null}
      </div>

      <div className="space-y-2 border-t border-[var(--yn-border)] pt-3">
        {result.speeds.map((speed) => (
          <div className="flex items-center justify-between text-sm" key={speed.speed}>
            <span className="text-[var(--yn-muted)]">{speed.label}</span>
            <span className="font-medium tabular-nums">{speed.formatted}</span>
          </div>
        ))}
      </div>

      {result.isScanning &&
        result.loadedCount > 0 &&
        displayCount > result.loadedCount && (
          <div className="text-xs text-[var(--yn-muted)]">
            {result.loadedCount} of {displayCount} counted
          </div>
        )}
    </div>
  )
}
