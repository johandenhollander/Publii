#!/usr/bin/env node
/**
 * Publii MCP Server - CLI Entry Point for Claude Desktop
 *
 * This allows Claude Desktop to connect to Publii's MCP tools
 * without requiring Publii to be running.
 *
 * Usage in Claude Desktop config:
 * {
 *   "mcpServers": {
 *     "publii": {
 *       "command": "node",
 *       "args": ["/path/to/Publii-fork/app/back-end/mcp/cli.js"]
 *     }
 *   }
 * }
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

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

// Setup Publii data directory
const dataDir = path.join(os.homedir(), 'Documents', 'Publii');
const sitesDir = path.join(dataDir, 'sites');
const configDir = path.join(dataDir, 'config');

// Load app config
function loadAppConfig() {
  const configPath = path.join(configDir, 'app-config.json');
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
      console.error('[MCP] Error loading app config:', e.message);
    }
  }
  // Return defaults if config not found
  return {
    resizeEngine: 'sharp',  // Default to sharp for image processing
    sitesLocation: sitesDir
  };
}

// Load sites from disk
function loadSites() {
  const sites = {};

  if (!fs.existsSync(sitesDir)) {
    console.error(`[MCP] Publii sites directory not found: ${sitesDir}`);
    return sites;
  }

  const siteDirs = fs.readdirSync(sitesDir).filter(d => {
    const stat = fs.statSync(path.join(sitesDir, d));
    return stat.isDirectory();
  });

  for (const siteName of siteDirs) {
    const configPath = path.join(sitesDir, siteName, 'input', 'config', 'site.config.json');
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        sites[siteName] = config;
      } catch (e) {
        console.error(`[MCP] Error loading site config for ${siteName}:`, e.message);
      }
    }
  }

  return sites;
}

// Create app instance for MCP tools
const appInstance = {
  appDir: path.join(__dirname, '..', '..'),
  sitesDir: sitesDir,
  sites: loadSites(),
  appConfig: loadAppConfig(),  // Required for Image class resizeEngine
  db: null,
  mainWindow: null  // No frontend in CLI mode
};

async function main() {
  console.error('[MCP] Starting Publii MCP Server (CLI mode)...');
  console.error(`[MCP] Publii data: ${dataDir}`);
  console.error(`[MCP] Sites found: ${Object.keys(appInstance.sites).join(', ') || 'none'}`);

  // Create MCP server
  const server = new Server({
    name: 'publii-mcp-server',
    version: '1.0.0'
  }, {
    capabilities: {
      tools: {}
    }
  });

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
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
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    console.error(`[MCP] Tool called: ${name}`);

    try {
      // Reload sites on each call (in case they changed)
      appInstance.sites = loadSites();

      // Route to appropriate tool handler
      if (name.startsWith('list_sites') || name.startsWith('get_site')) {
        return await SiteTools.handleToolCall(name, args, appInstance);
      }

      if (name === 'list_posts' || name === 'get_post' || name === 'create_post' || name === 'update_post' || name === 'delete_post') {
        return await PostTools.handleToolCall(name, args, appInstance);
      }

      if (name === 'list_pages' || name === 'get_page' || name === 'create_page' || name === 'update_page' || name === 'delete_page') {
        return await PageTools.handleToolCall(name, args, appInstance);
      }

      if (name === 'list_tags' || name === 'get_tag' || name === 'create_tag' || name === 'update_tag' || name === 'delete_tag') {
        return await TagTools.handleToolCall(name, args, appInstance);
      }

      if (name === 'get_menu' || name === 'set_menu' || name === 'add_menu_item' || name === 'remove_menu_item' || name === 'clear_menu') {
        return await MenuTools.handleToolCall(name, args, appInstance);
      }

      if (name === 'list_media' || name === 'upload_image' || name === 'upload_file' || name === 'delete_media' || name === 'get_media_info') {
        return await MediaTools.handleToolCall(name, args, appInstance);
      }

      throw new Error(`Unknown tool: ${name}`);
    } catch (error) {
      console.error(`[MCP] Tool error (${name}):`, error.message);
      return {
        content: [{
          type: 'text',
          text: `Error: ${error.message}`
        }],
        isError: true
      };
    }
  });

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[MCP] Server running on stdio');
}

main().catch((error) => {
  console.error('[MCP] Fatal error:', error);
  process.exit(1);
});
