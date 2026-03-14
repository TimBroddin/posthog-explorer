# PostHog Explorer — Chrome Extension Design Spec

## Overview

A Chrome extension (MV3) that gives PostHog users quick access to all their organizations, projects, dashboards, shortcuts, and tool links from the browser toolbar. Built with Plasmo (React + TypeScript).

## Authentication

- **Method:** PostHog Personal API key
- **Header:** `Authorization: Bearer <personal_api_key>`
- **Storage:** `chrome.storage.local` (API key is a sensitive credential; avoid syncing across profiles)
- **Instance URL:** Configurable, defaults to `https://us.posthog.com`. Supports self-hosted instances.

## API Integration

### Endpoints Used

| Endpoint | Purpose |
|---|---|
| `GET /api/organizations/` | List all orgs (response includes `teams` array per org — these are the projects) |
| `GET /api/projects/:id/dashboards/?limit=100` | List dashboards per project. Paginate if `next` is non-null. |
| `GET /api/projects/:id/file_system_shortcut/` | List sidebar shortcuts per project. See Shortcuts section below. |

### Pagination

PostHog API responses use `{ results: [...], next: "url" | null }`. For dashboards and shortcuts, follow `next` until null. In practice most projects have <100 dashboards, so a single page with `limit=100` usually suffices.

### API Response Mapping

- **Organizations endpoint** returns orgs with a `teams` array (PostHog's API name for projects). Map `team.id` → `project.id`, `team.name` → `project.name`. Organization IDs are UUID strings; project/team IDs are numbers.
- **Dashboards endpoint** returns `{ results: [{ id, name, ... }] }`. We only cache `id` and `name`.
- **Shortcuts endpoint:** This uses PostHog's file system shortcut API (`/api/projects/:id/file_system_shortcut/`). This endpoint may not be available on older self-hosted instances. Response shape: `{ results: [{ id, path, type, ... }] }`. The `path` field is a relative path (e.g., `project/36349/dashboard/12345`). The display name is derived from the path's last segment (e.g., extract the resource name by looking up the cached dashboards/insights, or use the last path component as a fallback label). If the endpoint returns 404, skip shortcuts for that project gracefully.

### Cached Data Structure

```typescript
interface CachedData {
  organizations: Array<{
    id: string       // UUID string
    name: string
    projects: Array<{
      id: number     // numeric team/project ID
      name: string
      dashboards: Array<{ id: number; name: string }>
      shortcuts: Array<{ id: string; path: string; label: string }>
    }>
  }>
  lastRefreshed: number
}

interface RecentItem {
  name: string
  url: string
  icon: string        // emoji icon for the tool type
  projectName: string
  timestamp: number
}

interface Settings {
  apiKey: string
  instanceUrl: string
  refreshIntervalMinutes: number  // default: 5
  visibleTools: string[]          // tool IDs that are enabled
  expandedProjects: number[]      // project IDs that are expanded in popup
}
```

- `CachedData` and `RecentItem[]` stored in `chrome.storage.local`
- `Settings` stored in `chrome.storage.local`

### Shortcut Label Derivation

The shortcuts API returns `path` and `type` but no human-readable name. To derive a display label:
1. Parse the `path` to extract the resource type and ID (e.g., `project/36349/dashboard/12345` → type=dashboard, id=12345)
2. Look up the name from already-cached data (e.g., match dashboard ID 12345 to its cached name)
3. If no cached match found, use the path's last segment as a fallback (e.g., "12345")

### N+1 API Call Mitigation

For each project, we need 2 API calls (dashboards + shortcuts). To avoid hammering the API for users with many projects:
- **Lazy loading:** Only fetch dashboards and shortcuts for a project when the user first expands that project card. Cache the result.
- **Background refresh:** Only refresh data for projects that have been previously expanded (i.e., already in cache). New projects get fetched on-demand.
- **Rate limiting:** Space API calls 200ms apart to avoid bursts. Rate limiting state is ephemeral (not persisted) — if the service worker restarts, it simply starts fresh.

### Tool Link URL Pattern

All tool links follow: `{instanceUrl}/project/{projectId}/{toolPath}`

Tool paths:
- `dashboards` / `dashboards/{id}` (individual)
- `insights`
- `web` (Web Analytics)
- `replay` (Session Replay)
- `error_tracking` (Error Tracking)
- `experiments`
- `feature_flags`
- `surveys`
- `notebooks`
- `sql`
- `persons`
- `cohorts`
- `events`
- `data-management`
- `annotations`
- `toolbar`

## Extension Architecture

### Entry Points (Plasmo convention: project root)

| File | Purpose |
|---|---|
| `popup.tsx` | Main popup UI — org/project tree, search, recents, tool links |
| `background.ts` | Service worker — periodic cache refresh via `chrome.alarms` |
| `options.tsx` | Settings page — API key, instance URL, toggle visible tools |

### Shared Modules (in `lib/` directory)

| File | Purpose |
|---|---|
| `lib/storage.ts` | Read/write cache, settings, recents to chrome.storage |
| `lib/api.ts` | PostHog API client — fetch orgs, projects, dashboards, shortcuts |
| `lib/constants.ts` | Tool definitions (name, icon, path), defaults |

### Data Flow

1. User enters API key in options page → saved to `chrome.storage.local` → triggers immediate org fetch
2. On install (`chrome.runtime.onInstalled`), background worker creates the refresh alarm and does an immediate fetch of organizations (if API key exists)
3. Background worker wakes every N minutes via `chrome.alarms` → refreshes orgs + previously-expanded projects → writes cache to `chrome.storage.local`
4. User clicks extension icon → popup reads cache → renders instantly
5. User expands a project card → if dashboards/shortcuts not cached, popup calls API directly via `lib/api.ts` (popup has same permissions as background) → updates cache via `lib/storage.ts`. No message passing needed — both popup and background share the same storage.
6. User clicks a link → `chrome.tabs.create()` opens in new tab, link added to recents

### Recents Behavior

- FIFO eviction: when a new item is added and list exceeds 10 items, oldest is removed
- Deduplication: clicking the same link again moves it to the top (updates timestamp) rather than creating a duplicate
- Each recent stores: name, full URL, icon emoji, project name, timestamp

### MV3 Service Worker Lifecycle

Chrome MV3 service workers are ephemeral — they can be terminated after ~30 seconds of inactivity and restarted on events. Design considerations:
- **Alarms survive restarts:** `chrome.alarms` persists across service worker restarts. The alarm handler re-reads settings from storage on each wake.
- **No in-memory state:** All state lives in `chrome.storage`. The service worker is stateless between alarm fires.
- **Concurrent refresh guard:** Before starting a refresh, set a `refreshInProgress` flag in storage with a timestamp. Clear it when done. If the flag exists and is <2 minutes old, skip the refresh (previous one is still running or was interrupted). If >2 minutes old, consider it stale and proceed.
- **Popup-initiated fetches** happen directly in the popup's JS context (not via message passing to background), so service worker termination doesn't affect them.

### Permissions (in Plasmo manifest config)

The existing `package.json` has `"host_permissions": ["https://*/*"]` (overly broad). Narrow this to:

```json
{
  "permissions": ["storage", "alarms"],
  "host_permissions": ["https://*.posthog.com/*"],
  "optional_host_permissions": ["https://*/*"]
}
```

- `storage` and `alarms` are new additions to the manifest (not currently declared)
- `host_permissions` narrowed from `https://*/*` to PostHog cloud domains only
- `optional_host_permissions` allows self-hosted instances — the options page must explicitly call `chrome.permissions.request({ origins: [userUrl] })` inside a click handler when the user enters a non-posthog.com URL

## Popup UI

### Layout (top to bottom)

1. **Header:** PostHog logo/name + settings gear icon
2. **Search bar:** Case-insensitive substring match across project names, dashboard names, shortcut labels, and tool names (e.g., typing "replay" surfaces Session Replay links). Filters the tree in-place (hides non-matching orgs/projects, auto-expands matches). Searches all orgs simultaneously.
3. **Recents section:** Last 10 visited links, showing item name + icon + project context. Hidden when search is active.
4. **Org-grouped project list:** Each org is a section header, projects are collapsible cards

### Expanded Project Card

- **Tool links:** 2-column grid of configurable tool links. "Dashboards" link has an `href` to the dashboards list page (for right-click → "Open in new tab") but left-click is intercepted to toggle the dashboards foldout instead of navigating.
- **Dashboards foldout:** Expands below the tool grid, lists all dashboards as individual links
- **Shortcuts foldout:** Lists all PostHog sidebar shortcuts for the project

### Loading States

| State | UI |
|---|---|
| Initial load (no cache, API key just set) | Popup shows a spinner with "Loading your projects..." |
| Expanding a project (lazy loading dashboards/shortcuts) | Project card shows inline spinner below the tool grid |
| Background refresh in progress | No visible indicator (cache is already populated, update happens silently) |
| Background refresh failed | Subtle "Last updated X ago" text turns amber |

### UI State

- Expanded/collapsed state of project cards persisted in `Settings.expandedProjects` in `chrome.storage.local`
- Last-expanded project is auto-expanded on popup open for quick access

### Theming

- Follows OS light/dark preference via `prefers-color-scheme`
- Light mode: white background, gray borders, blue links
- Dark mode: dark background (#1d1f27), subtle borders, light blue links

### Dimensions

- Width: ~320px (standard popup width)
- Max height: ~500px with scrolling

## Options Page

All settings are saved automatically on change (no save button). Changes to API key or instance URL trigger an immediate data refresh.

### Connection Section

- PostHog instance URL (text input, default `https://us.posthog.com`)
- Personal API key (password input with show/hide toggle)
- "Test Connection" button — calls `GET /api/organizations/` and shows success (org count) or error message
- If the entered URL is not `*.posthog.com`, show a "Grant Access" button that calls `chrome.permissions.request()` for that origin. This must be triggered by a user click (Chrome requirement for optional permissions).

### Visible Tools Section

- Checklist with toggles for each tool category (all on by default):
  - Dashboards, Insights, Web Analytics, Session Replay, Error Tracking, Experiments, Feature Flags, Surveys, Notebooks, SQL, Persons, Cohorts, Events, Data Management, Annotations, Toolbar
- Toggling a tool "off" hides it from the popup tool grid entirely

### Cache Section

- "Last refreshed: X ago" indicator
- "Refresh Now" button
- Refresh interval selector (1 min / 5 min / 15 min / 30 min), stored in settings, default 5 min

## Error Handling

| State | Behavior |
|---|---|
| No API key configured | Popup shows welcome message + button to open settings |
| Invalid API key | Options page shows error on test; popup shows auth error with settings link |
| Network error / PostHog down | Show cached data if available + "refresh failed" banner. No cache → "Could not reach PostHog" |
| Shortcuts endpoint returns 404 | Skip shortcuts for that project; show dashboards and tool links normally |
| Empty project (no dashboards/shortcuts) | Tool links still shown; dashboard/shortcuts sections hidden |
| Search with no results | "No matches found" message |
| Many orgs/projects | Scrollable popup, max height ~500px |

## Tech Stack

- **Framework:** Plasmo 0.90.5
- **UI:** React 18 + TypeScript 5
- **Manifest:** Chrome MV3
- **Package manager:** pnpm (existing lockfile and CI/CD use pnpm)
- **Build:** Plasmo CLI (`pnpm dev` / `pnpm build`)
- **CI/CD:** GitHub Actions workflow for browser store publishing (needs Node.js version update from 16 to 20)
