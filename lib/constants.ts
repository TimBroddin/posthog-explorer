import type { Settings, ToolDefinition } from "./types"

export const TOOLS: ToolDefinition[] = [
  { id: "dashboards", name: "Dashboards", icon: "📊", path: "dashboards" },
  { id: "insights", name: "Product Analytics", icon: "💡", path: "insights" },
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
  projectToolOverrides: {},
  orgOrder: [],
  projectOrder: [],
  hiddenOrgs: [],
  hiddenProjects: [],
  flatList: false,
  starredItems: [],
  demoMode: false
}

export const MAX_RECENTS = 10

export const REFRESH_ALARM_NAME = "posthog-refresh"

export const REFRESH_LOCK_MAX_AGE_MS = 2 * 60 * 1000 // 2 minutes

export const API_CALL_DELAY_MS = 200 // delay between API calls to avoid bursts

// Demo data for screenshot mode
export const DEMO_DATA: import("./types").CachedData = {
  organizations: [
    {
      id: "demo-org-1",
      name: "Hogflix Inc",
      projects: [
        {
          id: 1001,
          name: "Hogflix Web App",
          dashboards: [
            { id: 1, name: "KPIs & North Star Metrics" },
            { id: 2, name: "Acquisition Funnel" },
            { id: 3, name: "Retention Overview" },
            { id: 4, name: "Revenue & Subscriptions" }
          ],
          insights: [
            { id: 1, shortId: "abc123", name: "Weekly Active Users" },
            { id: 2, shortId: "def456", name: "Signup → Activation Funnel" },
            { id: 3, shortId: "ghi789", name: "Feature Adoption by Cohort" },
            { id: 4, shortId: "jkl012", name: "Churn Risk Segments" }
          ]
        },
        {
          id: 1002,
          name: "Hogflix Mobile",
          dashboards: [
            { id: 5, name: "Mobile Engagement" },
            { id: 6, name: "App Performance" }
          ],
          insights: [
            { id: 5, shortId: "mno345", name: "Session Duration by Platform" },
            { id: 6, shortId: "pqr678", name: "Push Notification CTR" }
          ]
        }
      ]
    },
    {
      id: "demo-org-2",
      name: "HogDev Labs",
      projects: [
        {
          id: 1003,
          name: "Internal Tools",
          dashboards: [
            { id: 7, name: "Developer Productivity" },
            { id: 8, name: "CI/CD Pipeline Health" }
          ],
          insights: [
            { id: 7, shortId: "stu901", name: "Deploy Frequency" },
            { id: 8, shortId: "vwx234", name: "Incident Response Time" }
          ]
        }
      ]
    }
  ],
  lastRefreshed: Date.now()
}

export const DEMO_SETTINGS: import("./types").Settings = {
  apiKey: "demo",
  instanceUrl: "https://us.posthog.com",
  refreshIntervalMinutes: 5,
  visibleTools: TOOLS.map((t) => t.id),
  expandedProjects: [1001],
  projectToolOverrides: {},
  orgOrder: [],
  projectOrder: [],
  hiddenOrgs: [],
  hiddenProjects: [],
  flatList: false,
  starredItems: [
    { type: "dashboard", projectId: 1001, projectName: "Hogflix Web App", itemId: 1, itemName: "KPIs & North Star Metrics" },
    { type: "insight", projectId: 1001, projectName: "Hogflix Web App", itemId: 2, itemName: "Signup → Activation Funnel", shortId: "def456" }
  ],
  demoMode: true
}

export const DEMO_RECENTS: import("./types").RecentItem[] = [
  { name: "KPIs & North Star Metrics", url: "#", icon: "📊", projectName: "Hogflix Web App", timestamp: Date.now() - 60000 },
  { name: "Weekly Active Users", url: "#", icon: "💡", projectName: "Hogflix Web App", timestamp: Date.now() - 120000 },
  { name: "Mobile Engagement", url: "#", icon: "📊", projectName: "Hogflix Mobile", timestamp: Date.now() - 300000 }
]
