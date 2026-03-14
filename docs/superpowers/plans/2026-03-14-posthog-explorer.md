# PostHog Explorer Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome extension that lets PostHog users quickly access their organizations, projects, dashboards, shortcuts, and tool links from the browser toolbar.

**Architecture:** Plasmo Chrome extension (MV3) with a React popup for the main UI, a background service worker for periodic cache refresh, and an options page for settings. Shared `lib/` modules handle API calls and storage. All state lives in `chrome.storage.local`.

**Tech Stack:** Plasmo 0.90.5, React 18, TypeScript 5, Chrome MV3 APIs (storage, alarms), pnpm

**Spec:** `docs/superpowers/specs/2026-03-14-posthog-explorer-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/types.ts` | All TypeScript interfaces (CachedData, RecentItem, Settings, API response types) |
| `lib/constants.ts` | Tool definitions array (name, icon, path, id), default settings |
| `lib/api.ts` | PostHog API client: fetchOrganizations, fetchDashboards, fetchShortcuts |
| `lib/storage.ts` | Chrome storage helpers: get/set settings, cache, recents, expanded state |
| `lib/utils.ts` | Shared utilities (formatTimeAgo) |
| `background.ts` | Service worker: onInstalled, alarm handler, refresh logic |
| `popup.tsx` | Main popup: header, search, recents, org-grouped project tree |
| `popup.css` | Popup styles with light/dark theme via prefers-color-scheme |
| `options.tsx` | Settings page: API key, instance URL, tool toggles, cache controls |
| `options.css` | Options page styles with light/dark theme |
| `package.json` | Updated manifest permissions |

---

## Chunk 1: Foundation (Types, Constants, Storage, API, Utils)

### Task 1: Update package.json manifest permissions

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update manifest permissions in package.json**

Open `package.json` and replace the `"manifest"` block:

```json
"manifest": {
  "permissions": [
    "storage",
    "alarms"
  ],
  "host_permissions": [
    "https://*.posthog.com/*"
  ],
  "optional_host_permissions": [
    "https://*/*"
  ]
}
```

- [ ] **Step 2: Verify the dev server still builds**

Run: `pnpm dev`
Expected: Extension builds without errors (check terminal output for "Built in X ms")

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: narrow manifest permissions for PostHog cloud + optional self-hosted"
```

---

### Task 2: Create type definitions

**Files:**
- Create: `lib/types.ts`

- [ ] **Step 1: Create lib directory and types file**

Create `lib/types.ts` with all shared interfaces.

Note: `CachedProject.dashboards` and `CachedProject.shortcuts` are intentionally optional (`?`) to support lazy loading — they start as `undefined` and are populated when the user first expands a project card. This is a deliberate deviation from the spec's `CachedData` interface which shows them as required.

```typescript
// PostHog API response types

export interface ApiPaginatedResponse<T> {
  results: T[]
  next: string | null
}

export interface ApiOrganization {
  id: string
  name: string
  teams: ApiTeam[]
}

export interface ApiTeam {
  id: number
  name: string
}

export interface ApiDashboard {
  id: number
  name: string
}

export interface ApiShortcut {
  id: string
  path: string
  type: string
}

// Cached data types

export interface CachedOrganization {
  id: string
  name: string
  projects: CachedProject[]
}

export interface CachedProject {
  id: number
  name: string
  dashboards?: Dashboard[]   // optional: lazy loaded on first expand
  shortcuts?: Shortcut[]     // optional: lazy loaded on first expand
}

export interface Dashboard {
  id: number
  name: string
}

export interface Shortcut {
  id: string
  path: string
  label: string
}

export interface CachedData {
  organizations: CachedOrganization[]
  lastRefreshed: number
  lastError?: string  // stores last refresh error for popup display
}

export interface RecentItem {
  name: string
  url: string
  icon: string
  projectName: string
  timestamp: number
}

export interface Settings {
  apiKey: string
  instanceUrl: string
  refreshIntervalMinutes: number
  visibleTools: string[]
  expandedProjects: number[]
}

export interface ToolDefinition {
  id: string
  name: string
  icon: string
  path: string
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm exec tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add type definitions for PostHog API, cache, and settings"
```

---

### Task 3: Create constants

**Files:**
- Create: `lib/constants.ts`

- [ ] **Step 1: Create constants file with tool definitions and defaults**

Create `lib/constants.ts`:

```typescript
import type { Settings, ToolDefinition } from "./types"

export const TOOLS: ToolDefinition[] = [
  { id: "dashboards", name: "Dashboards", icon: "📊", path: "dashboards" },
  { id: "insights", name: "Insights", icon: "💡", path: "insights" },
  { id: "web", name: "Web Analytics", icon: "🌐", path: "web" },
  { id: "replay", name: "Session Replay", icon: "🎬", path: "replay" },
  { id: "error_tracking", name: "Error Tracking", icon: "🐛", path: "error_tracking" },
  { id: "experiments", name: "Experiments", icon: "🧪", path: "experiments" },
  { id: "feature_flags", name: "Feature Flags", icon: "🚩", path: "feature_flags" },
  { id: "surveys", name: "Surveys", icon: "📋", path: "surveys" },
  { id: "notebooks", name: "Notebooks", icon: "📓", path: "notebooks" },
  { id: "sql", name: "SQL", icon: "🔍", path: "sql" },
  { id: "persons", name: "Persons", icon: "👤", path: "persons" },
  { id: "cohorts", name: "Cohorts", icon: "👥", path: "cohorts" },
  { id: "events", name: "Events", icon: "📡", path: "events" },
  { id: "data-management", name: "Data Management", icon: "🗄️", path: "data-management" },
  { id: "annotations", name: "Annotations", icon: "📌", path: "annotations" },
  { id: "toolbar", name: "Toolbar", icon: "🔧", path: "toolbar" }
]

export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  instanceUrl: "https://us.posthog.com",
  refreshIntervalMinutes: 5,
  visibleTools: TOOLS.map((t) => t.id),
  expandedProjects: []
}

export const MAX_RECENTS = 10

export const REFRESH_ALARM_NAME = "posthog-refresh"

export const REFRESH_LOCK_MAX_AGE_MS = 2 * 60 * 1000 // 2 minutes

export const API_CALL_DELAY_MS = 200 // delay between API calls to avoid bursts
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm exec tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add lib/constants.ts
git commit -m "feat: add tool definitions and default settings constants"
```

---

### Task 4: Create shared utilities

**Files:**
- Create: `lib/utils.ts`

- [ ] **Step 1: Create shared utility module**

Create `lib/utils.ts`:

```typescript
export function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/utils.ts
git commit -m "feat: add shared utility module with formatTimeAgo"
```

---

### Task 5: Create storage module

**Files:**
- Create: `lib/storage.ts`

- [ ] **Step 1: Create storage helper module**

Create `lib/storage.ts`:

```typescript
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm exec tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add lib/storage.ts
git commit -m "feat: add chrome.storage helpers for settings, cache, recents, and refresh lock"
```

---

### Task 6: Create API client

**Files:**
- Create: `lib/api.ts`

- [ ] **Step 1: Create PostHog API client module**

Create `lib/api.ts`. Note: includes a `delay()` helper used between all individual API calls to implement the 200ms rate limiting from the spec.

```typescript
import { API_CALL_DELAY_MS } from "./constants"
import type {
  ApiDashboard,
  ApiOrganization,
  ApiPaginatedResponse,
  ApiShortcut,
  CachedOrganization,
  Dashboard,
  Shortcut
} from "./types"
import { delay } from "./utils"

async function apiFetch<T>(
  instanceUrl: string,
  apiKey: string,
  path: string
): Promise<T> {
  const url = `${instanceUrl.replace(/\/$/, "")}${path}`
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  })
  if (!response.ok) {
    throw new Error(`PostHog API error: ${response.status} ${response.statusText}`)
  }
  return response.json()
}

async function fetchAllPages<T>(
  instanceUrl: string,
  apiKey: string,
  path: string
): Promise<T[]> {
  const all: T[] = []
  let currentPath: string | null = path

  while (currentPath) {
    const isFullUrl = currentPath.startsWith("http")
    const response = isFullUrl
      ? await fetch(currentPath, {
          headers: { Authorization: `Bearer ${apiKey}` }
        }).then((r) => {
          if (!r.ok) throw new Error(`PostHog API error: ${r.status}`)
          return r.json() as Promise<ApiPaginatedResponse<T>>
        })
      : await apiFetch<ApiPaginatedResponse<T>>(instanceUrl, apiKey, currentPath)

    all.push(...response.results)
    currentPath = response.next

    // Rate limit between pages
    if (currentPath) await delay(API_CALL_DELAY_MS)
  }
  return all
}

export async function fetchOrganizations(
  instanceUrl: string,
  apiKey: string
): Promise<CachedOrganization[]> {
  const orgs = await apiFetch<ApiPaginatedResponse<ApiOrganization>>(
    instanceUrl,
    apiKey,
    "/api/organizations/"
  )

  return orgs.results.map((org) => ({
    id: org.id,
    name: org.name,
    projects: org.teams.map((team) => ({
      id: team.id,
      name: team.name
    }))
  }))
}

export async function fetchDashboards(
  instanceUrl: string,
  apiKey: string,
  projectId: number
): Promise<Dashboard[]> {
  const dashboards = await fetchAllPages<ApiDashboard>(
    instanceUrl,
    apiKey,
    `/api/projects/${projectId}/dashboards/?limit=100`
  )
  return dashboards.map((d) => ({ id: d.id, name: d.name }))
}

export async function fetchShortcuts(
  instanceUrl: string,
  apiKey: string,
  projectId: number,
  dashboards: Dashboard[]
): Promise<Shortcut[]> {
  try {
    const shortcuts = await fetchAllPages<ApiShortcut>(
      instanceUrl,
      apiKey,
      `/api/projects/${projectId}/file_system_shortcut/`
    )
    return shortcuts.map((s) => ({
      id: s.id,
      path: s.path,
      label: deriveShortcutLabel(s, dashboards)
    }))
  } catch (error) {
    // Endpoint may not exist on older self-hosted instances (404)
    console.warn(`Shortcuts not available for project ${projectId}:`, error)
    return []
  }
}

function deriveShortcutLabel(shortcut: ApiShortcut, dashboards: Dashboard[]): string {
  // Try to extract resource type and ID from path
  // e.g., "project/36349/dashboard/12345" → type=dashboard, id=12345
  const segments = shortcut.path.replace(/^\//, "").split("/")

  // Look for known resource types
  const dashboardIndex = segments.indexOf("dashboard")
  if (dashboardIndex !== -1 && dashboardIndex + 1 < segments.length) {
    const id = parseInt(segments[dashboardIndex + 1], 10)
    const match = dashboards.find((d) => d.id === id)
    if (match) return match.name
  }

  // Fallback: last meaningful segment
  const lastSegment = segments[segments.length - 1]
  return lastSegment || shortcut.type || "Shortcut"
}

export async function fetchProjectDetails(
  instanceUrl: string,
  apiKey: string,
  projectId: number
): Promise<{ dashboards: Dashboard[]; shortcuts: Shortcut[] }> {
  const dashboards = await fetchDashboards(instanceUrl, apiKey, projectId)
  // Rate limit between dashboard and shortcut API calls
  await delay(API_CALL_DELAY_MS)
  // Pass dashboards for label derivation
  const shortcuts = await fetchShortcuts(instanceUrl, apiKey, projectId, dashboards)
  return { dashboards, shortcuts }
}

export async function testConnection(
  instanceUrl: string,
  apiKey: string
): Promise<{ success: boolean; orgCount?: number; error?: string }> {
  try {
    const orgs = await fetchOrganizations(instanceUrl, apiKey)
    return { success: true, orgCount: orgs.length }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `pnpm exec tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add lib/api.ts
git commit -m "feat: add PostHog API client with pagination, rate limiting, and connection test"
```

---

## Chunk 2: Background Service Worker

### Task 7: Create background service worker

**Files:**
- Create: `background.ts`

- [ ] **Step 1: Create the background service worker**

Create `background.ts` at the project root (Plasmo convention):

```typescript
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
```

- [ ] **Step 2: Verify the extension builds with the background worker**

Run: `pnpm dev`
Expected: Build succeeds, terminal shows background service worker registered

- [ ] **Step 3: Commit**

```bash
git add background.ts
git commit -m "feat: add background service worker with alarm-based cache refresh"
```

---

## Chunk 3: Popup UI

### Task 8: Create popup styles

**Files:**
- Create: `popup.css`

- [ ] **Step 1: Create the popup stylesheet with light/dark theme**

Create `popup.css`:

```css
:root {
  --bg: #ffffff;
  --bg-secondary: #f3f4f6;
  --bg-card: #f9fafb;
  --border: #e5e7eb;
  --text: #111827;
  --text-secondary: #6b7280;
  --text-muted: #9ca3af;
  --link: #4b6bfb;
  --link-hover: #3b5beb;
  --amber: #d97706;
  --posthog: #f54e00;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1d1f27;
    --bg-secondary: #2a2c36;
    --bg-card: #2a2c36;
    --border: #3a3c46;
    --text: #f0f0f0;
    --text-secondary: #999;
    --text-muted: #666;
    --link: #7db0f5;
    --link-hover: #9dc4ff;
    --amber: #fbbf24;
  }
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  width: 320px;
  max-height: 500px;
  overflow-y: auto;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 12px;
}

/* Header */
.header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
}

.header-logo {
  width: 22px;
  height: 22px;
  background: var(--posthog);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
  font-size: 12px;
}

.header-title {
  font-weight: 600;
  font-size: 14px;
}

.header-settings {
  margin-left: auto;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 16px;
  background: none;
  border: none;
  padding: 2px;
}

.header-settings:hover {
  color: var(--text-secondary);
}

/* Search */
.search {
  padding: 10px 14px;
}

.search input {
  width: 100%;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 11px;
  outline: none;
}

.search input:focus {
  border-color: var(--link);
}

.search input::placeholder {
  color: var(--text-muted);
}

/* Section headers */
.section-header {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
  padding: 0 14px;
  margin-bottom: 5px;
  margin-top: 10px;
}

/* Recents */
.recents {
  padding: 0 14px 6px;
}

.recent-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 5px;
  cursor: pointer;
  background: var(--bg-card);
  margin-bottom: 2px;
  text-decoration: none;
  color: var(--text);
}

.recent-item:hover {
  background: var(--bg-secondary);
}

.recent-icon {
  font-size: 10px;
  flex-shrink: 0;
}

.recent-name {
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-project {
  font-size: 9px;
  color: var(--text-muted);
  margin-left: auto;
  flex-shrink: 0;
}

/* Organization groups */
.org-group {
  padding: 0 14px 8px;
}

/* Project cards */
.project-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 6px;
  overflow: hidden;
}

.project-header {
  display: flex;
  align-items: center;
  padding: 8px 10px;
  cursor: pointer;
  user-select: none;
}

.project-header:hover {
  background: var(--bg-secondary);
}

.project-name {
  font-size: 12px;
  font-weight: 500;
}

.project-chevron {
  margin-left: auto;
  font-size: 9px;
  color: var(--text-muted);
}

/* Project content (expanded) */
.project-content {
  padding: 4px 8px 8px;
  border-top: 1px solid var(--border);
}

/* Tool grid */
.tool-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
  margin-bottom: 6px;
}

.tool-link {
  font-size: 10px;
  color: var(--link);
  padding: 4px 6px;
  text-decoration: none;
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}

.tool-link:hover {
  background: var(--bg-secondary);
  color: var(--link-hover);
}

/* Foldout sections */
.foldout {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  margin-bottom: 6px;
}

.foldout-header {
  font-size: 9px;
  color: var(--text-muted);
  text-transform: uppercase;
  margin-bottom: 4px;
  font-weight: 600;
}

.foldout-item {
  display: block;
  font-size: 10px;
  color: var(--link);
  padding: 3px 4px;
  text-decoration: none;
  cursor: pointer;
}

.foldout-item:hover {
  color: var(--link-hover);
}

/* States */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
}

.empty-state h3 {
  font-size: 14px;
  margin-bottom: 8px;
}

.empty-state p {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 16px;
}

.empty-state button,
.btn {
  background: var(--posthog);
  color: white;
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 12px;
  cursor: pointer;
  font-weight: 500;
}

.btn:hover {
  opacity: 0.9;
}

.spinner {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  color: var(--text-secondary);
  font-size: 11px;
  gap: 8px;
}

.spinner::before {
  content: "";
  width: 14px;
  height: 14px;
  border: 2px solid var(--border);
  border-top-color: var(--posthog);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-banner {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  padding: 8px 14px;
  font-size: 11px;
  color: var(--amber);
  display: flex;
  align-items: center;
  gap: 6px;
}

.no-results {
  padding: 20px;
  text-align: center;
  color: var(--text-muted);
  font-size: 11px;
}
```

- [ ] **Step 2: Commit**

```bash
git add popup.css
git commit -m "feat: add popup styles with light/dark theme support"
```

---

### Task 9: Build the popup UI

**Files:**
- Modify: `popup.tsx` (replace boilerplate)

- [ ] **Step 1: Replace popup.tsx with the full popup implementation**

Key fixes from review:
- All `<a>` tags have `href` attributes for right-click "Open in new tab" support
- Left-click is intercepted with `e.preventDefault()` to use `handleOpenLink`
- Shortcuts foldout is gated behind `showShortcuts` state with a toggle trigger
- Search only shows projects that match by name/dashboard/shortcut — tool name matches are scoped to the project level
- `saveCachedData` is statically imported (no dynamic import)
- Auth error state is handled (shows error + settings link)
- Uses `formatTimeAgo` from shared `lib/utils.ts`

Replace the entire contents of `popup.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react"

import { fetchProjectDetails } from "~lib/api"
import { TOOLS } from "~lib/constants"
import {
  addRecent,
  getCachedData,
  getRecents,
  getSettings,
  saveCachedData,
  toggleExpandedProject
} from "~lib/storage"
import type {
  CachedData,
  CachedOrganization,
  CachedProject,
  RecentItem,
  Settings
} from "~lib/types"
import { formatTimeAgo } from "~lib/utils"

import "./popup.css"

function Popup() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [cache, setCache] = useState<CachedData | null>(null)
  const [recents, setRecents] = useState<RecentItem[]>([])
  const [expandedProjects, setExpandedProjects] = useState<number[]>([])
  const [loadingProjects, setLoadingProjects] = useState<Set<number>>(new Set())
  const [showDashboards, setShowDashboards] = useState<Set<number>>(new Set())
  const [showShortcuts, setShowShortcuts] = useState<Set<number>>(new Set())
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)

  // Load initial data
  useEffect(() => {
    async function load() {
      const [s, c, r] = await Promise.all([
        getSettings(),
        getCachedData(),
        getRecents()
      ])
      setSettings(s)
      setCache(c)
      setRecents(r)
      setExpandedProjects(s.expandedProjects)
      setLoading(false)
    }
    load()
  }, [])

  // Listen for storage changes (background refresh)
  useEffect(() => {
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.cachedData?.newValue) {
        setCache(changes.cachedData.newValue)
      }
      if (changes.recents?.newValue) {
        setRecents(changes.recents.newValue)
      }
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])

  const handleOpenSettings = useCallback(() => {
    chrome.runtime.openOptionsPage()
  }, [])

  const handleToggleProject = useCallback(
    async (projectId: number) => {
      const newExpanded = await toggleExpandedProject(projectId)
      setExpandedProjects(newExpanded)

      // Lazy load project details if expanding and not cached
      if (newExpanded.includes(projectId) && settings && cache) {
        const project = cache.organizations
          .flatMap((o) => o.projects)
          .find((p) => p.id === projectId)
        if (project && !project.dashboards) {
          setLoadingProjects((prev) => new Set([...prev, projectId]))
          try {
            const details = await fetchProjectDetails(
              settings.instanceUrl,
              settings.apiKey,
              projectId
            )
            // Update cache with project details
            const updated: CachedData = {
              ...cache,
              organizations: cache.organizations.map((org) => ({
                ...org,
                projects: org.projects.map((p) =>
                  p.id === projectId
                    ? { ...p, dashboards: details.dashboards, shortcuts: details.shortcuts }
                    : p
                )
              }))
            }
            setCache(updated)
            await saveCachedData(updated)
          } catch (e) {
            console.error("Failed to load project details:", e)
          } finally {
            setLoadingProjects((prev) => {
              const next = new Set(prev)
              next.delete(projectId)
              return next
            })
          }
        }
      }
    },
    [settings, cache]
  )

  const handleOpenLink = useCallback(
    async (e: React.MouseEvent, url: string, name: string, icon: string, projectName: string) => {
      e.preventDefault()
      await chrome.tabs.create({ url })
      const newRecents = await addRecent({
        name,
        url,
        icon,
        projectName,
        timestamp: Date.now()
      })
      setRecents(newRecents)
    },
    []
  )

  const buildUrl = useCallback(
    (projectId: number, path: string) => {
      if (!settings) return "#"
      return `${settings.instanceUrl.replace(/\/$/, "")}/project/${projectId}/${path}`
    },
    [settings]
  )

  // Filter by search
  const filteredOrgs = useMemo(() => {
    if (!cache?.organizations || !search.trim()) return cache?.organizations ?? []

    const q = search.toLowerCase()
    const visibleToolNames = TOOLS.filter((t) =>
      settings?.visibleTools.includes(t.id)
    )

    return cache.organizations
      .map((org) => {
        const filteredProjects = org.projects.filter((project) => {
          // Match project name
          if (project.name.toLowerCase().includes(q)) return true
          // Match dashboard names
          if (project.dashboards?.some((d) => d.name.toLowerCase().includes(q))) return true
          // Match shortcut labels
          if (project.shortcuts?.some((s) => s.label.toLowerCase().includes(q))) return true
          // Match tool names (e.g., "replay" → Session Replay)
          if (visibleToolNames.some((t) => t.name.toLowerCase().includes(q))) return true
          return false
        })
        if (filteredProjects.length === 0) return null
        return { ...org, projects: filteredProjects }
      })
      .filter(Boolean) as CachedOrganization[]
  }, [cache, search, settings])

  // --- Loading ---
  if (loading) {
    return <div className="spinner">Loading...</div>
  }

  // --- No API key ---
  if (!settings?.apiKey) {
    return (
      <div className="empty-state">
        <h3>Welcome to PostHog Explorer</h3>
        <p>Set up your API key to get started.</p>
        <button onClick={handleOpenSettings}>Open Settings</button>
      </div>
    )
  }

  // --- Auth error (API key exists but last refresh failed with auth error) ---
  if (cache?.lastError?.includes("401")) {
    return (
      <div className="empty-state">
        <h3>Authentication Failed</h3>
        <p>Your API key appears to be invalid. Check your settings.</p>
        <button onClick={handleOpenSettings}>Open Settings</button>
      </div>
    )
  }

  // --- Loading initial data ---
  if (!cache || (cache.organizations.length === 0 && !cache.lastError)) {
    return (
      <div>
        <Header onSettings={handleOpenSettings} />
        <div className="spinner">Loading your projects...</div>
      </div>
    )
  }

  // --- Network error with no cached data ---
  if (cache.organizations.length === 0 && cache.lastError) {
    return (
      <div>
        <Header onSettings={handleOpenSettings} />
        <div className="empty-state">
          <h3>Could not reach PostHog</h3>
          <p>{cache.lastError}</p>
          <button onClick={handleOpenSettings}>Check Settings</button>
        </div>
      </div>
    )
  }

  const hasResults = filteredOrgs.length > 0
  const isSearching = search.trim().length > 0

  return (
    <div>
      <Header onSettings={handleOpenSettings} />

      {/* Search */}
      <div className="search">
        <input
          type="text"
          placeholder="Search projects, dashboards, shortcuts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
      </div>

      {/* Refresh failed banner */}
      {cache.lastError && cache.lastRefreshed > 0 && (
        <div className="error-banner">
          Last updated {formatTimeAgo(cache.lastRefreshed)} — refresh failed
        </div>
      )}

      {/* Recents */}
      {!isSearching && recents.length > 0 && (
        <>
          <div className="section-header">Recent</div>
          <div className="recents">
            {recents.map((item, i) => (
              <a
                key={i}
                className="recent-item"
                href={item.url}
                onClick={(e) =>
                  handleOpenLink(e, item.url, item.name, item.icon, item.projectName)
                }>
                <span className="recent-icon">{item.icon}</span>
                <span className="recent-name">{item.name}</span>
                <span className="recent-project">{item.projectName}</span>
              </a>
            ))}
          </div>
        </>
      )}

      {/* Org-grouped projects */}
      {hasResults ? (
        filteredOrgs.map((org) => (
          <div key={org.id}>
            <div className="section-header">{org.name}</div>
            <div className="org-group">
              {org.projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  expanded={expandedProjects.includes(project.id) || isSearching}
                  loading={loadingProjects.has(project.id)}
                  showDashboards={showDashboards.has(project.id)}
                  showShortcuts={showShortcuts.has(project.id)}
                  visibleTools={settings.visibleTools}
                  onToggle={() => handleToggleProject(project.id)}
                  onToggleDashboards={() =>
                    setShowDashboards((prev) => {
                      const next = new Set(prev)
                      next.has(project.id) ? next.delete(project.id) : next.add(project.id)
                      return next
                    })
                  }
                  onToggleShortcuts={() =>
                    setShowShortcuts((prev) => {
                      const next = new Set(prev)
                      next.has(project.id) ? next.delete(project.id) : next.add(project.id)
                      return next
                    })
                  }
                  onOpenLink={handleOpenLink}
                  buildUrl={buildUrl}
                  instanceUrl={settings.instanceUrl}
                />
              ))}
            </div>
          </div>
        ))
      ) : isSearching ? (
        <div className="no-results">No matches found</div>
      ) : null}
    </div>
  )
}

// --- Sub-components ---

function Header({ onSettings }: { onSettings: () => void }) {
  return (
    <div className="header">
      <div className="header-logo">P</div>
      <span className="header-title">PostHog Explorer</span>
      <button className="header-settings" onClick={onSettings} title="Settings">
        ⚙
      </button>
    </div>
  )
}

function ProjectCard({
  project,
  expanded,
  loading,
  showDashboards,
  showShortcuts,
  visibleTools,
  onToggle,
  onToggleDashboards,
  onToggleShortcuts,
  onOpenLink,
  buildUrl,
  instanceUrl
}: {
  project: CachedProject
  expanded: boolean
  loading: boolean
  showDashboards: boolean
  showShortcuts: boolean
  visibleTools: string[]
  onToggle: () => void
  onToggleDashboards: () => void
  onToggleShortcuts: () => void
  onOpenLink: (e: React.MouseEvent, url: string, name: string, icon: string, projectName: string) => void
  buildUrl: (projectId: number, path: string) => string
  instanceUrl: string
}) {
  const tools = TOOLS.filter((t) => visibleTools.includes(t.id))
  const hasShortcuts = project.shortcuts && project.shortcuts.length > 0

  return (
    <div className="project-card">
      <div className="project-header" onClick={onToggle}>
        <span className="project-name">{project.name}</span>
        <span className="project-chevron">{expanded ? "▼" : "▶"}</span>
      </div>

      {expanded && (
        <div className="project-content">
          {/* Tool grid */}
          <div className="tool-grid">
            {tools.map((tool) => {
              const url = buildUrl(project.id, tool.path)
              if (tool.id === "dashboards") {
                return (
                  <a
                    key={tool.id}
                    className="tool-link"
                    href={url}
                    onClick={(e) => {
                      e.preventDefault()
                      onToggleDashboards()
                    }}>
                    {tool.icon} {tool.name} {showDashboards ? "▴" : "▾"}
                  </a>
                )
              }
              return (
                <a
                  key={tool.id}
                  className="tool-link"
                  href={url}
                  onClick={(e) =>
                    onOpenLink(e, url, tool.name, tool.icon, project.name)
                  }>
                  {tool.icon} {tool.name}
                </a>
              )
            })}
            {/* Shortcuts toggle (only if shortcuts exist) */}
            {hasShortcuts && (
              <a
                className="tool-link"
                href="#"
                onClick={(e) => {
                  e.preventDefault()
                  onToggleShortcuts()
                }}>
                ⭐ Shortcuts {showShortcuts ? "▴" : "▾"}
              </a>
            )}
          </div>

          {/* Loading spinner for lazy-loaded details */}
          {loading && <div className="spinner">Loading details...</div>}

          {/* Dashboards foldout */}
          {showDashboards && project.dashboards && project.dashboards.length > 0 && (
            <div className="foldout">
              <div className="foldout-header">Dashboards</div>
              {project.dashboards.map((dashboard) => {
                const url = buildUrl(project.id, `dashboard/${dashboard.id}`)
                return (
                  <a
                    key={dashboard.id}
                    className="foldout-item"
                    href={url}
                    onClick={(e) =>
                      onOpenLink(e, url, dashboard.name, "📊", project.name)
                    }>
                    {dashboard.name}
                  </a>
                )
              })}
            </div>
          )}

          {/* Shortcuts foldout (gated behind showShortcuts toggle) */}
          {showShortcuts && hasShortcuts && (
            <div className="foldout">
              <div className="foldout-header">Shortcuts</div>
              {project.shortcuts!.map((shortcut) => {
                const cleanPath = shortcut.path.replace(/^\//, "")
                const url = `${instanceUrl.replace(/\/$/, "")}/${cleanPath}`
                return (
                  <a
                    key={shortcut.id}
                    className="foldout-item"
                    href={url}
                    onClick={(e) =>
                      onOpenLink(e, url, shortcut.label, "⭐", project.name)
                    }>
                    ⭐ {shortcut.label}
                  </a>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default Popup
```

- [ ] **Step 2: Verify the extension builds**

Run: `pnpm dev`
Expected: Build succeeds without errors

- [ ] **Step 3: Commit**

```bash
git add popup.tsx popup.css
git commit -m "feat: implement popup UI with search, recents, org-grouped project tree"
```

---

## Chunk 4: Options Page

### Task 10: Create options page styles

**Files:**
- Create: `options.css`

- [ ] **Step 1: Create the options page stylesheet**

Create `options.css`:

```css
:root {
  --bg: #ffffff;
  --bg-secondary: #f3f4f6;
  --border: #e5e7eb;
  --text: #111827;
  --text-secondary: #6b7280;
  --text-muted: #9ca3af;
  --link: #4b6bfb;
  --posthog: #f54e00;
  --success: #10b981;
  --error: #ef4444;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1d1f27;
    --bg-secondary: #2a2c36;
    --border: #3a3c46;
    --text: #f0f0f0;
    --text-secondary: #999;
    --text-muted: #666;
    --link: #7db0f5;
    --success: #34d399;
    --error: #f87171;
  }
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  padding: 24px;
  max-width: 600px;
  margin: 0 auto;
}

h1 {
  font-size: 20px;
  margin-bottom: 24px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.logo {
  width: 28px;
  height: 28px;
  background: var(--posthog);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: bold;
  font-size: 14px;
}

.section {
  margin-bottom: 24px;
  padding: 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.section h2 {
  font-size: 14px;
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-secondary);
}

.field {
  margin-bottom: 12px;
}

.field label {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.field input[type="text"],
.field input[type="password"] {
  width: 100%;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 13px;
  outline: none;
}

.field input:focus {
  border-color: var(--link);
}

.field select {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 13px;
  outline: none;
}

.password-field {
  position: relative;
}

.password-field input {
  padding-right: 60px;
}

.password-toggle {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 11px;
  padding: 2px 4px;
}

.password-toggle:hover {
  color: var(--text-secondary);
}

.btn {
  background: var(--posthog);
  color: white;
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 12px;
  cursor: pointer;
  font-weight: 500;
}

.btn:hover {
  opacity: 0.9;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
}

.btn-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
}

.status {
  font-size: 12px;
  margin-left: 8px;
}

.status.success {
  color: var(--success);
}

.status.error {
  color: var(--error);
}

.tools-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.tool-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  cursor: pointer;
}

.tool-toggle input {
  accent-color: var(--posthog);
}

.cache-info {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.hint {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 8px;
}
```

- [ ] **Step 2: Commit**

```bash
git add options.css
git commit -m "feat: add options page styles with light/dark theme"
```

---

### Task 11: Create options page

**Files:**
- Create: `options.tsx`

- [ ] **Step 1: Create the options page**

Key fixes from review:
- Password field has show/hide toggle
- Separate "Grant Access" button for self-hosted URLs (uses `chrome.permissions.request()` in click handler)
- Uses `REFRESH_ALARM_NAME` constant instead of magic string
- Manual refresh sends message to background worker instead of using `chrome.alarms` with too-small delay
- Uses `formatTimeAgo` from shared `lib/utils.ts`

Create `options.tsx` at the project root:

```tsx
import { useCallback, useEffect, useRef, useState } from "react"

import { testConnection } from "~lib/api"
import { TOOLS } from "~lib/constants"
import { getCachedData, getSettings, saveSettings } from "~lib/storage"
import type { Settings } from "~lib/types"
import { formatTimeAgo } from "~lib/utils"

import "./options.css"

function Options() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)
  const [testStatus, setTestStatus] = useState<{
    type: "success" | "error"
    message: string
  } | null>(null)
  const [testing, setTesting] = useState(false)
  const [permissionGranted, setPermissionGranted] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    async function load() {
      const s = await getSettings()
      setSettings(s)
      const cache = await getCachedData()
      setLastRefreshed(cache?.lastRefreshed ?? null)
      // Check if permission is already granted for non-posthog.com URLs
      if (s.instanceUrl && !s.instanceUrl.includes("posthog.com")) {
        try {
          const granted = await chrome.permissions.contains({
            origins: [`${s.instanceUrl.replace(/\/$/, "")}/*`]
          })
          setPermissionGranted(granted)
        } catch {
          // Ignore errors checking permissions
        }
      }
    }
    load()
  }, [])

  // Debounced save for text inputs (apiKey, instanceUrl)
  // Updates local state immediately for responsive UI, saves to storage after 500ms idle
  const updateSettingDebounced = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      if (!settings) return
      // Update local state immediately
      const updated = { ...settings, [key]: value }
      setSettings(updated)
      // Debounce the storage write
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(async () => {
        await saveSettings({ [key]: value })
      }, 500)
    },
    [settings]
  )

  // Immediate save for non-text inputs (toggles, selects)
  const updateSetting = useCallback(
    async <K extends keyof Settings>(key: K, value: Settings[K]) => {
      if (!settings) return
      const updated = await saveSettings({ [key]: value })
      setSettings(updated)
    },
    [settings]
  )

  const handleGrantAccess = useCallback(async () => {
    if (!settings) return
    try {
      const granted = await chrome.permissions.request({
        origins: [`${settings.instanceUrl.replace(/\/$/, "")}/*`]
      })
      setPermissionGranted(granted)
      if (!granted) {
        setTestStatus({ type: "error", message: "Permission denied by user" })
      }
    } catch (e) {
      setTestStatus({ type: "error", message: "Failed to request permission" })
    }
  }, [settings])

  const handleTestConnection = useCallback(async () => {
    if (!settings) return
    setTesting(true)
    setTestStatus(null)

    const result = await testConnection(settings.instanceUrl, settings.apiKey)
    if (result.success) {
      setTestStatus({
        type: "success",
        message: `Connected! Found ${result.orgCount} organization${result.orgCount === 1 ? "" : "s"}.`
      })
    } else {
      setTestStatus({ type: "error", message: result.error ?? "Connection failed" })
    }
    setTesting(false)
  }, [settings])

  const handleRefreshNow = useCallback(async () => {
    if (!settings?.apiKey) return
    // Send message to background worker to trigger refresh
    chrome.runtime.sendMessage({ type: "refresh" }, () => {
      // Check for errors (e.g., service worker not ready)
      if (chrome.runtime.lastError) {
        console.warn("Refresh message failed:", chrome.runtime.lastError.message)
      }
      // Update the last refreshed time after refresh completes
      getCachedData().then((cache) => {
        setLastRefreshed(cache?.lastRefreshed ?? null)
      })
    })
  }, [settings])

  const handleToggleTool = useCallback(
    async (toolId: string) => {
      if (!settings) return
      const newTools = settings.visibleTools.includes(toolId)
        ? settings.visibleTools.filter((id) => id !== toolId)
        : [...settings.visibleTools, toolId]
      await updateSetting("visibleTools", newTools)
    },
    [settings, updateSetting]
  )

  if (!settings) return null

  const isCustomUrl =
    settings.instanceUrl.length > 0 && !settings.instanceUrl.includes("posthog.com")

  return (
    <div>
      <h1>
        <div className="logo">P</div>
        PostHog Explorer Settings
      </h1>

      {/* Connection */}
      <div className="section">
        <h2>Connection</h2>
        <div className="field">
          <label>PostHog Instance URL</label>
          <input
            type="text"
            value={settings.instanceUrl}
            onChange={(e) => updateSettingDebounced("instanceUrl", e.target.value)}
            placeholder="https://us.posthog.com"
          />
        </div>
        <div className="field">
          <label>Personal API Key</label>
          <div className="password-field">
            <input
              type={showApiKey ? "text" : "password"}
              value={settings.apiKey}
              onChange={(e) => updateSettingDebounced("apiKey", e.target.value)}
              placeholder="phx_..."
            />
            <button
              className="password-toggle"
              onClick={() => setShowApiKey(!showApiKey)}
              type="button">
              {showApiKey ? "Hide" : "Show"}
            </button>
          </div>
        </div>
        <div className="btn-row">
          {isCustomUrl && !permissionGranted && (
            <button className="btn btn-secondary" onClick={handleGrantAccess}>
              Grant Access
            </button>
          )}
          <button className="btn" onClick={handleTestConnection} disabled={testing}>
            {testing ? "Testing..." : "Test Connection"}
          </button>
          {testStatus && (
            <span className={`status ${testStatus.type}`}>
              {testStatus.message}
            </span>
          )}
        </div>
        {isCustomUrl && (
          <p className="hint">
            Self-hosted URL detected. Click "Grant Access" first, then "Test Connection".
          </p>
        )}
      </div>

      {/* Visible Tools */}
      <div className="section">
        <h2>Visible Tools</h2>
        <div className="tools-grid">
          {TOOLS.map((tool) => (
            <label key={tool.id} className="tool-toggle">
              <input
                type="checkbox"
                checked={settings.visibleTools.includes(tool.id)}
                onChange={() => handleToggleTool(tool.id)}
              />
              {tool.icon} {tool.name}
            </label>
          ))}
        </div>
      </div>

      {/* Cache */}
      <div className="section">
        <h2>Cache</h2>
        <div className="cache-info">
          {lastRefreshed
            ? `Last refreshed: ${formatTimeAgo(lastRefreshed)}`
            : "No data cached yet"}
        </div>
        <div className="btn-row">
          <button className="btn btn-secondary" onClick={handleRefreshNow}>
            Refresh Now
          </button>
          <select
            value={settings.refreshIntervalMinutes}
            onChange={(e) =>
              updateSetting("refreshIntervalMinutes", parseInt(e.target.value))
            }>
            <option value={1}>Every 1 minute</option>
            <option value={5}>Every 5 minutes</option>
            <option value={15}>Every 15 minutes</option>
            <option value={30}>Every 30 minutes</option>
          </select>
        </div>
      </div>
    </div>
  )
}

export default Options
```

- [ ] **Step 2: Verify the extension builds**

Run: `pnpm dev`
Expected: Build succeeds, options page is accessible from the extension

- [ ] **Step 3: Commit**

```bash
git add options.tsx options.css
git commit -m "feat: implement options page with connection, tool toggles, and cache settings"
```

---

## Chunk 5: Polish & Housekeeping

### Task 12: Update CI workflow

**Files:**
- Modify: `.github/workflows/submit.yml`

- [ ] **Step 1: Update the CI workflow to modern versions**

Replace the contents of `.github/workflows/submit.yml`:

```yaml
name: "Submit to Web Store"
on:
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Use Node.js 20.x
        uses: actions/setup-node@v4
        with:
          node-version: 20.x
      - uses: pnpm/action-setup@v4
        with:
          version: latest
          run_install: true
      - name: Build the extension
        run: pnpm build
      - name: Package the extension into a zip artifact
        run: pnpm package
      - name: Browser Platform Publish
        uses: PlasmoHQ/bpp@v3
        with:
          keys: ${{ secrets.SUBMIT_KEYS }}
          artifact: build/chrome-mv3-prod.zip
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/submit.yml
git commit -m "chore: update CI workflow to Node.js 20 and actions v4"
```

---

### Task 13: Add .superpowers to .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add .superpowers directory to gitignore**

Append to `.gitignore`:

```
# Superpowers brainstorming
.superpowers/
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: add .superpowers to gitignore"
```

---

### Task 14: Manual integration testing

- [ ] **Step 1: Load the extension in Chrome**

1. Run `pnpm dev` to start the dev server
2. Open `chrome://extensions/` in Chrome
3. Enable "Developer mode"
4. Click "Load unpacked" and select `build/chrome-mv3-dev`
5. Verify the extension icon appears in the toolbar

- [ ] **Step 2: Configure and test connection**

1. Click the extension icon — verify "Welcome" screen appears with "Open Settings" button
2. Click "Open Settings" — verify options page opens
3. Enter your PostHog API key and instance URL
4. Click "Test Connection" — verify success message shows org count
5. Click the Show/Hide toggle on the API key field — verify it reveals/hides the key

- [ ] **Step 3: Test the popup**

1. Click the extension icon — verify organizations and projects load
2. Expand a project — verify tool links appear in 2-column grid, loading spinner shows while fetching
3. Click "Dashboards ▾" — verify individual dashboards appear in foldout
4. Click "Shortcuts ▾" — verify shortcuts appear in foldout (if available)
5. Click a tool link — verify it opens in a new tab
6. Right-click a tool link — verify "Open in new tab" works (has href)
7. Click the extension again — verify the clicked link appears in Recents
8. Click same link again — verify it moves to top of recents (not duplicated)

- [ ] **Step 4: Test search**

1. Type a project name — verify tree filters to matching projects
2. Type a dashboard name — verify matching projects expand
3. Clear search — verify full tree returns with recents visible again

- [ ] **Step 5: Test theme**

1. Switch OS to dark mode — verify popup and options use dark colors
2. Switch back to light mode — verify it updates

- [ ] **Step 6: Test settings persistence**

1. Toggle some tools off in settings — verify they disappear from popup
2. Expand a project, close popup, reopen — verify project stays expanded
3. Change refresh interval — verify it persists after closing options

- [ ] **Step 7: Test error states**

1. Enter an invalid API key — verify popup shows auth error with settings link
2. Enter invalid instance URL — verify "Could not reach PostHog" state
3. Fix API key — verify data loads correctly
