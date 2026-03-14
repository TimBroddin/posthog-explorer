import { DEFAULT_SETTINGS, MAX_RECENTS } from "./constants"
import type { CachedData, RecentItem, Settings } from "./types"

// --- Settings ---

export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get("settings")
  return { ...DEFAULT_SETTINGS, ...result.settings }
}

export async function saveSettings(settings: Partial<Settings>): Promise<Settings> {
  const current = await getSettings()
  const updated = { ...current, ...settings }
  await chrome.storage.local.set({ settings: updated })
  return updated
}

// --- Cached Data ---

export async function getCachedData(): Promise<CachedData | null> {
  const result = await chrome.storage.local.get("cachedData")
  return result.cachedData ?? null
}

export async function saveCachedData(data: CachedData): Promise<void> {
  await chrome.storage.local.set({ cachedData: data })
}

// --- Recents ---

export async function getRecents(): Promise<RecentItem[]> {
  const result = await chrome.storage.local.get("recents")
  return result.recents ?? []
}

export async function addRecent(item: RecentItem): Promise<RecentItem[]> {
  const recents = await getRecents()
  // Remove duplicate if exists (deduplication: move to top)
  const filtered = recents.filter((r) => r.url !== item.url)
  // Add to front
  filtered.unshift(item)
  // Trim to max (FIFO eviction)
  const trimmed = filtered.slice(0, MAX_RECENTS)
  await chrome.storage.local.set({ recents: trimmed })
  return trimmed
}

// --- Refresh Lock ---

export async function acquireRefreshLock(maxAgeMs: number): Promise<boolean> {
  const result = await chrome.storage.local.get("refreshLock")
  const lock = result.refreshLock as { timestamp: number } | undefined
  if (lock && Date.now() - lock.timestamp < maxAgeMs) {
    return false // Lock is held and not stale
  }
  await chrome.storage.local.set({ refreshLock: { timestamp: Date.now() } })
  return true
}

export async function releaseRefreshLock(): Promise<void> {
  await chrome.storage.local.remove("refreshLock")
}

// --- Expanded Projects ---

export async function toggleExpandedProject(projectId: number): Promise<number[]> {
  const settings = await getSettings()
  const expanded = settings.expandedProjects.includes(projectId)
    ? settings.expandedProjects.filter((id) => id !== projectId)
    : [...settings.expandedProjects, projectId]
  await saveSettings({ expandedProjects: expanded })
  return expanded
}
