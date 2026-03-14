import { useCallback, useEffect, useRef, useState } from "react"

import { testConnection } from "~lib/api"
import { TOOLS } from "~lib/constants"
import { getCachedData, getSettings, saveSettings } from "~lib/storage"
import type { Settings } from "~lib/types"
import { formatTimeAgo } from "~lib/utils"

import "./options.css"

function Options() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null)
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
