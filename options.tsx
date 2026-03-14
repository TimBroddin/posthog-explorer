import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { testConnection } from "~lib/api"
import { TOOLS } from "~lib/constants"
import { getCachedData, getSettings, saveSettings } from "~lib/storage"
import type { CachedData, CachedOrganization, Settings } from "~lib/types"
import { formatTimeAgo } from "~lib/utils"

import "./options.css"

// --- Drag handle SVG ---
function DragHandleIcon() {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
      <circle cx="2" cy="2" r="1.5" />
      <circle cx="8" cy="2" r="1.5" />
      <circle cx="2" cy="7" r="1.5" />
      <circle cx="8" cy="7" r="1.5" />
      <circle cx="2" cy="12" r="1.5" />
      <circle cx="8" cy="12" r="1.5" />
    </svg>
  )
}

// --- Sortable item components ---

function SortableOrgItem({
  org,
  isHidden,
  onToggleVisibility
}: {
  org: CachedOrganization
  isHidden: boolean
  onToggleVisibility: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: org.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined
  }
  return (
    <div ref={setNodeRef} style={style} className="sortable-item sortable-org">
      <button className="drag-handle" {...attributes} {...listeners}><DragHandleIcon /></button>
      <span className={`sortable-name ${isHidden ? "is-dimmed" : ""}`}>{org.name}</span>
      <span className="sortable-meta">org</span>
      <button className={`toggle-pill ${isHidden ? "is-off" : "is-on"}`} onClick={onToggleVisibility}>
        {isHidden ? "Hidden" : "Visible"}
      </button>
    </div>
  )
}

function SortableProjectItem({
  project, orgName, isHidden, hasOverride, isOverrideExpanded,
  onToggleVisibility, onToggleOverrideExpand, overrideContent
}: {
  project: { id: number; name: string }
  orgName: string
  isHidden: boolean
  hasOverride: boolean
  isOverrideExpanded: boolean
  onToggleVisibility: () => void
  onToggleOverrideExpand: () => void
  overrideContent: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `project-${project.id}` })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined
  }
  return (
    <div ref={setNodeRef} style={style} className="sortable-item-wrap">
      <div className="sortable-item sortable-project">
        <button className="drag-handle" {...attributes} {...listeners}><DragHandleIcon /></button>
        <span className={`sortable-name ${isHidden ? "is-dimmed" : ""}`}>{project.name}</span>
        <span className="sortable-meta">{orgName}</span>
        {hasOverride && <span className="override-dot" title="Custom tool config" />}
        <button className="tools-config-btn" onClick={onToggleOverrideExpand} title="Configure tools">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M6.5 1.5h3v2.3a5 5 0 0 1 1.7 1l2-1.1 1.5 2.6-2 1.1a5 5 0 0 1 0 2l2 1.1-1.5 2.6-2-1.1a5 5 0 0 1-1.7 1v2.3h-3v-2.3a5 5 0 0 1-1.7-1l-2 1.1-1.5-2.6 2-1.1a5 5 0 0 1 0-2l-2-1.1 1.5-2.6 2 1.1a5 5 0 0 1 1.7-1z" />
            <circle cx="8" cy="8" r="2" />
          </svg>
        </button>
        <button className={`toggle-pill ${isHidden ? "is-off" : "is-on"}`} onClick={onToggleVisibility}>
          {isHidden ? "Hidden" : "Visible"}
        </button>
      </div>
      {isOverrideExpanded && <div className="override-panel">{overrideContent}</div>}
    </div>
  )
}

// --- Main ---

function Options() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [cachedData, setCachedData] = useState<CachedData | null>(null)
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null)
  const [expandedProjectOverride, setExpandedProjectOverride] = useState<number | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)
  const [testStatus, setTestStatus] = useState<{ type: "success" | "error"; message: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [permissionGranted, setPermissionGranted] = useState(false)
  const [activeSection, setActiveSection] = useState("connection")
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  useEffect(() => {
    async function load() {
      const s = await getSettings()
      setSettings(s)
      const cache = await getCachedData()
      setCachedData(cache)
      setLastRefreshed(cache?.lastRefreshed ?? null)
      if (s.instanceUrl && !s.instanceUrl.includes("posthog.com")) {
        try {
          const granted = await chrome.permissions.contains({ origins: [`${s.instanceUrl.replace(/\/$/, "")}/*`] })
          setPermissionGranted(granted)
        } catch { /* ignore */ }
      }
    }
    load()
  }, [])

  const updateSettingDebounced = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      if (!settings) return
      setSettings({ ...settings, [key]: value })
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => { saveSettings({ [key]: value }) }, 500)
    },
    [settings]
  )

  const updateSetting = useCallback(
    async <K extends keyof Settings>(key: K, value: Settings[K]) => {
      if (!settings) return
      const updated = await saveSettings({ [key]: value })
      setSettings(updated)
    },
    [settings]
  )

  const handleGrantAccess = useCallback(async () => {
    if (!settings) return
    try {
      const granted = await chrome.permissions.request({ origins: [`${settings.instanceUrl.replace(/\/$/, "")}/*`] })
      setPermissionGranted(granted)
      if (!granted) setTestStatus({ type: "error", message: "Permission denied" })
    } catch { setTestStatus({ type: "error", message: "Failed to request permission" }) }
  }, [settings])

  const handleTestConnection = useCallback(async () => {
    if (!settings) return
    setTesting(true)
    setTestStatus(null)
    const result = await testConnection(settings.instanceUrl, settings.apiKey)
    setTestStatus(result.success
      ? { type: "success", message: `Connected! ${result.orgCount} org${result.orgCount === 1 ? "" : "s"} found.` }
      : { type: "error", message: result.error ?? "Connection failed" })
    setTesting(false)
  }, [settings])

  const handleRefreshNow = useCallback(async () => {
    if (!settings?.apiKey) return
    chrome.runtime.sendMessage({ type: "refresh" }, () => {
      if (chrome.runtime.lastError) console.warn("Refresh failed:", chrome.runtime.lastError.message)
      getCachedData().then((cache) => setLastRefreshed(cache?.lastRefreshed ?? null))
    })
  }, [settings])

  const handleToggleTool = useCallback(async (toolId: string) => {
    if (!settings) return
    const newTools = settings.visibleTools.includes(toolId)
      ? settings.visibleTools.filter((id) => id !== toolId)
      : [...settings.visibleTools, toolId]
    await updateSetting("visibleTools", newTools)
  }, [settings, updateSetting])

  const handleToggleProjectTool = useCallback(async (projectId: number, toolId: string) => {
    if (!settings) return
    const overrides = { ...settings.projectToolOverrides }
    const current = overrides[projectId] ?? [...settings.visibleTools]
    overrides[projectId] = current.includes(toolId) ? current.filter((id) => id !== toolId) : [...current, toolId]
    await updateSetting("projectToolOverrides", overrides)
  }, [settings, updateSetting])

  const handleResetProjectOverride = useCallback(async (projectId: number) => {
    if (!settings) return
    const overrides = { ...settings.projectToolOverrides }
    delete overrides[projectId]
    await updateSetting("projectToolOverrides", overrides)
  }, [settings, updateSetting])

  const sortedOrgs = useMemo(() => {
    if (!cachedData || !settings) return []
    return [...cachedData.organizations].sort((a, b) => {
      const ai = settings.orgOrder.indexOf(a.id), bi = settings.orgOrder.indexOf(b.id)
      if (ai === -1 && bi === -1) return a.name.localeCompare(b.name)
      if (ai === -1) return 1; if (bi === -1) return -1
      return ai - bi
    })
  }, [cachedData, settings])

  const handleOrgDragEnd = useCallback((event: DragEndEvent) => {
    if (!settings) return
    const { active, over } = event
    if (!over || active.id === over.id) return
    const ids = sortedOrgs.map((o) => o.id)
    const oi = ids.indexOf(active.id as string), ni = ids.indexOf(over.id as string)
    if (oi !== -1 && ni !== -1) updateSetting("orgOrder", arrayMove(ids, oi, ni))
  }, [settings, sortedOrgs, updateSetting])

  const handleOrgProjectDragEnd = useCallback((orgId: string, event: DragEndEvent) => {
    if (!settings || !cachedData) return
    const { active, over } = event
    if (!over || active.id === over.id) return
    const org = cachedData.organizations.find((o) => o.id === orgId)
    if (!org) return
    const projectIds = org.projects.map((p) => p.id)
    // Sort by current order
    projectIds.sort((a, b) => {
      const ai = settings.projectOrder.indexOf(a), bi = settings.projectOrder.indexOf(b)
      if (ai === -1 && bi === -1) return 0
      if (ai === -1) return 1; if (bi === -1) return -1
      return ai - bi
    })
    const ids = projectIds.map((id) => `project-${id}`)
    const oi = ids.indexOf(active.id as string), ni = ids.indexOf(over.id as string)
    if (oi === -1 || ni === -1) return
    const reordered = arrayMove(projectIds, oi, ni)
    // Merge into the full project order, preserving other orgs' order
    const otherProjectIds = (settings.projectOrder || []).filter((id) => !projectIds.includes(id))
    // Find where this org's projects should be inserted
    const fullOrder = [...otherProjectIds]
    // Insert at the position of the first project from this org in the current order, or at the end
    const insertIdx = settings.projectOrder.findIndex((id) => projectIds.includes(id))
    if (insertIdx !== -1) {
      // Remove all this org's projects from their current positions
      const cleaned = settings.projectOrder.filter((id) => !projectIds.includes(id))
      cleaned.splice(Math.min(insertIdx, cleaned.length), 0, ...reordered)
      updateSetting("projectOrder", cleaned)
    } else {
      updateSetting("projectOrder", [...fullOrder, ...reordered])
    }
  }, [settings, cachedData, updateSetting])

  if (!settings) return null

  const isCustomUrl = settings.instanceUrl.length > 0 && !settings.instanceUrl.includes("posthog.com")

  const navItems = [
    { id: "connection", label: "Connection", icon: "🔗" },
    { id: "tools", label: "Tools", icon: "🧰" },
    { id: "projects", label: "Projects", icon: "📁" },
    { id: "cache", label: "Cache", icon: "🔄" }
  ]

  return (
    <div className="options-root">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <svg width="20" height="20" viewBox="0 0 128 128" fill="none">
              <path d="M64 128C99.3462 128 128 99.3462 128 64C128 28.6538 99.3462 0 64 0C28.6538 0 0 28.6538 0 64C0 99.3462 28.6538 128 64 128Z" fill="#F54E00" />
              <path d="M42 42h44v44H42z" fill="white" />
            </svg>
          </div>
          <div>
            <div className="sidebar-title">PostHog Explorer</div>
            <div className="sidebar-sub">Settings</div>
          </div>
        </div>
        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`sidebar-nav-item ${activeSection === item.id ? "is-active" : ""}`}
              onClick={() => setActiveSection(item.id)}>
              <span className="sidebar-nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          {lastRefreshed && <span className="sidebar-cache-status">Updated {formatTimeAgo(lastRefreshed)}</span>}
          <div className="sidebar-credit">
            Made by <a href="https://broddin.be" target="_blank" rel="noopener noreferrer">Tim Broddin</a>
            {" / "}
            <a href="https://www.titansofindustry.be" target="_blank" rel="noopener noreferrer">Titans of Industry</a>
          </div>
        </div>
      </aside>

      <main className="content">
        {activeSection === "connection" && (
          <section className="content-section">
            <h2 className="content-title">Connection</h2>
            <p className="content-desc">Connect to your PostHog instance with a personal API key.</p>
            <div className="card">
              <div className="field">
                <label className="field-label">Instance URL</label>
                <input className="field-input" type="text" value={settings.instanceUrl}
                  onChange={(e) => updateSettingDebounced("instanceUrl", e.target.value)}
                  placeholder="https://us.posthog.com" />
              </div>
              <div className="field">
                <label className="field-label">Personal API Key</label>
                <div className="field-input-wrap">
                  <input className="field-input" type={showApiKey ? "text" : "password"} value={settings.apiKey}
                    onChange={(e) => updateSettingDebounced("apiKey", e.target.value)} placeholder="phx_..." />
                  <button className="field-input-action" onClick={() => setShowApiKey(!showApiKey)} type="button">
                    {showApiKey ? "Hide" : "Show"}
                  </button>
                </div>
                <p className="field-hint">
                  <a href={`${settings.instanceUrl.replace(/\/$/, "")}/settings/user-api-keys`}
                    target="_blank" rel="noopener noreferrer">Create a key</a>
                  {" "}with scopes: <strong>organization:read</strong>, <strong>project:read</strong>, <strong>dashboard:read</strong>, <strong>insight:read</strong>
                </p>
              </div>
              <div className="card-actions">
                {isCustomUrl && !permissionGranted && (
                  <button className="btn btn-outline" onClick={handleGrantAccess}>Grant Access</button>
                )}
                <button className="btn btn-primary" onClick={handleTestConnection} disabled={testing}>
                  {testing ? "Testing..." : "Test Connection"}
                </button>
                {testStatus && <span className={`status-badge ${testStatus.type}`}>{testStatus.message}</span>}
              </div>
              {isCustomUrl && <p className="field-hint">Self-hosted URL &mdash; click "Grant Access" first.</p>}
            </div>
          </section>
        )}

        {activeSection === "tools" && (
          <section className="content-section">
            <h2 className="content-title">Default tools</h2>
            <p className="content-desc">Choose which tools appear for all projects by default.</p>
            <div className="card">
              <div className="chip-grid">
                {TOOLS.map((tool) => (
                  <button key={tool.id} className={`chip ${settings.visibleTools.includes(tool.id) ? "is-active" : ""}`}
                    onClick={() => handleToggleTool(tool.id)}>
                    <span className="chip-icon">{tool.icon}</span>{tool.name}
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}

        {activeSection === "projects" && cachedData && cachedData.organizations.length > 0 && (
          <section className="content-section">
            <h2 className="content-title">Organizations & projects</h2>
            <p className="content-desc">Drag to reorder. Hidden items won't appear in the popup.</p>
            <div className="card">
              <label className="switch-row">
                <span className="switch-label">Flat list (no org headers)</span>
                <button className={`switch ${settings.flatList ? "is-on" : ""}`}
                  onClick={() => updateSetting("flatList", !settings.flatList)}
                  role="switch" aria-checked={settings.flatList}>
                  <span className="switch-thumb" />
                </button>
              </label>

              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleOrgDragEnd}>
                <SortableContext items={sortedOrgs.map((o) => o.id)} strategy={verticalListSortingStrategy}>
                  {sortedOrgs.map((org) => {
                    const isOrgHidden = settings.hiddenOrgs.includes(org.id)
                    const orgProjects = [...org.projects].sort((a, b) => {
                      const ai = settings.projectOrder.indexOf(a.id), bi = settings.projectOrder.indexOf(b.id)
                      if (ai === -1 && bi === -1) return a.name.localeCompare(b.name)
                      if (ai === -1) return 1; if (bi === -1) return -1
                      return ai - bi
                    })
                    return (
                      <div key={org.id} className="nested-org">
                        <SortableOrgItem org={org}
                          isHidden={isOrgHidden}
                          onToggleVisibility={() => {
                            const hidden = isOrgHidden
                              ? settings.hiddenOrgs.filter((id) => id !== org.id) : [...settings.hiddenOrgs, org.id]
                            updateSetting("hiddenOrgs", hidden)
                          }} />
                        {!isOrgHidden && (
                          <div className="nested-projects">
                            <DndContext sensors={sensors} collisionDetection={closestCenter}
                              onDragEnd={(event) => handleOrgProjectDragEnd(org.id, event)}>
                              <SortableContext items={orgProjects.map((p) => `project-${p.id}`)} strategy={verticalListSortingStrategy}>
                                {orgProjects.map((project) => (
                                  <SortableProjectItem key={project.id} project={project} orgName={org.name}
                                    isHidden={settings.hiddenProjects.includes(project.id)}
                                    hasOverride={project.id in settings.projectToolOverrides}
                                    isOverrideExpanded={expandedProjectOverride === project.id}
                                    onToggleVisibility={() => {
                                      const hidden = settings.hiddenProjects.includes(project.id)
                                        ? settings.hiddenProjects.filter((id) => id !== project.id) : [...settings.hiddenProjects, project.id]
                                      updateSetting("hiddenProjects", hidden)
                                    }}
                                    onToggleOverrideExpand={() => setExpandedProjectOverride(expandedProjectOverride === project.id ? null : project.id)}
                                    overrideContent={<>
                                      <div className="chip-grid">
                                        {TOOLS.map((tool) => {
                                          const eff = settings.projectToolOverrides[project.id] ?? settings.visibleTools
                                          return (
                                            <button key={tool.id} className={`chip chip-sm ${eff.includes(tool.id) ? "is-active" : ""}`}
                                              onClick={() => handleToggleProjectTool(project.id, tool.id)}>
                                              <span className="chip-icon">{tool.icon}</span>{tool.name}
                                            </button>
                                          )
                                        })}
                                      </div>
                                      {project.id in settings.projectToolOverrides && (
                                        <button className="btn btn-ghost btn-sm" onClick={() => handleResetProjectOverride(project.id)}>
                                          Reset to defaults
                                        </button>
                                      )}
                                    </>} />
                                ))}
                              </SortableContext>
                            </DndContext>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </SortableContext>
              </DndContext>
            </div>
          </section>
        )}

        {activeSection === "cache" && (
          <section className="content-section">
            <h2 className="content-title">Cache</h2>
            <p className="content-desc">Control how often data is refreshed from PostHog.</p>
            <div className="card">
              <div className="cache-row">
                <span className="cache-status">{lastRefreshed ? `Updated ${formatTimeAgo(lastRefreshed)}` : "No data yet"}</span>
                <button className="btn btn-outline btn-sm" onClick={handleRefreshNow}>Refresh now</button>
                <select className="field-select" value={settings.refreshIntervalMinutes}
                  onChange={(e) => updateSetting("refreshIntervalMinutes", parseInt(e.target.value))}>
                  <option value={1}>Every 1 min</option>
                  <option value={5}>Every 5 min</option>
                  <option value={15}>Every 15 min</option>
                  <option value={30}>Every 30 min</option>
                </select>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

export default Options
