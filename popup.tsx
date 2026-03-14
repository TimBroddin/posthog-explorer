import { useCallback, useEffect, useMemo, useState } from "react"

import { fetchProjectDetails } from "~lib/api"
import { TOOLS } from "~lib/constants"
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
  StarredDashboard
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
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<"all" | "recent">("all")

  useEffect(() => {
    async function load() {
      const [s, c, r] = await Promise.all([getSettings(), getCachedData(), getRecents()])
      setSettings(s)
      setCache(c)
      setRecents(r)
      setExpandedProjects(s.expandedProjects)
      setLoading(false)
    }
    load()
  }, [])

  useEffect(() => {
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.cachedData?.newValue) setCache(changes.cachedData.newValue)
      if (changes.recents?.newValue) setRecents(changes.recents.newValue)
      if (changes.settings?.newValue) setSettings(changes.settings.newValue)
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])

  const handleOpenSettings = useCallback(() => { chrome.runtime.openOptionsPage() }, [])

  const handleToggleProject = useCallback(
    async (projectId: number) => {
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
                  p.id === projectId ? { ...p, dashboards: details.dashboards } : p
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
    [settings, cache]
  )

  const handleOpenLink = useCallback(
    async (e: React.MouseEvent, url: string, name: string, icon: string, projectName: string) => {
      e.preventDefault()
      await chrome.tabs.create({ url })
      const newRecents = await addRecent({ name, url, icon, projectName, timestamp: Date.now() })
      setRecents(newRecents)
    },
    []
  )

  const handleToggleStar = useCallback(
    async (projectId: number, projectName: string, dashboardId: number, dashboardName: string) => {
      if (!settings) return
      const starred = [...settings.starredDashboards]
      const idx = starred.findIndex((s) => s.projectId === projectId && s.dashboardId === dashboardId)
      if (idx !== -1) {
        starred.splice(idx, 1)
      } else {
        starred.push({ projectId, projectName, dashboardId, dashboardName })
      }
      const updated = await saveSettings({ starredDashboards: starred })
      setSettings(updated)
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
          if (visibleToolNames.some((t) => t.name.toLowerCase().includes(q))) return true
          return false
        })
        if (filteredProjects.length === 0) return null
        return { ...org, projects: filteredProjects }
      })
      .filter(Boolean) as CachedOrganization[]
  }, [sortedOrgs, search, settings])

  if (loading) return <div className="spinner">Loading...</div>

  if (!settings?.apiKey) {
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
      <div>
        <Header onSettings={handleOpenSettings} />
        <div className="empty-state"><h3>Could not reach PostHog</h3><p>{cache.lastError}</p>
          <button onClick={handleOpenSettings}>Check Settings</button></div>
      </div>
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
      visibleTools={settings.projectToolOverrides[project.id] ?? settings.visibleTools}
      starredDashboards={settings.starredDashboards}
      onToggle={() => handleToggleProject(project.id)}
      onToggleDashboards={() =>
        setShowDashboards((prev) => {
          const next = new Set(prev)
          next.has(project.id) ? next.delete(project.id) : next.add(project.id)
          return next
        })
      }
      onToggleStar={handleToggleStar}
      onOpenLink={handleOpenLink}
      buildUrl={buildUrl}
    />
  )

  return (
    <div>
      <Header onSettings={handleOpenSettings} />

      {/* Tabs */}
      <div className="tabs">
        <button className={`tab ${activeTab === "all" ? "is-active" : ""}`} onClick={() => setActiveTab("all")}>All</button>
        <button className={`tab ${activeTab === "recent" ? "is-active" : ""}`} onClick={() => setActiveTab("recent")}>Recent</button>
      </div>

      {activeTab === "all" && (
        <>
          <div className="search">
            <input type="text" placeholder="Search projects, dashboards..."
              value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
          </div>

          {cache.lastError && cache.lastRefreshed > 0 && (
            <div className="error-banner">Last updated {formatTimeAgo(cache.lastRefreshed)} — refresh failed</div>
          )}

          {/* Starred dashboards */}
          {!isSearching && settings.starredDashboards.length > 0 && (
            <>
              <div className="section-header">Starred</div>
              <div className="recents">
                {settings.starredDashboards.map((s) => {
                  const url = buildUrl(s.projectId, `dashboard/${s.dashboardId}`)
                  return (
                    <a key={`${s.projectId}-${s.dashboardId}`} className="recent-item" href={url}
                      onClick={(e) => handleOpenLink(e, url, s.dashboardName, "📊", s.projectName)}>
                      <span className="recent-icon">⭐</span>
                      <span className="recent-name">{s.dashboardName}</span>
                      <span className="recent-project">{s.projectName}</span>
                    </a>
                  )
                })}
              </div>
            </>
          )}

          {/* Projects */}
          {hasResults ? (
            settings.flatList ? (
              <div className="org-group">
                {filteredOrgs.flatMap((org) => org.projects.map(renderProjectCard))}
              </div>
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
      <div className="header-logo">P</div>
      <span className="header-title">PostHog Explorer</span>
      <button className="header-settings" onClick={onSettings} title="Settings">⚙</button>
    </div>
  )
}

function ProjectCard({
  project, expanded, loading, showDashboards, visibleTools, starredDashboards,
  onToggle, onToggleDashboards, onToggleStar, onOpenLink, buildUrl
}: {
  project: CachedProject
  expanded: boolean
  loading: boolean
  showDashboards: boolean
  visibleTools: string[]
  starredDashboards: StarredDashboard[]
  onToggle: () => void
  onToggleDashboards: () => void
  onToggleStar: (projectId: number, projectName: string, dashboardId: number, dashboardName: string) => void
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
              if (tool.id === "dashboards") {
                return (
                  <a key={tool.id} className="tool-link" href={url}
                    onClick={(e) => { e.preventDefault(); onToggleDashboards() }}>
                    {tool.icon} {tool.name} {showDashboards ? "▴" : "▾"}
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

          {showDashboards && project.dashboards && project.dashboards.length > 0 && (
            <div className="foldout">
              <div className="foldout-header">Dashboards</div>
              {project.dashboards.map((dashboard) => {
                const url = buildUrl(project.id, `dashboard/${dashboard.id}`)
                const isStarred = starredDashboards.some(
                  (s) => s.projectId === project.id && s.dashboardId === dashboard.id
                )
                return (
                  <div key={dashboard.id} className="foldout-row">
                    <a className="foldout-item" href={url}
                      onClick={(e) => onOpenLink(e, url, dashboard.name, "📊", project.name)}>
                      {dashboard.name}
                    </a>
                    <button
                      className={`star-btn ${isStarred ? "is-starred" : ""}`}
                      onClick={() => onToggleStar(project.id, project.name, dashboard.id, dashboard.name)}
                      title={isStarred ? "Unstar" : "Star"}>
                      {isStarred ? "★" : "☆"}
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
