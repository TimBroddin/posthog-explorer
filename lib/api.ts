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
