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
  expandedProjects: [],
  projectToolOverrides: {}
}

export const MAX_RECENTS = 10

export const REFRESH_ALARM_NAME = "posthog-refresh"

export const REFRESH_LOCK_MAX_AGE_MS = 2 * 60 * 1000 // 2 minutes

export const API_CALL_DELAY_MS = 200 // delay between API calls to avoid bursts
