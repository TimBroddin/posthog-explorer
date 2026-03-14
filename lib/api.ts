import { API_CALL_DELAY_MS } from "./constants"
import type {
  ApiDashboard,
  ApiInsight,
  ApiOrganization,
  ApiPaginatedResponse,
  CachedOrganization,
  Dashboard,
  Insight
} from "./types"
import { delay } from "./utils"

async function apiFetch<T>(
  instanceUrl: string,
  apiKey: string,
  path: string
): Promise<T> {
  const url = `${instanceUrl.replace(/\/$/, "")}${path}`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` }
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
    if (currentPath) await delay(API_CALL_DELAY_MS)
  }
  return all
}

export async function fetchOrganizations(
  instanceUrl: string,
  apiKey: string
): Promise<CachedOrganization[]> {
  const orgs = await apiFetch<ApiPaginatedResponse<ApiOrganization>>(
    instanceUrl, apiKey, "/api/organizations/"
  )
  return orgs.results.map((org) => ({
    id: org.id,
    name: org.name,
    projects: org.teams.map((team) => ({ id: team.id, name: team.name }))
  }))
}

export async function fetchDashboards(
  instanceUrl: string, apiKey: string, projectId: number
): Promise<Dashboard[]> {
  const dashboards = await fetchAllPages<ApiDashboard>(
    instanceUrl, apiKey, `/api/projects/${projectId}/dashboards/?limit=100`
  )
  return dashboards.map((d) => ({ id: d.id, name: d.name }))
}

export async function fetchInsights(
  instanceUrl: string, apiKey: string, projectId: number
): Promise<Insight[]> {
  const insights = await fetchAllPages<ApiInsight>(
    instanceUrl, apiKey, `/api/projects/${projectId}/insights/?saved=true&limit=100`
  )
  return insights.map((i) => ({
    id: i.id,
    shortId: i.short_id,
    name: i.name || i.derived_name || `Insight ${i.short_id}`
  }))
}

export async function fetchProjectDetails(
  instanceUrl: string, apiKey: string, projectId: number
): Promise<{ dashboards: Dashboard[]; insights: Insight[] }> {
  const dashboards = await fetchDashboards(instanceUrl, apiKey, projectId)
  await delay(API_CALL_DELAY_MS)
  const insights = await fetchInsights(instanceUrl, apiKey, projectId)
  return { dashboards, insights }
}

export async function testConnection(
  instanceUrl: string, apiKey: string
): Promise<{ success: boolean; orgCount?: number; error?: string }> {
  try {
    const orgs = await fetchOrganizations(instanceUrl, apiKey)
    return { success: true, orgCount: orgs.length }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" }
  }
}
