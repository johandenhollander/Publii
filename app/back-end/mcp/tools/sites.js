/**
 * MCP Tools for Site Operations
 *
 * Wraps Publii's App.sites property and Site class
 * Demonstrates the integration pattern: reuse Publii's existing code!
 */

class SiteTools {
  /**
   * Get tool definitions for MCP protocol
   */
  static getToolDefinitions() {
    return [
      {
        name: 'list_sites',
        description: 'List all Publii sites with their configuration',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'get_site_config',
        description: 'Get detailed configuration for a specific site',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site name (catalog name, not display name)'
            }
          },
          required: ['site']
        }
      }
    ];
  }

  /**
   * Handle tool calls
   *
   * @param {string} toolName - Name of the tool being called
   * @param {Object} args - Tool arguments
   * @param {Object} appInstance - Publii App instance
   * @returns {Object} MCP response
   */
  static async handleToolCall(toolName, args, appInstance) {
    switch (toolName) {
      case 'list_sites':
        return await this.listSites(appInstance);

      case 'get_site_config':
        return await this.getSiteConfig(args.site, appInstance);

      default:
        throw new Error(`Unknown site tool: ${toolName}`);
    }
  }

  /**
   * List all sites
   *
   * Uses: appInstance.sites (populated by App.loadSites())
   */
  static async listSites(appInstance) {
    try {
      // Access Publii's sites object directly!
      // This is populated by App.loadSites() at startup
      const sites = appInstance.sites || {};

      const siteList = Object.keys(sites).map(siteName => {
        const site = sites[siteName];
        return {
          name: siteName,
          displayName: site.displayName || siteName,
          domain: site.domain || '',
          theme: site.theme || '',
          logo: site.logo?.icon || '',
          description: `${site.displayName} - ${site.domain}`
        };
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            count: siteList.length,
            sites: siteList
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('[MCP] list_sites error:', error);
      throw error;
    }
  }

  /**
   * Get detailed site configuration
   *
   * Uses: appInstance.sites[siteName]
   */
  static async getSiteConfig(siteName, appInstance) {
    try {
      const sites = appInstance.sites || {};

      if (!sites[siteName]) {
        throw new Error(`Site not found: ${siteName}`);
      }

      // Return full site config from Publii's loaded sites
      const siteConfig = sites[siteName];

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            site: siteName,
            config: siteConfig
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('[MCP] get_site_config error:', error);
      throw error;
    }
  }
}

module.exports = SiteTools;
