/**
 * MCP IPC Events
 *
 * Handles Electron IPC events for MCP server control
 * Allows Vue.js frontend to start/stop/query MCP server
 */

const ipcMain = require('electron').ipcMain;

class MCPEvents {
  constructor(appInstance) {
    console.log('[MCP Events] Registering IPC handlers...');

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

    console.log('[MCP Events] IPC handlers registered');
  }
}

module.exports = MCPEvents;
