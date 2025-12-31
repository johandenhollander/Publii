/**
 * Publii MCP Server
 *
 * Integrates Model Context Protocol into Publii
 * Allows AI assistants to interact with Publii's backend classes
 *
 * Architecture:
 * - Reuses existing Publii classes (Post, Site, Tag, etc.)
 * - No direct database access (uses Publii's business logic)
 * - Runs in same process as Publii (no race conditions)
 * - Optional: can be toggled in settings
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

// Import tool implementations
const SiteTools = require('./tools/sites.js');

class PubliiMCPServer {
  /**
   * @param {Object} appInstance - Publii App instance
   */
  constructor(appInstance) {
    this.app = appInstance;
    this.server = null;
    this.transport = null;
    this.isRunning = false;

    console.log('[MCP] Publii MCP Server initialized');
  }

  /**
   * Start MCP server on stdio
   */
  async start() {
    if (this.isRunning) {
      console.log('[MCP] Server already running');
      return { success: true, message: 'Already running' };
    }

    try {
      console.log('[MCP] Starting Publii MCP Server...');

      // Create MCP server
      this.server = new Server({
        name: 'publii-mcp-server',
        version: '1.0.0'
      }, {
        capabilities: {
          tools: {}
        }
      });

      // Register request handlers
      this.registerHandlers();

      // Register all tools
      this.registerTools();

      // Create stdio transport
      this.transport = new StdioServerTransport();
      await this.server.connect(this.transport);

      this.isRunning = true;
      console.log('[MCP] Server started successfully on stdio');

      return { success: true, message: 'MCP Server started' };
    } catch (error) {
      console.error('[MCP] Failed to start server:', error);
      this.isRunning = false;
      return { success: false, error: error.message };
    }
  }

  /**
   * Register MCP request handlers
   */
  registerHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      console.log('[MCP] Listing tools');

      const tools = [
        ...SiteTools.getToolDefinitions()
        // More tools will be added here
      ];

      return { tools };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      console.log(`[MCP] Tool called: ${name}`, args);

      try {
        // Route to appropriate tool handler
        if (name.startsWith('list_sites') || name.startsWith('get_site')) {
          return await SiteTools.handleToolCall(name, args, this.app);
        }

        throw new Error(`Unknown tool: ${name}`);
      } catch (error) {
        console.error(`[MCP] Tool error (${name}):`, error);
        return {
          content: [{
            type: 'text',
            text: `Error: ${error.message}`
          }],
          isError: true
        };
      }
    });
  }

  /**
   * Register all MCP tools
   */
  registerTools() {
    console.log('[MCP] Registering tools...');

    // Site tools are auto-registered via getToolDefinitions()
    // More tools will be added here as we implement them

    console.log('[MCP] Tools registered');
  }

  /**
   * Stop MCP server
   */
  async stop() {
    if (!this.isRunning) {
      console.log('[MCP] Server not running');
      return { success: true, message: 'Not running' };
    }

    try {
      console.log('[MCP] Stopping server...');

      if (this.transport) {
        await this.transport.close();
      }

      this.server = null;
      this.transport = null;
      this.isRunning = false;

      console.log('[MCP] Server stopped');
      return { success: true, message: 'MCP Server stopped' };
    } catch (error) {
      console.error('[MCP] Error stopping server:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get server status
   */
  getStatus() {
    return {
      running: this.isRunning,
      version: '1.0.0',
      tools: this.isRunning ? ['list_sites'] : []
    };
  }

  /**
   * Restart server
   */
  async restart() {
    console.log('[MCP] Restarting server...');
    await this.stop();
    await new Promise(resolve => setTimeout(resolve, 1000));
    return await this.start();
  }
}

module.exports = PubliiMCPServer;
