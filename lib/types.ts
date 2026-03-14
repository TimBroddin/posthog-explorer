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
