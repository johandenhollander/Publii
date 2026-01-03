/**
 * MCP Integration Entry Point
 *
 * Provides all MCP-related extensions for Publii backend.
 * Designed to minimize changes to upstream files by providing
 * a single integration point.
 *
 * Usage in app.js:
 *   const { extendApp } = require('./mcp/integration');
 *   extendApp(App);
 */

const McpAppMixin = require('./app-mixin.js');
const McpPreloadChannels = require('./preload-channels.js');

/**
 * Extend App class with MCP methods
 *
 * Adds all MCP-related methods to the App prototype.
 * Should be called after App class is defined but before instantiation.
 *
 * @param {Function} AppClass - The App class to extend
 */
function extendApp(AppClass) {
    // Add MCP methods to prototype
    Object.keys(McpAppMixin).forEach(methodName => {
        if (typeof McpAppMixin[methodName] === 'function') {
            AppClass.prototype[methodName] = McpAppMixin[methodName];
        }
    });

    // Wrap constructor to initialize mcpServer property
    const originalInit = AppClass.prototype.checkDirs;
    if (originalInit) {
        AppClass.prototype.checkDirs = function(...args) {
            // Initialize MCP server property
            if (typeof this.mcpServer === 'undefined') {
                this.mcpServer = null;
            }
            return originalInit.apply(this, args);
        };
    }
}

/**
 * Get MCP IPC channels for preload script
 *
 * @returns {Object} Channel arrays for send, receive, receiveOnce
 */
function getPreloadChannels() {
    return McpPreloadChannels;
}

/**
 * Check if MCP should be loaded based on config
 *
 * @param {Object} appConfig - Application configuration
 * @returns {boolean} True if MCP should be enabled
 */
function shouldLoadMcp(appConfig) {
    return appConfig?.experimentalMcpIntegration === true;
}

module.exports = {
    extendApp,
    getPreloadChannels,
    shouldLoadMcp,
    McpAppMixin,
    McpPreloadChannels
};
