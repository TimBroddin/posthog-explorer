import { fetchOrganizations, fetchProjectDetails } from "~lib/api"
import { API_CALL_DELAY_MS, REFRESH_ALARM_NAME, REFRESH_LOCK_MAX_AGE_MS } from "~lib/constants"
import {
  acquireRefreshLock,
  getCachedData,
  getSettings,
  releaseRefreshLock,
  saveCachedData
} from "~lib/storage"
import type { CachedData } from "~lib/types"
import { delay } from "~lib/utils"

// Set up alarm on install
chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings()
  if (settings.apiKey) {
    await refreshData()
  }
  await chrome.alarms.create(REFRESH_ALARM_NAME, {
    periodInMinutes: settings.refreshIntervalMinutes
  })
})

// Handle alarm
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === REFRESH_ALARM_NAME) {
    await refreshData()
  }
})

// Listen for settings changes to update alarm interval and trigger refresh
chrome.storage.onChanged.addListener(async (changes) => {
  if (changes.settings) {
    const newSettings = changes.settings.newValue
    const oldSettings = changes.settings.oldValue

    // Update alarm interval if changed
    if (newSettings?.refreshIntervalMinutes !== oldSettings?.refreshIntervalMinutes) {
      await chrome.alarms.create(REFRESH_ALARM_NAME, {
        periodInMinutes: newSettings.refreshIntervalMinutes
      })
    }

    // Refresh if API key or instance URL changed
    if (
      newSettings?.apiKey !== oldSettings?.apiKey ||
      newSettings?.instanceUrl !== oldSettings?.instanceUrl
    ) {
      if (newSettings?.apiKey) {
        await refreshData()
      }
    }
  }
})

// Listen for manual refresh requests from popup/options
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "refresh") {
    refreshData().then(() => sendResponse({ done: true }))
    return true // keep channel open for async response
  }
})

async function refreshData(): Promise<void> {
  const locked = await acquireRefreshLock(REFRESH_LOCK_MAX_AGE_MS)
  if (!locked) return

  try {
    const settings = await getSettings()
    if (!settings.apiKey) return

    // Fetch organizations (always)
    const organizations = await fetchOrganizations(
      settings.instanceUrl,
      settings.apiKey
    )

    // Get existing cache to preserve project details
    const existingCache = await getCachedData()

    // For previously-expanded projects, refresh their details
    for (const org of organizations) {
      for (const project of org.projects) {
        const wasExpanded = settings.expandedProjects.includes(project.id)
        if (wasExpanded) {
          // Rate limit between projects
          await delay(API_CALL_DELAY_MS)
          try {
            const details = await fetchProjectDetails(
              settings.instanceUrl,
              settings.apiKey,
              project.id
            )
            project.dashboards = details.dashboards
            project.shortcuts = details.shortcuts
          } catch (e) {
            // Keep existing cached data if refresh fails
            const existingProject = existingCache?.organizations
              .flatMap((o) => o.projects)
              .find((p) => p.id === project.id)
            if (existingProject) {
              project.dashboards = existingProject.dashboards
              project.shortcuts = existingProject.shortcuts
            }
          }
        } else {
          // Preserve existing cached details for non-expanded projects
          const existingProject = existingCache?.organizations
            .flatMap((o) => o.projects)
            .find((p) => p.id === project.id)
          if (existingProject) {
            project.dashboards = existingProject.dashboards
            project.shortcuts = existingProject.shortcuts
          }
        }
      }
    }

    const cachedData: CachedData = {
      organizations,
      lastRefreshed: Date.now()
    }
    await saveCachedData(cachedData)
  } catch (error) {
    console.error("PostHog Explorer: refresh failed", error)
    // Store error in cache for popup to display
    const existingCache = await getCachedData()
    if (existingCache) {
      existingCache.lastError = error instanceof Error ? error.message : "Refresh failed"
      await saveCachedData(existingCache)
    } else {
      // No cache at all — store error so popup can show it
      await saveCachedData({
        organizations: [],
        lastRefreshed: 0,
        lastError: error instanceof Error ? error.message : "Refresh failed"
      })
    }
  } finally {
    await releaseRefreshLock()
  }
}
