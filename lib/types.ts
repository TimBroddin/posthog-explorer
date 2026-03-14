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
  ref?: string
  href?: string
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
  label: string
  href: string
  type: string
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
  projectToolOverrides: Record<number, string[]> // projectId → tool IDs (overrides global visibleTools)
  orgOrder: string[]       // ordered org IDs — orgs not listed appear at the end
  projectOrder: number[]   // ordered project IDs — projects not listed appear at the end
  hiddenOrgs: string[]     // org IDs to hide from popup
  hiddenProjects: number[] // project IDs to hide from popup
  flatList: boolean        // show projects as flat list without org grouping
}

export interface ToolDefinition {
  id: string
  name: string
  icon: string
  path: string
}
