import { getPlaylistId } from '../../shared/utils/youtube-url'
import { debounce } from '../../shared/utils/debounce'
import {
  findPlaylistContainer,
  getPlaylistItems,
  getPlaylistScrollContainer,
  isPlaylistScrollAtBottom,
  scrapeVisiblePlaylistVideos,
} from '../../services/playlist-duration/playlist-duration.service'
import { getPlaylistMetadata } from '../../services/playlist-duration/playlist-metadata'
import { calculateSpeedDurations } from '../../services/playlist-duration/duration-calculator'
import type { PlaylistDurationResult } from '../../shared/types/playlist'
import { hasPlaylistContent } from '../../shared/utils/playlist-details'
import {
  getAvailableVideoCount,
  inferHiddenCount,
  isPlaylistScanComplete,
} from '../../shared/utils/playlist-counts'

type ResultCallback = (result: PlaylistDurationResult) => void

const POLL_MS = 2000

export class PlaylistObserver {
  private mutationObserver: MutationObserver | null = null
  private intersectionObserver: IntersectionObserver | null = null
  private waitObserver: MutationObserver | null = null
  private seenVideoIds = new Map<string, number>()
  private playlistId: string
  private onUpdate: ResultCallback
  private scrollContainer: HTMLElement | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private isAttached = false
  private debouncedScan: (() => void) | null = null
  private lastLoadedCount = 0
  private stablePolls = 0

  constructor(playlistId: string, onUpdate: ResultCallback) {
    this.playlistId = playlistId
    this.onUpdate = onUpdate
  }

  start(): void {
    this.waitForContainer()

    this.pollTimer = setInterval(() => {
      if (!this.isAttached) {
        const container = findPlaylistContainer()
        if (container) {
          this.attach(container)
        } else {
          this.tryPublishMetadataOnly()
        }
        return
      }
      this.scan()
    }, POLL_MS)
  }

  stop(): void {
    this.mutationObserver?.disconnect()
    this.intersectionObserver?.disconnect()
    this.waitObserver?.disconnect()
    if (this.scrollContainer && this.debouncedScan) {
      this.scrollContainer.removeEventListener('scroll', this.debouncedScan)
    }
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.mutationObserver = null
    this.intersectionObserver = null
    this.waitObserver = null
    this.pollTimer = null
    this.seenVideoIds.clear()
    this.lastLoadedCount = 0
    this.stablePolls = 0
  }

  private waitForContainer(): void {
    const container = findPlaylistContainer()
    if (container) {
      this.attach(container)
      return
    }

    this.waitObserver = new MutationObserver(() => {
      const found = findPlaylistContainer()
      if (found) {
        this.waitObserver?.disconnect()
        this.attach(found)
      }
    })

    this.waitObserver.observe(document.body, { childList: true, subtree: true })
  }

  private attach(container: Element): void {
    if (this.isAttached) return
    this.isAttached = true
    this.scrollContainer = getPlaylistScrollContainer()
    this.scan()

    this.debouncedScan = debounce(() => this.scan(), 300)
    this.mutationObserver = new MutationObserver(() => this.debouncedScan?.())
    this.mutationObserver.observe(container, { childList: true, subtree: true })

    if (this.scrollContainer && this.debouncedScan) {
      this.scrollContainer.addEventListener('scroll', this.debouncedScan, { passive: true })
    }

    this.setupIntersectionObserver()
  }

  private setupIntersectionObserver(): void {
    this.intersectionObserver = new IntersectionObserver(
      () => this.scan(),
      { root: this.scrollContainer, rootMargin: '300px' },
    )
    this.observeItems()
  }

  private observeItems(): void {
    if (!this.intersectionObserver) return
    this.intersectionObserver.disconnect()
    for (const item of getPlaylistItems()) {
      this.intersectionObserver.observe(item)
    }
  }

  private scan(): void {
    try {
      this.runScan()
    } catch {
      // YouTube DOM can throw while the page is mid-navigation.
    }
  }

  private runScan(): void {
    const currentPlaylistId = getPlaylistId()
    if (currentPlaylistId !== this.playlistId) {
      this.seenVideoIds.clear()
      return
    }

    const metadata = getPlaylistMetadata(this.playlistId)

    for (const video of scrapeVisiblePlaylistVideos()) {
      this.seenVideoIds.set(video.videoId, video.durationSeconds)
    }

    const loadedCount = this.seenVideoIds.size
    const totalSeconds = [...this.seenVideoIds.values()].reduce((sum, value) => sum + value, 0)
    const totalCount = metadata.totalCount
    let hiddenCount = metadata.hiddenCount

    if (totalCount !== null && loadedCount > totalCount) {
      this.seenVideoIds.clear()
      return
    }

    const scrolledToEnd = isPlaylistScrollAtBottom(this.scrollContainer)
    if (scrolledToEnd && loadedCount === this.lastLoadedCount && loadedCount > 0) {
      this.stablePolls += 1
    } else {
      this.stablePolls = 0
    }
    this.lastLoadedCount = loadedCount

    const scanComplete = isPlaylistScanComplete({
      loadedCount,
      totalCount,
      hiddenCount,
      scrolledToEnd,
      stablePolls: this.stablePolls,
    })

    if (scanComplete && hiddenCount === null) {
      hiddenCount = inferHiddenCount(totalCount, loadedCount)
    }

    const isScanning = !scanComplete

    if (!hasPlaylistContent(metadata.title, loadedCount)) return

    this.onUpdate(this.buildResult(loadedCount, totalSeconds, isScanning, metadata, hiddenCount))

    this.observeItems()
  }

  private tryPublishMetadataOnly(): void {
    if (getPlaylistId() !== this.playlistId) return

    const metadata = getPlaylistMetadata(this.playlistId)
    if (!hasPlaylistContent(metadata.title, 0)) return

    this.onUpdate(this.buildResult(0, 0, true, metadata))
  }

  private buildResult(
    loadedCount: number,
    totalSeconds: number,
    isScanning: boolean,
    metadata = getPlaylistMetadata(this.playlistId),
    hiddenCount = metadata.hiddenCount,
  ): PlaylistDurationResult {
    const availableCount = getAvailableVideoCount(metadata.totalCount, hiddenCount)

    return {
      playlistId: this.playlistId,
      title: metadata.title,
      owner: metadata.owner,
      loadedCount,
      totalCount: metadata.totalCount,
      hiddenCount,
      availableCount,
      totalSeconds,
      speeds: calculateSpeedDurations(totalSeconds),
      isScanning,
      updatedAt: Date.now(),
    }
  }
}
