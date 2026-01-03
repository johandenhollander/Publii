/**
 * MCP IPC Channel Definitions
 *
 * Lists all IPC channels required for MCP functionality.
 * These arrays are spread into app-preload.js channel lists.
 *
 * This file isolates MCP channels to minimize upstream conflicts.
 */

module.exports = {
    /**
     * Channels for ipcRenderer.send()
     * UI -> Main process (fire-and-forget)
     */
    send: [
        'app-mcp-cli-status',
        'app-mcp-clear-activity-log'
    ],

    /**
     * Channels for ipcRenderer.on()
     * Main process -> UI (persistent listeners)
     */
    receive: [
        'app-mcp-activity'
    ],

    /**
     * Channels for ipcRenderer.once()
     * Main process -> UI (one-time response)
     */
    receiveOnce: [
        'app-mcp-cli-status-result',
        'app-mcp-activity-log-cleared'
    ]
};
