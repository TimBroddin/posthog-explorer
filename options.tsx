import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { testConnection } from "~lib/api"
import { TOOLS } from "~lib/constants"
import { getCachedData, getSettings, saveSettings } from "~lib/storage"
import type { CachedData, Settings } from "~lib/types"
import { formatTimeAgo } from "~lib/utils"

import "./options.css"

function Options() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [cachedData, setCachedData] = useState<CachedData | null>(null)
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null)
  const [expandedProjectOverride, setExpandedProjectOverride] = useState<number | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)
  const [testStatus, setTestStatus] = useState<{
    type: "success" | "error"
    message: string
  } | null>(null)
  const [testing, setTesting] = useState(false)
  const [permissionGranted, setPermissionGranted] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    async function load() {
      const s = await getSettings()
      setSettings(s)
      const cache = await getCachedData()
      setCachedData(cache)
      setLastRefreshed(cache?.lastRefreshed ?? null)
      // Check if permission is already granted for non-posthog.com URLs
      if (s.instanceUrl && !s.instanceUrl.includes("posthog.com")) {
        try {
          const granted = await chrome.permissions.contains({
            origins: [`${s.instanceUrl.replace(/\/$/, "")}/*`]
          })
          setPermissionGranted(granted)
        } catch {
          // Ignore errors checking permissions
        }
      }
    }
    load()
  }, [])

  // Debounced save for text inputs (apiKey, instanceUrl)
  // Updates local state immediately for responsive UI, saves to storage after 500ms idle
  const updateSettingDebounced = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      if (!settings) return
      // Update local state immediately
      const updated = { ...settings, [key]: value }
      setSettings(updated)
      // Debounce the storage write
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(async () => {
        await saveSettings({ [key]: value })
      }, 500)
    },
    [settings]
  )

  // Immediate save for non-text inputs (toggles, selects)
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
      const granted = await chrome.permissions.request({
        origins: [`${settings.instanceUrl.replace(/\/$/, "")}/*`]
      })
      setPermissionGranted(granted)
      if (!granted) {
        setTestStatus({ type: "error", message: "Permission denied by user" })
      }
    } catch (e) {
      setTestStatus({ type: "error", message: "Failed to request permission" })
    }
  }, [settings])

  const handleTestConnection = useCallback(async () => {
    if (!settings) return
    setTesting(true)
    setTestStatus(null)

    const result = await testConnection(settings.instanceUrl, settings.apiKey)
    if (result.success) {
      setTestStatus({
        type: "success",
        message: `Connected! Found ${result.orgCount} organization${result.orgCount === 1 ? "" : "s"}.`
      })
    } else {
      setTestStatus({ type: "error", message: result.error ?? "Connection failed" })
    }
    setTesting(false)
  }, [settings])

  const handleRefreshNow = useCallback(async () => {
    if (!settings?.apiKey) return
    // Send message to background worker to trigger refresh
    chrome.runtime.sendMessage({ type: "refresh" }, () => {
      // Check for errors (e.g., service worker not ready)
      if (chrome.runtime.lastError) {
        console.warn("Refresh message failed:", chrome.runtime.lastError.message)
      }
      // Update the last refreshed time after refresh completes
      getCachedData().then((cache) => {
        setLastRefreshed(cache?.lastRefreshed ?? null)
      })
    })
  }, [settings])

  const handleToggleTool = useCallback(
    async (toolId: string) => {
      if (!settings) return
      const newTools = settings.visibleTools.includes(toolId)
        ? settings.visibleTools.filter((id) => id !== toolId)
        : [...settings.visibleTools, toolId]
      await updateSetting("visibleTools", newTools)
    },
    [settings, updateSetting]
  )

  const handleToggleProjectTool = useCallback(
    async (projectId: number, toolId: string) => {
      if (!settings) return
      const overrides = { ...settings.projectToolOverrides }
      const current = overrides[projectId] ?? [...settings.visibleTools]
      const newTools = current.includes(toolId)
        ? current.filter((id) => id !== toolId)
        : [...current, toolId]
      overrides[projectId] = newTools
      await updateSetting("projectToolOverrides", overrides)
    },
    [settings, updateSetting]
  )

  const handleResetProjectOverride = useCallback(
    async (projectId: number) => {
      if (!settings) return
      const overrides = { ...settings.projectToolOverrides }
      delete overrides[projectId]
      await updateSetting("projectToolOverrides", overrides)
    },
    [settings, updateSetting]
  )

  // All projects from cached data
  const allProjects = useMemo(() => {
    if (!cachedData) return []
    return cachedData.organizations.flatMap((org) =>
      org.projects.map((p) => ({ ...p, orgName: org.name }))
    )
  }, [cachedData])

  if (!settings) return null

  const isCustomUrl =
    settings.instanceUrl.length > 0 && !settings.instanceUrl.includes("posthog.com")

  return (
    <div>
      <h1>
        <div className="logo">P</div>
        PostHog Explorer Settings
      </h1>

      {/* Connection */}
      <div className="section">
        <h2>Connection</h2>
        <div className="field">
          <label>PostHog Instance URL</label>
          <input
            type="text"
            value={settings.instanceUrl}
            onChange={(e) => updateSettingDebounced("instanceUrl", e.target.value)}
            placeholder="https://us.posthog.com"
          />
        </div>
        <div className="field">
          <label>Personal API Key</label>
          <div className="password-field">
            <input
              type={showApiKey ? "text" : "password"}
              value={settings.apiKey}
              onChange={(e) => updateSettingDebounced("apiKey", e.target.value)}
              placeholder="phx_..."
            />
            <button
              className="password-toggle"
              onClick={() => setShowApiKey(!showApiKey)}
              type="button">
              {showApiKey ? "Hide" : "Show"}
            </button>
          </div>
          <p className="hint">
            <a
              href={`${settings.instanceUrl.replace(/\/$/, "")}/settings/user-api-keys`}
              target="_blank"
              rel="noopener noreferrer"
              className="api-key-link">
              Create a Personal API key
            </a>
            {" "}— use <strong>All access</strong> preset, or at minimum: <strong>organization:read</strong>, <strong>dashboard:read</strong>, <strong>project:read</strong>
          </p>
        </div>
        <div className="btn-row">
          {isCustomUrl && !permissionGranted && (
            <button className="btn btn-secondary" onClick={handleGrantAccess}>
              Grant Access
            </button>
          )}
          <button className="btn" onClick={handleTestConnection} disabled={testing}>
            {testing ? "Testing..." : "Test Connection"}
          </button>
          {testStatus && (
            <span className={`status ${testStatus.type}`}>
              {testStatus.message}
            </span>
          )}
        </div>
        {isCustomUrl && (
          <p className="hint">
            Self-hosted URL detected. Click "Grant Access" first, then "Test Connection".
          </p>
        )}
      </div>

      {/* Visible Tools */}
      <div className="section">
        <h2>Visible Tools</h2>
        <div className="tools-grid">
          {TOOLS.map((tool) => (
            <label key={tool.id} className="tool-toggle">
              <input
                type="checkbox"
                checked={settings.visibleTools.includes(tool.id)}
                onChange={() => handleToggleTool(tool.id)}
              />
              {tool.icon} {tool.name}
            </label>
          ))}
        </div>
      </div>

      {/* Organizations & Projects — ordering and visibility */}
      {cachedData && cachedData.organizations.length > 0 && (
        <div className="section">
          <h2>Organizations & Projects</h2>
          <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
            Reorder and toggle visibility. Hidden items won't appear in the popup.
          </p>
          <label className="tool-toggle" style={{ marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={settings.flatList}
              onChange={() => updateSetting("flatList", !settings.flatList)}
            />
            Show as flat list (no org grouping)
          </label>
          {(() => {
            // Sort orgs for display using current order
            const orgs = [...cachedData.organizations].sort((a, b) => {
              const ai = settings.orgOrder.indexOf(a.id)
              const bi = settings.orgOrder.indexOf(b.id)
              if (ai === -1 && bi === -1) return a.name.localeCompare(b.name)
              if (ai === -1) return 1
              if (bi === -1) return -1
              return ai - bi
            })
            return orgs.map((org, orgIdx) => {
              const isOrgHidden = settings.hiddenOrgs.includes(org.id)
              // Sort projects for display
              const projects = [...org.projects].sort((a, b) => {
                const ai = settings.projectOrder.indexOf(a.id)
                const bi = settings.projectOrder.indexOf(b.id)
                if (ai === -1 && bi === -1) return a.name.localeCompare(b.name)
                if (ai === -1) return 1
                if (bi === -1) return -1
                return ai - bi
              })
              return (
                <div key={org.id} className="sort-org">
                  <div className="sort-org-header">
                    <div className="sort-buttons">
                      <button
                        className="sort-btn"
                        disabled={orgIdx === 0}
                        onClick={() => {
                          const ids = orgs.map((o) => o.id)
                          const idx = ids.indexOf(org.id)
                          if (idx > 0) {
                            [ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]]
                            updateSetting("orgOrder", ids)
                          }
                        }}
                        title="Move up">
                        ▲
                      </button>
                      <button
                        className="sort-btn"
                        disabled={orgIdx === orgs.length - 1}
                        onClick={() => {
                          const ids = orgs.map((o) => o.id)
                          const idx = ids.indexOf(org.id)
                          if (idx < ids.length - 1) {
                            [ids[idx], ids[idx + 1]] = [ids[idx + 1], ids[idx]]
                            updateSetting("orgOrder", ids)
                          }
                        }}
                        title="Move down">
                        ▼
                      </button>
                    </div>
                    <span className={isOrgHidden ? "sort-name hidden-name" : "sort-name"}>
                      {org.name}
                    </span>
                    <button
                      className={`visibility-btn ${isOrgHidden ? "is-hidden" : ""}`}
                      onClick={() => {
                        const hidden = isOrgHidden
                          ? settings.hiddenOrgs.filter((id) => id !== org.id)
                          : [...settings.hiddenOrgs, org.id]
                        updateSetting("hiddenOrgs", hidden)
                      }}
                      title={isOrgHidden ? "Show organization" : "Hide organization"}>
                      {isOrgHidden ? "Hidden" : "Visible"}
                    </button>
                  </div>
                  {!isOrgHidden &&
                    projects.map((project, projIdx) => {
                      const isProjectHidden = settings.hiddenProjects.includes(project.id)
                      return (
                        <div key={project.id} className="sort-project">
                          <div className="sort-buttons">
                            <button
                              className="sort-btn"
                              disabled={projIdx === 0}
                              onClick={() => {
                                const ids = projects.map((p) => p.id)
                                const idx = ids.indexOf(project.id)
                                if (idx > 0) {
                                  [ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]]
                                  updateSetting("projectOrder", ids)
                                }
                              }}
                              title="Move up">
                              ▲
                            </button>
                            <button
                              className="sort-btn"
                              disabled={projIdx === projects.length - 1}
                              onClick={() => {
                                const ids = projects.map((p) => p.id)
                                const idx = ids.indexOf(project.id)
                                if (idx < ids.length - 1) {
                                  [ids[idx], ids[idx + 1]] = [ids[idx + 1], ids[idx]]
                                  updateSetting("projectOrder", ids)
                                }
                              }}
                              title="Move down">
                              ▼
                            </button>
                          </div>
                          <span className={isProjectHidden ? "sort-name hidden-name" : "sort-name"}>
                            {project.name}
                          </span>
                          <button
                            className={`visibility-btn ${isProjectHidden ? "is-hidden" : ""}`}
                            onClick={() => {
                              const hidden = isProjectHidden
                                ? settings.hiddenProjects.filter((id) => id !== project.id)
                                : [...settings.hiddenProjects, project.id]
                              updateSetting("hiddenProjects", hidden)
                            }}
                            title={isProjectHidden ? "Show project" : "Hide project"}>
                            {isProjectHidden ? "Hidden" : "Visible"}
                          </button>
                        </div>
                      )
                    })}
                </div>
              )
            })
          })()}
        </div>
      )}

      {/* Per-Project Tool Overrides */}
      {allProjects.length > 0 && (
        <div className="section">
          <h2>Per-Project Tools</h2>
          <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
            Override which tools are shown for specific projects.
          </p>
          {allProjects.map((project) => {
            const hasOverride = project.id in settings.projectToolOverrides
            const isExpanded = expandedProjectOverride === project.id
            return (
              <div key={project.id} className="project-override">
                <div
                  className="project-override-header"
                  onClick={() =>
                    setExpandedProjectOverride(isExpanded ? null : project.id)
                  }>
                  <span>{project.name}</span>
                  <span className="project-override-org">{project.orgName}</span>
                  {hasOverride && <span className="project-override-badge">custom</span>}
                  <span className="project-override-chevron">{isExpanded ? "▼" : "▶"}</span>
                </div>
                {isExpanded && (
                  <div className="project-override-content">
                    <div className="tools-grid">
                      {TOOLS.map((tool) => {
                        const effectiveTools = settings.projectToolOverrides[project.id] ?? settings.visibleTools
                        return (
                          <label key={tool.id} className="tool-toggle">
                            <input
                              type="checkbox"
                              checked={effectiveTools.includes(tool.id)}
                              onChange={() => handleToggleProjectTool(project.id, tool.id)}
                            />
                            {tool.icon} {tool.name}
                          </label>
                        )
                      })}
                    </div>
                    {hasOverride && (
                      <button
                        className="btn btn-secondary"
                        style={{ marginTop: 8, fontSize: 11 }}
                        onClick={() => handleResetProjectOverride(project.id)}>
                        Reset to global defaults
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Cache */}
      <div className="section">
        <h2>Cache</h2>
        <div className="cache-info">
          {lastRefreshed
            ? `Last refreshed: ${formatTimeAgo(lastRefreshed)}`
            : "No data cached yet"}
        </div>
        <div className="btn-row">
          <button className="btn btn-secondary" onClick={handleRefreshNow}>
            Refresh Now
          </button>
          <select
            value={settings.refreshIntervalMinutes}
            onChange={(e) =>
              updateSetting("refreshIntervalMinutes", parseInt(e.target.value))
            }>
            <option value={1}>Every 1 minute</option>
            <option value={5}>Every 5 minutes</option>
            <option value={15}>Every 15 minutes</option>
            <option value={30}>Every 30 minutes</option>
          </select>
        </div>
      </div>
    </div>
  )
}

export default Options
