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
const PostTools = require('./tools/posts.js');
const PageTools = require('./tools/pages.js');
const TagTools = require('./tools/tags.js');
const MenuTools = require('./tools/menus.js');
const MediaTools = require('./tools/media.js');

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
        ...SiteTools.getToolDefinitions(),
        ...PostTools.getToolDefinitions(),
        ...PageTools.getToolDefinitions(),
        ...TagTools.getToolDefinitions(),
        ...MenuTools.getToolDefinitions(),
        ...MediaTools.getToolDefinitions()
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

        // Post tools
        if (name === 'list_posts' || name === 'get_post' || name === 'create_post' || name === 'update_post' || name === 'delete_post') {
          return await PostTools.handleToolCall(name, args, this.app);
        }

        // Page tools
        if (name === 'list_pages' || name === 'get_page' || name === 'create_page' || name === 'update_page' || name === 'delete_page') {
          return await PageTools.handleToolCall(name, args, this.app);
        }

        // Tag tools
        if (name === 'list_tags' || name === 'get_tag' || name === 'create_tag' || name === 'update_tag' || name === 'delete_tag') {
          return await TagTools.handleToolCall(name, args, this.app);
        }

        // Menu tools
        if (name === 'get_menu' || name === 'set_menu' || name === 'add_menu_item' || name === 'remove_menu_item' || name === 'clear_menu') {
          return await MenuTools.handleToolCall(name, args, this.app);
        }

        // Media tools
        if (name === 'list_media' || name === 'upload_image' || name === 'upload_file' || name === 'delete_media' || name === 'get_media_info') {
          return await MediaTools.handleToolCall(name, args, this.app);
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
    const allTools = [
      // Sites
      'list_sites', 'get_site_config',
      // Posts
      'list_posts', 'get_post', 'create_post', 'update_post', 'delete_post',
      // Pages
      'list_pages', 'get_page', 'create_page', 'update_page', 'delete_page',
      // Tags
      'list_tags', 'get_tag', 'create_tag', 'update_tag', 'delete_tag',
      // Menus
      'get_menu', 'set_menu', 'add_menu_item', 'remove_menu_item', 'clear_menu',
      // Media
      'list_media', 'upload_image', 'upload_file', 'delete_media', 'get_media_info'
    ];

    return {
      running: this.isRunning,
      version: '1.0.0',
      toolCount: allTools.length,
      tools: this.isRunning ? allTools : []
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
