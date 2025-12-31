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
const crypto = require('crypto');

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
const statusFile = path.join(configDir, 'mcp-status.json');
const activityLogFile = path.join(configDir, 'mcp-activity.json');

// Maximum activity log entries to keep
const MAX_ACTIVITY_LOG_ENTRIES = 100;

// MCP session tracking
const sessionId = crypto.randomUUID();
let toolCallCount = 0;
const startedAt = Date.now();

/**
 * Get parent PID from /proc (Linux only)
 */
function getParentPid(pid) {
  try {
    const statusPath = `/proc/${pid}/status`;
    if (fs.existsSync(statusPath)) {
      const status = fs.readFileSync(statusPath, 'utf8');
      const match = status.match(/PPid:\s*(\d+)/);
      if (match) {
        return parseInt(match[1], 10);
      }
    }
  } catch (e) {
    // Ignore errors
  }
  return null;
}

/**
 * Get process name from /proc (Linux only)
 */
function getProcessName(pid) {
  try {
    const commPath = `/proc/${pid}/comm`;
    if (fs.existsSync(commPath)) {
      return fs.readFileSync(commPath, 'utf8').trim().toLowerCase();
    }
  } catch (e) {
    // Ignore errors
  }
  return null;
}

/**
 * Detect client name by walking up the process tree
 */
function detectClientName() {
  // Check environment variable first
  if (process.env.MCP_CLIENT_NAME) {
    return process.env.MCP_CLIENT_NAME;
  }

  // Collect all process names in the tree first
  const processChain = [];
  try {
    let currentPid = process.ppid;
    for (let i = 0; i < 10 && currentPid && currentPid > 1; i++) {
      const procName = getProcessName(currentPid);
      if (procName) {
        processChain.push(procName);
      }
      currentPid = getParentPid(currentPid);
    }
  } catch (e) {
    // Ignore errors
  }

  // Check for specific clients in the chain
  // Claude Desktop: typically has 'electron' and 'claude-desktop' in chain
  if (processChain.includes('claude-desktop') ||
      (processChain.includes('electron') && processChain.some(p => p.includes('claude')))) {
    return 'Claude Desktop';
  }

  // Claude Code: has 'claude' (CLI) but NOT 'electron' or 'claude-desktop'
  if (processChain.includes('claude') && !processChain.includes('electron')) {
    return 'Claude Code';
  }

  // Cursor
  if (processChain.some(p => p === 'cursor' || p.includes('cursor'))) {
    return 'Cursor';
  }

  // VS Code
  if (processChain.some(p => p === 'code' || p === 'code-insiders')) {
    return 'VS Code';
  }

  // Windsurf
  if (processChain.includes('windsurf')) {
    return 'Windsurf';
  }

  // Fallback
  if (process.env.TERM_PROGRAM) {
    return `Terminal (${process.env.TERM_PROGRAM})`;
  }

  return 'Unknown Client';
}

// Detect client at startup
const clientName = detectClientName();

/**
 * Read current status file
 */
function readStatusFile() {
  try {
    if (fs.existsSync(statusFile)) {
      const data = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
      // Handle new multi-client format
      if (Array.isArray(data.clients)) {
        return data;
      }
      // Migrate old format
      return { clients: [] };
    }
  } catch (e) {
    // Ignore errors
  }
  return { clients: [] };
}

/**
 * Update status file with current session
 */
function updateStatusFile() {
  try {
    const status = readStatusFile();

    // Clean up stale sessions (process not running or too old)
    const now = Date.now();
    status.clients = status.clients.filter(client => {
      if (client.sessionId === sessionId) return false; // Will re-add current session

      // Check if process is still running
      if (client.pid && client.active) {
        try {
          process.kill(client.pid, 0);
          // Process running, check if too old (>60s without activity)
          const age = now - (client.lastActivity || 0);
          return age < 60000;
        } catch (e) {
          return false; // Process not running
        }
      }
      return false;
    });

    // Add/update current session
    status.clients.push({
      sessionId: sessionId,
      clientName: clientName,
      pid: process.pid,
      startedAt: startedAt,
      lastActivity: Date.now(),
      toolCalls: toolCallCount,
      active: true
    });

    fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
  } catch (e) {
    console.error('[MCP] Error writing status file:', e.message);
  }
}

/**
 * Remove current session from status file
 */
function removeSession() {
  try {
    const status = readStatusFile();
    status.clients = status.clients.filter(c => c.sessionId !== sessionId);
    fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
  } catch (e) {
    console.error('[MCP] Error removing session:', e.message);
  }
}

/**
 * Read activity log
 */
function readActivityLog() {
  try {
    if (fs.existsSync(activityLogFile)) {
      return JSON.parse(fs.readFileSync(activityLogFile, 'utf8'));
    }
  } catch (e) {
    // Ignore errors
  }
  return { entries: [] };
}

/**
 * Log an activity entry
 */
function logActivity(toolName, args = {}) {
  try {
    const log = readActivityLog();

    // Create log entry
    const entry = {
      timestamp: Date.now(),
      clientName: clientName,
      sessionId: sessionId,
      tool: toolName,
      site: args.site || null,
      summary: formatActivitySummary(toolName, args)
    };

    // Add to beginning of array
    log.entries.unshift(entry);

    // Trim to max entries
    if (log.entries.length > MAX_ACTIVITY_LOG_ENTRIES) {
      log.entries = log.entries.slice(0, MAX_ACTIVITY_LOG_ENTRIES);
    }

    fs.writeFileSync(activityLogFile, JSON.stringify(log, null, 2));
  } catch (e) {
    console.error('[MCP] Error logging activity:', e.message);
  }
}

/**
 * Format activity summary for log display
 */
function formatActivitySummary(toolName, args) {
  const site = args.site ? `[${args.site}]` : '';

  switch (toolName) {
    case 'list_sites':
      return 'Listed all sites';
    case 'get_site_config':
      return `${site} Get site config`;
    case 'list_posts':
      return `${site} List posts`;
    case 'get_post':
      return `${site} Get post #${args.id}`;
    case 'create_post':
      return `${site} Create post: "${args.title}"`;
    case 'update_post':
      return `${site} Update post #${args.id}`;
    case 'delete_post':
      return `${site} Delete post #${args.id}`;
    case 'list_pages':
      return `${site} List pages`;
    case 'get_page':
      return `${site} Get page #${args.id}`;
    case 'create_page':
      return `${site} Create page: "${args.title}"`;
    case 'update_page':
      return `${site} Update page #${args.id}`;
    case 'delete_page':
      return `${site} Delete page #${args.id}`;
    case 'list_tags':
      return `${site} List tags`;
    case 'create_tag':
      return `${site} Create tag: "${args.name}"`;
    case 'get_menu':
      return `${site} Get menu`;
    case 'set_menu':
      return `${site} Set menu`;
    case 'add_menu_item':
      return `${site} Add menu item: "${args.label}"`;
    case 'list_media':
      return `${site} List media`;
    case 'upload_image':
      return `${site} Upload image`;
    case 'upload_file':
      return `${site} Upload file`;
    default:
      return `${site} ${toolName}`;
  }
}

// Clean up session on exit
process.on('exit', removeSession);
process.on('SIGINT', () => { removeSession(); process.exit(0); });
process.on('SIGTERM', () => { removeSession(); process.exit(0); });

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
  console.error(`[MCP] Session: ${sessionId}`);
  console.error(`[MCP] Client: ${clientName}`);
  console.error(`[MCP] Publii data: ${dataDir}`);
  console.error(`[MCP] Sites found: ${Object.keys(appInstance.sites).join(', ') || 'none'}`);

  // Write initial status
  updateStatusFile();

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

    // Update status and log activity
    toolCallCount++;
    updateStatusFile();
    logActivity(name, args || {});

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
