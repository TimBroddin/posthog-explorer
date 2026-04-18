import { useCallback, useEffect, useMemo, useState } from "react"

import { fetchProjectDetails } from "~lib/api"
import { DEMO_DATA, DEMO_RECENTS, TOOLS } from "~lib/constants"
import {
  addRecent,
  getCachedData,
  getRecents,
  getSettings,
  saveCachedData,
  saveSettings,
  toggleExpandedProject
} from "~lib/storage"
import type {
  CachedData,
  CachedOrganization,
  CachedProject,
  RecentItem,
  Settings,
  StarredItem
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
  const [showInsights, setShowInsights] = useState<Set<number>>(new Set())
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTabState] = useState<"all" | "starred" | "recent">("all")

  const demoMode = settings?.demoMode ?? false

  const setActiveTab = useCallback((tab: "all" | "starred" | "recent") => {
    setActiveTabState(tab)
    if (!demoMode) chrome.storage.local.set({ activePopupTab: tab })
  }, [demoMode])

  useEffect(() => {
    async function load() {
      const [s, c, r, tabResult] = await Promise.all([
        getSettings(), getCachedData(), getRecents(),
        chrome.storage.local.get("activePopupTab")
      ])
      if (tabResult.activePopupTab) setActiveTabState(tabResult.activePopupTab)
      if (s.demoMode) {
        setSettings(s)
        setCache(DEMO_DATA)
        setRecents(DEMO_RECENTS)
        setExpandedProjects(s.expandedProjects.length > 0 ? s.expandedProjects : [1001])
      } else {
        setSettings(s)
        setCache(c)
        setRecents(r)
        setExpandedProjects(s.expandedProjects)
      }
      setLoading(false)
    }
    load()
  }, [])

  useEffect(() => {
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.settings?.newValue) {
        const newSettings = changes.settings.newValue as Settings
        setSettings(newSettings)
        if (newSettings.demoMode) {
          setCache(DEMO_DATA)
          setRecents(DEMO_RECENTS)
          setExpandedProjects(newSettings.expandedProjects.length > 0 ? newSettings.expandedProjects : [1001])
        }
      }
      if (changes.cachedData?.newValue && !demoMode) setCache(changes.cachedData.newValue)
      if (changes.recents?.newValue && !demoMode) setRecents(changes.recents.newValue)
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [demoMode])

  const handleOpenSettings = useCallback(() => { chrome.runtime.openOptionsPage() }, [])

  const handleToggleProject = useCallback(
    async (projectId: number) => {
      if (demoMode) {
        setExpandedProjects((prev) =>
          prev.includes(projectId) ? prev.filter((id) => id !== projectId) : [...prev, projectId]
        )
        return
      }
      const newExpanded = await toggleExpandedProject(projectId)
      setExpandedProjects(newExpanded)
      if (newExpanded.includes(projectId) && settings && cache) {
        const project = cache.organizations.flatMap((o) => o.projects).find((p) => p.id === projectId)
        if (project && !project.dashboards) {
          setLoadingProjects((prev) => new Set([...prev, projectId]))
          try {
            const details = await fetchProjectDetails(settings.instanceUrl, settings.apiKey, projectId)
            const updated: CachedData = {
              ...cache,
              organizations: cache.organizations.map((org) => ({
                ...org,
                projects: org.projects.map((p) =>
                  p.id === projectId ? { ...p, dashboards: details.dashboards, insights: details.insights } : p
                )
              }))
            }
            setCache(updated)
            await saveCachedData(updated)
          } catch (e) {
            console.error("Failed to load project details:", e)
          } finally {
            setLoadingProjects((prev) => { const next = new Set(prev); next.delete(projectId); return next })
          }
        }
      }
    },
    [settings, cache, demoMode]
  )

  const handleOpenLink = useCallback(
    async (e: React.MouseEvent, url: string, name: string, icon: string, projectName: string) => {
      e.preventDefault()
      if (demoMode) return
      await addRecent({ name, url, icon, projectName, timestamp: Date.now() })
      chrome.tabs.create({ url })
    },
    [demoMode]
  )

  const handleToggleStar = useCallback(
    async (item: StarredItem) => {
      if (!settings) return
      const starred = [...settings.starredItems]
      const idx = starred.findIndex((s) => s.type === item.type && s.projectId === item.projectId && s.itemId === item.itemId)
      if (idx !== -1) starred.splice(idx, 1)
      else starred.push(item)
      if (demoMode) {
        setSettings({ ...settings, starredItems: starred })
        return
      }
      const updated = await saveSettings({ starredItems: starred })
      setSettings(updated)
    },
    [settings, demoMode]
  )

  const isStarred = useCallback(
    (type: "dashboard" | "insight", projectId: number, itemId: number) => {
      return settings?.starredItems.some((s) => s.type === type && s.projectId === projectId && s.itemId === itemId) ?? false
    },
    [settings]
  )

  const buildUrl = useCallback(
    (projectId: number, path: string) => {
      if (!settings) return "#"
      return `${settings.instanceUrl.replace(/\/$/, "")}/project/${projectId}/${path}`
    },
    [settings]
  )

  const sortedOrgs = useMemo(() => {
    if (!cache?.organizations || !settings) return []
    const visible = cache.organizations
      .filter((org) => !settings.hiddenOrgs.includes(org.id))
      .map((org) => ({ ...org, projects: org.projects.filter((p) => !settings.hiddenProjects.includes(p.id)) }))
      .filter((org) => org.projects.length > 0)
    visible.sort((a, b) => {
      const ai = settings.orgOrder.indexOf(a.id), bi = settings.orgOrder.indexOf(b.id)
      if (ai === -1 && bi === -1) return a.name.localeCompare(b.name)
      if (ai === -1) return 1; if (bi === -1) return -1; return ai - bi
    })
    for (const org of visible) {
      org.projects.sort((a, b) => {
        const ai = settings.projectOrder.indexOf(a.id), bi = settings.projectOrder.indexOf(b.id)
        if (ai === -1 && bi === -1) return a.name.localeCompare(b.name)
        if (ai === -1) return 1; if (bi === -1) return -1; return ai - bi
      })
    }
    return visible
  }, [cache, settings])

  const filteredOrgs = useMemo(() => {
    if (!search.trim()) return sortedOrgs
    const q = search.toLowerCase()
    const visibleToolNames = TOOLS.filter((t) => settings?.visibleTools.includes(t.id))
    return sortedOrgs
      .map((org) => {
        const filteredProjects = org.projects.filter((project) => {
          if (project.name.toLowerCase().includes(q)) return true
          if (project.dashboards?.some((d) => d.name.toLowerCase().includes(q))) return true
          if (project.insights?.some((i) => i.name.toLowerCase().includes(q))) return true
          if (visibleToolNames.some((t) => t.name.toLowerCase().includes(q))) return true
          return false
        })
        if (filteredProjects.length === 0) return null
        return { ...org, projects: filteredProjects }
      })
      .filter(Boolean) as CachedOrganization[]
  }, [sortedOrgs, search, settings])

  // Group starred items by project
  const starredByProject = useMemo(() => {
    if (!settings) return new Map<number, { projectName: string; items: StarredItem[] }>()
    const map = new Map<number, { projectName: string; items: StarredItem[] }>()
    for (const item of settings.starredItems) {
      if (!map.has(item.projectId)) {
        map.set(item.projectId, { projectName: item.projectName, items: [] })
      }
      map.get(item.projectId)!.items.push(item)
    }
    return map
  }, [settings])

  if (loading) return <div className="spinner">Loading...</div>

  if (!settings?.apiKey && !demoMode) {
    return (
      <div className="empty-state">
        <h3>Welcome to PostHog Explorer</h3>
        <p>Set up your API key to get started.</p>
        <button onClick={handleOpenSettings}>Open Settings</button>
      </div>
    )
  }

  if (cache?.lastError?.includes("401")) {
    return (
      <div className="empty-state">
        <h3>Authentication Failed</h3>
        <p>Your API key appears to be invalid. Check your settings.</p>
        <button onClick={handleOpenSettings}>Open Settings</button>
      </div>
    )
  }

  if (!cache || (cache.organizations.length === 0 && !cache.lastError)) {
    return (<div><Header onSettings={handleOpenSettings} /><div className="spinner">Loading your projects...</div></div>)
  }

  if (cache.organizations.length === 0 && cache.lastError) {
    return (
      <div><Header onSettings={handleOpenSettings} />
        <div className="empty-state"><h3>Could not reach PostHog</h3><p>{cache.lastError}</p>
          <button onClick={handleOpenSettings}>Check Settings</button></div></div>
    )
  }

  const hasResults = filteredOrgs.length > 0
  const isSearching = search.trim().length > 0

  const renderProjectCard = (project: CachedProject) => (
    <ProjectCard
      key={project.id}
      project={project}
      expanded={expandedProjects.includes(project.id) || isSearching}
      loading={loadingProjects.has(project.id)}
      showDashboards={showDashboards.has(project.id)}
      showInsights={showInsights.has(project.id)}
      visibleTools={settings.projectToolOverrides[project.id] ?? settings.visibleTools}
      isStarred={isStarred}
      onToggle={() => handleToggleProject(project.id)}
      onToggleDashboards={() => {
        setShowDashboards((prev) => {
          const next = new Set(prev); next.has(project.id) ? next.delete(project.id) : next.add(project.id); return next
        })
        setShowInsights((prev) => { const next = new Set(prev); next.delete(project.id); return next })
      }}
      onToggleInsights={() => {
        setShowInsights((prev) => {
          const next = new Set(prev); next.has(project.id) ? next.delete(project.id) : next.add(project.id); return next
        })
        setShowDashboards((prev) => { const next = new Set(prev); next.delete(project.id); return next })
      }}
      onToggleStar={handleToggleStar}
      onOpenLink={handleOpenLink}
      buildUrl={buildUrl}
    />
  )

  return (
    <div>
      <Header onSettings={handleOpenSettings} />

      <div className="tabs">
        <button className={`tab ${activeTab === "all" ? "is-active" : ""}`} onClick={() => setActiveTab("all")}>All</button>
        <button className={`tab ${activeTab === "starred" ? "is-active" : ""}`} onClick={() => setActiveTab("starred")}>
          Starred
        </button>
        <button className={`tab ${activeTab === "recent" ? "is-active" : ""}`} onClick={() => setActiveTab("recent")}>Recent</button>
      </div>

      {activeTab === "all" && (
        <>
          <div className="search">
            <input type="text" placeholder="Search projects, dashboards, insights..."
              value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
          </div>

          {cache.lastError && cache.lastRefreshed > 0 && (
            <div className="error-banner">Last updated {formatTimeAgo(cache.lastRefreshed)} — refresh failed</div>
          )}

          {hasResults ? (
            settings.flatList ? (
              <div className="org-group">{filteredOrgs.flatMap((org) => org.projects.map(renderProjectCard))}</div>
            ) : (
              filteredOrgs.map((org) => (
                <div key={org.id}>
                  <div className="section-header">{org.name}</div>
                  <div className="org-group">{org.projects.map(renderProjectCard)}</div>
                </div>
              ))
            )
          ) : isSearching ? (
            <div className="no-results">No matches found</div>
          ) : null}
        </>
      )}

      {activeTab === "starred" && (
        <>
          {starredByProject.size > 0 ? (
            Array.from(starredByProject.entries()).map(([projectId, { projectName, items }]) => (
              <div key={projectId}>
                <div className="section-header">{projectName}</div>
                <div className="recents">
                  {items.map((item) => {
                    const url = item.type === "dashboard"
                      ? buildUrl(item.projectId, `dashboard/${item.itemId}`)
                      : buildUrl(item.projectId, `insights/${item.shortId}`)
                    const icon = item.type === "dashboard" ? "📊" : "💡"
                    return (
                      <div key={`${item.type}-${item.itemId}`} className="starred-row">
                        <a className="recent-item" href={url}
                          onClick={(e) => handleOpenLink(e, url, item.itemName, icon, item.projectName)}>
                          <span className="recent-icon">{icon}</span>
                          <span className="recent-name">{item.itemName}</span>
                        </a>
                        <button className="star-btn is-starred"
                          onClick={() => handleToggleStar(item)} title="Unstar">★</button>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))
          ) : (
            <div className="no-results">No starred items yet. Star dashboards or insights from a project.</div>
          )}
        </>
      )}

      {activeTab === "recent" && (
        <>
          {recents.length > 0 ? (
            <div className="recents" style={{ padding: "8px 14px" }}>
              {recents.map((item, i) => (
                <a key={i} className="recent-item" href={item.url}
                  onClick={(e) => handleOpenLink(e, item.url, item.name, item.icon, item.projectName)}>
                  <span className="recent-icon">{item.icon}</span>
                  <span className="recent-name">{item.name}</span>
                  <span className="recent-project">{item.projectName}</span>
                </a>
              ))}
            </div>
          ) : (
            <div className="no-results">No recent visits yet</div>
          )}
        </>
      )}
    </div>
  )
}

function Header({ onSettings }: { onSettings: () => void }) {
  return (
    <div className="header">
      <span className="header-logo">🦔</span>
      <span className="header-title">PostHog Explorer</span>
      <button className="header-settings" onClick={onSettings} title="Settings">⚙</button>
    </div>
  )
}

function ProjectCard({
  project, expanded, loading, showDashboards, showInsights, visibleTools, isStarred,
  onToggle, onToggleDashboards, onToggleInsights, onToggleStar, onOpenLink, buildUrl
}: {
  project: CachedProject
  expanded: boolean
  loading: boolean
  showDashboards: boolean
  showInsights: boolean
  visibleTools: string[]
  isStarred: (type: "dashboard" | "insight", projectId: number, itemId: number) => boolean
  onToggle: () => void
  onToggleDashboards: () => void
  onToggleInsights: () => void
  onToggleStar: (item: StarredItem) => void
  onOpenLink: (e: React.MouseEvent, url: string, name: string, icon: string, projectName: string) => void
  buildUrl: (projectId: number, path: string) => string
}) {
  const tools = TOOLS.filter((t) => visibleTools.includes(t.id))

  return (
    <div className="project-card">
      <div className="project-header" onClick={onToggle}>
        <span className="project-name">{project.name}</span>
        <span className="project-chevron">{expanded ? "▼" : "▶"}</span>
      </div>

      {expanded && (
        <div className="project-content">
          <div className="tool-grid">
            {tools.map((tool) => {
              const url = buildUrl(project.id, tool.path)
              // Dashboards and Product Analytics are dropdowns
              if (tool.id === "dashboards") {
                return (
                  <a key={tool.id} className="tool-link" href={url}
                    onClick={(e) => { e.preventDefault(); onToggleDashboards() }}>
                    {tool.icon} {tool.name} {showDashboards ? "▴" : "▾"}
                  </a>
                )
              }
              if (tool.id === "insights") {
                return (
                  <a key={tool.id} className="tool-link" href={url}
                    onClick={(e) => { e.preventDefault(); onToggleInsights() }}>
                    {tool.icon} {tool.name} {showInsights ? "▴" : "▾"}
                  </a>
                )
              }
              return (
                <a key={tool.id} className="tool-link" href={url}
                  onClick={(e) => onOpenLink(e, url, tool.name, tool.icon, project.name)}>
                  {tool.icon} {tool.name}
                </a>
              )
            })}
          </div>

          {loading && <div className="spinner">Loading details...</div>}

          {/* Dashboards foldout */}
          {showDashboards && project.dashboards && project.dashboards.length > 0 && (
            <div className="foldout">
              <div className="foldout-header">Dashboards</div>
              {project.dashboards.map((dashboard) => {
                const url = buildUrl(project.id, `dashboard/${dashboard.id}`)
                const starred = isStarred("dashboard", project.id, dashboard.id)
                return (
                  <div key={dashboard.id} className="foldout-row">
                    <a className="foldout-item" href={url}
                      onClick={(e) => onOpenLink(e, url, dashboard.name, "📊", project.name)}>
                      {dashboard.name}
                    </a>
                    <button className={`star-btn ${starred ? "is-starred" : ""}`}
                      onClick={() => onToggleStar({
                        type: "dashboard", projectId: project.id, projectName: project.name,
                        itemId: dashboard.id, itemName: dashboard.name
                      })} title={starred ? "Unstar" : "Star"}>
                      {starred ? "★" : "☆"}
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Insights foldout */}
          {showInsights && project.insights && project.insights.length > 0 && (
            <div className="foldout">
              <div className="foldout-header">Product Analytics</div>
              {project.insights.map((insight) => {
                const url = buildUrl(project.id, `insights/${insight.shortId}`)
                const starred = isStarred("insight", project.id, insight.id)
                return (
                  <div key={insight.id} className="foldout-row">
                    <a className="foldout-item" href={url}
                      onClick={(e) => onOpenLink(e, url, insight.name, "💡", project.name)}>
                      {insight.name}
                    </a>
                    <button className={`star-btn ${starred ? "is-starred" : ""}`}
                      onClick={() => onToggleStar({
                        type: "insight", projectId: project.id, projectName: project.name,
                        itemId: insight.id, itemName: insight.name, shortId: insight.shortId
                      })} title={starred ? "Unstar" : "Star"}>
                      {starred ? "★" : "☆"}
                    </button>
                  </div>
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
