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

export interface ApiInsight {
  id: number
  short_id: string
  name: string
  derived_name: string | null
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
  insights?: Insight[]       // optional: lazy loaded on first expand
}

export interface Dashboard {
  id: number
  name: string
}

export interface Insight {
  id: number
  shortId: string
  name: string
}

export interface StarredItem {
  type: "dashboard" | "insight"
  projectId: number
  projectName: string
  itemId: number
  itemName: string
  shortId?: string  // for insights URL
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
  starredItems: StarredItem[]
}

export interface ToolDefinition {
  id: string
  name: string
  icon: string
  path: string
}
