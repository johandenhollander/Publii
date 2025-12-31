/**
 * MCP IPC Events
 *
 * Handles Electron IPC events for MCP server control
 * Allows Vue.js frontend to start/stop/query MCP server
 */

const ipcMain = require('electron').ipcMain;
const path = require('path');
const fs = require('fs');
const os = require('os');

class MCPEvents {
  constructor(appInstance) {
    console.log('[MCP Events] Registering IPC handlers...');

    // Path to MCP status and activity files (written by CLI)
    const configDir = path.join(os.homedir(), 'Documents', 'Publii', 'config');
    const statusFile = path.join(configDir, 'mcp-status.json');
    const activityLogFile = path.join(configDir, 'mcp-activity.json');

    // Track last known activity count for change detection
    let lastActivityCount = 0;
    let activityWatcher = null;

    // Initialize last activity count
    try {
      if (fs.existsSync(activityLogFile)) {
        const data = JSON.parse(fs.readFileSync(activityLogFile, 'utf8'));
        lastActivityCount = (data.entries || []).length;
      }
    } catch (e) {
      // Ignore
    }

    /**
     * Watch activity log for changes and notify frontend
     */
    const startActivityWatcher = () => {
      if (activityWatcher) return;

      // Ensure the config directory exists
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      // Create empty activity file if it doesn't exist
      if (!fs.existsSync(activityLogFile)) {
        fs.writeFileSync(activityLogFile, JSON.stringify({ entries: [] }, null, 2));
      }

      try {
        activityWatcher = fs.watch(activityLogFile, { persistent: false }, (eventType) => {
          if (eventType === 'change') {
            try {
              const data = JSON.parse(fs.readFileSync(activityLogFile, 'utf8'));
              const entries = data.entries || [];

              // Check for new entries
              if (entries.length > lastActivityCount) {
                const newEntries = entries.slice(0, entries.length - lastActivityCount);
                lastActivityCount = entries.length;

                // Send each new entry to the frontend (most recent first)
                for (const entry of newEntries) {
                  if (appInstance.mainWindow && !appInstance.mainWindow.isDestroyed()) {
                    appInstance.mainWindow.webContents.send('app-mcp-activity', entry);
                    console.log('[MCP Events] New MCP activity:', entry.summary);
                  }
                }
              } else if (entries.length < lastActivityCount) {
                // Log was cleared
                lastActivityCount = entries.length;
              }
            } catch (e) {
              // Ignore parse errors (file might be mid-write)
            }
          }
        });

        console.log('[MCP Events] Activity watcher started');
      } catch (e) {
        console.error('[MCP Events] Failed to start activity watcher:', e);
      }
    };

    // Start the watcher
    startActivityWatcher();

    /**
     * Start MCP server
     *
     * Usage from frontend:
     *   this.$ipcRenderer.send('app-mcp-start');
     */
    ipcMain.on('app-mcp-start', async (event) => {
      console.log('[MCP Events] Received app-mcp-start');

      try {
        const result = await appInstance.startMCPServer();
        event.sender.send('app-mcp-started', result);
      } catch (error) {
        console.error('[MCP Events] Error starting MCP server:', error);
        event.sender.send('app-mcp-error', {
          success: false,
          error: error.message
        });
      }
    });

    /**
     * Stop MCP server
     *
     * Usage from frontend:
     *   this.$ipcRenderer.send('app-mcp-stop');
     */
    ipcMain.on('app-mcp-stop', async (event) => {
      console.log('[MCP Events] Received app-mcp-stop');

      try {
        const result = await appInstance.stopMCPServer();
        event.sender.send('app-mcp-stopped', result);
      } catch (error) {
        console.error('[MCP Events] Error stopping MCP server:', error);
        event.sender.send('app-mcp-error', {
          success: false,
          error: error.message
        });
      }
    });

    /**
     * Get MCP server status
     *
     * Usage from frontend:
     *   this.$ipcRenderer.send('app-mcp-status');
     *   this.$ipcRenderer.on('app-mcp-status-retrieved', (event, status) => { ... });
     */
    ipcMain.on('app-mcp-status', (event) => {
      console.log('[MCP Events] Received app-mcp-status');

      try {
        const status = appInstance.mcpServer
          ? appInstance.mcpServer.getStatus()
          : { running: false, version: null, tools: [] };

        event.sender.send('app-mcp-status-retrieved', status);
      } catch (error) {
        console.error('[MCP Events] Error getting MCP status:', error);
        event.sender.send('app-mcp-error', {
          success: false,
          error: error.message
        });
      }
    });

    /**
     * Restart MCP server
     *
     * Usage from frontend:
     *   this.$ipcRenderer.send('app-mcp-restart');
     */
    ipcMain.on('app-mcp-restart', async (event) => {
      console.log('[MCP Events] Received app-mcp-restart');

      try {
        const result = await appInstance.restartMCPServer();
        event.sender.send('app-mcp-restarted', result);
      } catch (error) {
        console.error('[MCP Events] Error restarting MCP server:', error);
        event.sender.send('app-mcp-error', {
          success: false,
          error: error.message
        });
      }
    });

    /**
     * Get external MCP CLI status (from status file)
     *
     * This checks the status file written by the MCP CLI process
     * (used by Claude Desktop, Claude Code, etc.) to show connection status in the UI.
     * Supports multiple concurrent MCP clients.
     *
     * Usage from frontend:
     *   mainProcessAPI.send('app-mcp-cli-status');
     *   mainProcessAPI.receiveOnce('app-mcp-cli-status-result', (status) => { ... });
     */
    ipcMain.on('app-mcp-cli-status', (event) => {
      try {
        let status = {
          active: false,
          clients: [],
          totalToolCalls: 0,
          // Legacy fields for backward compatibility
          pid: null,
          startedAt: null,
          lastActivity: null,
          toolCalls: 0,
          isStale: true,
          processRunning: false
        };

        if (fs.existsSync(statusFile)) {
          const data = JSON.parse(fs.readFileSync(statusFile, 'utf8'));

          // Handle new multi-client format
          if (Array.isArray(data.clients)) {
            const now = Date.now();
            const activeClients = [];

            for (const client of data.clients) {
              const timeSinceActivity = now - (client.lastActivity || 0);
              const isStale = timeSinceActivity > 30000;
              let processRunning = false;

              // Check if process is still running
              if (client.pid && client.active) {
                try {
                  process.kill(client.pid, 0);
                  processRunning = true;
                } catch (e) {
                  processRunning = false;
                }
              }

              // Only include clients that are running or recently active
              if (processRunning || timeSinceActivity < 60000) {
                activeClients.push({
                  ...client,
                  isStale,
                  processRunning,
                  secondsSinceActivity: Math.floor(timeSinceActivity / 1000)
                });
              }
            }

            status.clients = activeClients;
            status.active = activeClients.some(c => c.processRunning);
            status.totalToolCalls = activeClients.reduce((sum, c) => sum + (c.toolCalls || 0), 0);

            // Legacy fields - use most recent active client
            if (activeClients.length > 0) {
              const mostRecent = activeClients.reduce((a, b) =>
                (b.lastActivity || 0) > (a.lastActivity || 0) ? b : a
              );
              status.pid = mostRecent.pid;
              status.startedAt = mostRecent.startedAt;
              status.lastActivity = mostRecent.lastActivity;
              status.toolCalls = status.totalToolCalls;
              status.isStale = mostRecent.isStale;
              status.processRunning = mostRecent.processRunning;
            }
          } else {
            // Handle legacy single-client format
            status = { ...status, ...data };

            if (data.lastActivity) {
              const timeSinceActivity = Date.now() - data.lastActivity;
              status.isStale = timeSinceActivity > 30000;
              status.secondsSinceActivity = Math.floor(timeSinceActivity / 1000);
            }

            if (data.pid && data.active) {
              try {
                process.kill(data.pid, 0);
                status.processRunning = true;
              } catch (e) {
                status.processRunning = false;
                status.active = false;
              }
            }

            // Convert to clients array for UI
            if (data.active || data.pid) {
              status.clients = [{
                sessionId: 'legacy',
                clientName: 'MCP Client',
                pid: data.pid,
                startedAt: data.startedAt,
                lastActivity: data.lastActivity,
                toolCalls: data.toolCalls || 0,
                active: data.active,
                isStale: status.isStale,
                processRunning: status.processRunning,
                secondsSinceActivity: status.secondsSinceActivity
              }];
            }
          }
        }

        // Read activity log
        try {
          if (fs.existsSync(activityLogFile)) {
            const activityData = JSON.parse(fs.readFileSync(activityLogFile, 'utf8'));
            status.activityLog = activityData.entries || [];
          } else {
            status.activityLog = [];
          }
        } catch (e) {
          status.activityLog = [];
        }

        event.sender.send('app-mcp-cli-status-result', status);
      } catch (error) {
        console.error('[MCP Events] Error reading MCP CLI status:', error);
        event.sender.send('app-mcp-cli-status-result', {
          active: false,
          clients: [],
          activityLog: [],
          error: error.message
        });
      }
    });

    /**
     * Clear MCP activity log
     *
     * Usage from frontend:
     *   mainProcessAPI.send('app-mcp-clear-activity-log');
     */
    ipcMain.on('app-mcp-clear-activity-log', (event) => {
      try {
        if (fs.existsSync(activityLogFile)) {
          fs.writeFileSync(activityLogFile, JSON.stringify({ entries: [] }, null, 2));
        }
        event.sender.send('app-mcp-activity-log-cleared', { success: true });
      } catch (error) {
        console.error('[MCP Events] Error clearing activity log:', error);
        event.sender.send('app-mcp-activity-log-cleared', { success: false, error: error.message });
      }
    });

    console.log('[MCP Events] IPC handlers registered');
  }
}

module.exports = MCPEvents;
