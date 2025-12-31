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

    // Path to MCP status file (written by CLI)
    const configDir = path.join(os.homedir(), 'Documents', 'Publii', 'config');
    const statusFile = path.join(configDir, 'mcp-status.json');

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
     * (used by Claude Desktop) to show connection status in the UI.
     *
     * Usage from frontend:
     *   mainProcessAPI.send('app-mcp-cli-status');
     *   mainProcessAPI.receiveOnce('app-mcp-cli-status-result', (status) => { ... });
     */
    ipcMain.on('app-mcp-cli-status', (event) => {
      try {
        let status = {
          active: false,
          pid: null,
          startedAt: null,
          lastActivity: null,
          toolCalls: 0,
          isStale: true
        };

        if (fs.existsSync(statusFile)) {
          const data = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
          status = { ...data };

          // Check if status is stale (no activity in last 30 seconds)
          if (data.lastActivity) {
            const timeSinceActivity = Date.now() - data.lastActivity;
            status.isStale = timeSinceActivity > 30000;
            status.secondsSinceActivity = Math.floor(timeSinceActivity / 1000);
          }

          // Check if process is still running (on Unix-like systems)
          if (data.pid && data.active) {
            try {
              process.kill(data.pid, 0); // Signal 0 = check if process exists
              status.processRunning = true;
            } catch (e) {
              status.processRunning = false;
              status.active = false; // Process died
            }
          }
        }

        event.sender.send('app-mcp-cli-status-result', status);
      } catch (error) {
        console.error('[MCP Events] Error reading MCP CLI status:', error);
        event.sender.send('app-mcp-cli-status-result', {
          active: false,
          error: error.message
        });
      }
    });

    console.log('[MCP Events] IPC handlers registered');
  }
}

module.exports = MCPEvents;
