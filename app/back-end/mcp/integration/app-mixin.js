/**
 * MCP App Mixin
 *
 * Methods to be mixed into App class for MCP functionality.
 * These are added to App.prototype when MCP integration is loaded.
 *
 * This file isolates all MCP-related methods to minimize upstream conflicts.
 */

const path = require('path');
const normalizePath = require('normalize-path');

// Lazy-loaded MCP server class
let PubliiMCPServer = null;

/**
 * MCP methods to be added to App.prototype
 */
const McpAppMixin = {
    /**
     * Initialize MCP server instance property
     * Called once when mixin is applied
     */
    _initMcpServerProperty() {
        if (typeof this.mcpServer === 'undefined') {
            this.mcpServer = null;
        }
    },

    /**
     * Get or create MCP server instance (lazy initialization)
     * @private
     */
    _getMcpServer() {
        if (!this.mcpServer) {
            if (!PubliiMCPServer) {
                PubliiMCPServer = require('../server.js');
            }
            this.mcpServer = new PubliiMCPServer(this);
        }
        return this.mcpServer;
    },

    /**
     * Start MCP server
     * Called via IPC event: app-mcp-start
     */
    async startMCPServer() {
        console.log('[App] Starting MCP server...');
        return await this._getMcpServer().start();
    },

    /**
     * Stop MCP server
     * Called via IPC event: app-mcp-stop
     */
    async stopMCPServer() {
        console.log('[App] Stopping MCP server...');

        if (!this.mcpServer) {
            return { success: true, message: 'MCP server not initialized' };
        }

        return await this.mcpServer.stop();
    },

    /**
     * Restart MCP server
     * Called via IPC event: app-mcp-restart
     */
    async restartMCPServer() {
        console.log('[App] Restarting MCP server...');
        return await this._getMcpServer().restart();
    },

    /**
     * Get MCP server status
     * Called via IPC event: app-mcp-status
     */
    getMCPServerStatus() {
        if (!this.mcpServer) {
            return { running: false, version: null, tools: [] };
        }

        return this.mcpServer.getStatus();
    },

    /**
     * Get MCP CLI path for frontend display
     * Used in app data sent to renderer process
     */
    getMcpCliPath() {
        return normalizePath(
            path.join(__dirname, '..', 'cli.js').replace('app.asar', 'app.asar.unpacked')
        );
    }
};

module.exports = McpAppMixin;
