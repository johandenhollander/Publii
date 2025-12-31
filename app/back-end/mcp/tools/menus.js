/**
 * MCP Tools for Menu Operations
 *
 * Manages menu configurations (stored in menu.config.json)
 */

const path = require('path');
const fs = require('fs');

class MenuTools {
  /**
   * Get tool definitions for MCP protocol
   */
  static getToolDefinitions() {
    return [
      {
        name: 'get_menu',
        description: 'Get menu configuration for a site',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site name (catalog name)'
            },
            menuName: {
              type: 'string',
              description: 'Menu name (optional, returns all menus if not specified)'
            }
          },
          required: ['site']
        }
      },
      {
        name: 'set_menu',
        description: 'Replace entire menu with new items',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site name'
            },
            menuName: {
              type: 'string',
              description: 'Menu name (default: "Main menu")'
            },
            items: {
              type: 'array',
              description: 'Array of menu items',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: 'Menu item label' },
                  type: { type: 'string', enum: ['page', 'post', 'tag', 'frontpage', 'external'], description: 'Link type' },
                  link: { type: ['string', 'number'], description: 'Link target (page ID, URL, etc.)' },
                  target: { type: 'string', enum: ['_self', '_blank'], description: 'Link target attribute' },
                  cssClass: { type: 'string', description: 'CSS class' },
                  isHidden: { type: 'boolean', description: 'Hidden from menu' }
                }
              }
            }
          },
          required: ['site', 'items']
        }
      },
      {
        name: 'add_menu_item',
        description: 'Add a single item to a menu',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site name'
            },
            menuName: {
              type: 'string',
              description: 'Menu name (default: "Main menu")'
            },
            label: {
              type: 'string',
              description: 'Menu item label'
            },
            type: {
              type: 'string',
              enum: ['page', 'post', 'tag', 'frontpage', 'external'],
              description: 'Link type'
            },
            link: {
              type: ['string', 'number'],
              description: 'Link target (page ID for page type, URL for external)'
            },
            position: {
              type: 'number',
              description: 'Position in menu (0-indexed, appends if not specified)'
            },
            target: {
              type: 'string',
              enum: ['_self', '_blank'],
              description: 'Link target attribute (default: _self)'
            },
            cssClass: {
              type: 'string',
              description: 'CSS class'
            }
          },
          required: ['site', 'label', 'type', 'link']
        }
      },
      {
        name: 'remove_menu_item',
        description: 'Remove a menu item by ID or position',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site name'
            },
            menuName: {
              type: 'string',
              description: 'Menu name (default: "Main menu")'
            },
            itemId: {
              type: 'number',
              description: 'Menu item ID to remove'
            },
            position: {
              type: 'number',
              description: 'Position to remove (0-indexed, alternative to itemId)'
            }
          },
          required: ['site']
        }
      },
      {
        name: 'clear_menu',
        description: 'Remove all items from a menu',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site name'
            },
            menuName: {
              type: 'string',
              description: 'Menu name (default: "Main menu")'
            }
          },
          required: ['site']
        }
      }
    ];
  }

  /**
   * Handle tool calls
   */
  static async handleToolCall(toolName, args, appInstance) {
    switch (toolName) {
      case 'get_menu':
        return await this.getMenu(args.site, args.menuName, appInstance);

      case 'set_menu':
        return await this.setMenu(args, appInstance);

      case 'add_menu_item':
        return await this.addMenuItem(args, appInstance);

      case 'remove_menu_item':
        return await this.removeMenuItem(args, appInstance);

      case 'clear_menu':
        return await this.clearMenu(args.site, args.menuName, appInstance);

      default:
        throw new Error(`Unknown menu tool: ${toolName}`);
    }
  }

  /**
   * Get path to menu config file
   */
  static getMenuConfigPath(siteName, appInstance) {
    return path.join(appInstance.sitesDir, siteName, 'input', 'config', 'menu.config.json');
  }

  /**
   * Read menu configuration
   */
  static readMenuConfig(siteName, appInstance) {
    const configPath = this.getMenuConfigPath(siteName, appInstance);

    if (!fs.existsSync(configPath)) {
      return [];
    }

    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
      console.error('[MCP] Error reading menu config:', error);
      return [];
    }
  }

  /**
   * Write menu configuration
   */
  static writeMenuConfig(siteName, menus, appInstance) {
    const configPath = this.getMenuConfigPath(siteName, appInstance);
    fs.writeFileSync(configPath, JSON.stringify(menus, null, 2));
  }

  /**
   * Get menu configuration
   */
  static async getMenu(siteName, menuName, appInstance) {
    try {
      const menus = this.readMenuConfig(siteName, appInstance);

      if (menuName) {
        const menu = menus.find(m => m.name === menuName);
        if (!menu) {
          throw new Error(`Menu "${menuName}" not found`);
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              site: siteName,
              menu: menu
            }, null, 2)
          }]
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            site: siteName,
            count: menus.length,
            menus: menus
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('[MCP] get_menu error:', error);
      throw error;
    }
  }

  /**
   * Set entire menu
   */
  static async setMenu(args, appInstance) {
    try {
      const menuName = args.menuName || 'Main menu';
      const menus = this.readMenuConfig(args.site, appInstance);

      // Create menu items with IDs
      const items = args.items.map(item => this.createMenuItem(item));

      // Find or create menu
      let menu = menus.find(m => m.name === menuName);

      if (!menu) {
        menu = {
          name: menuName,
          position: 'mainMenu',
          items: [],
          maxLevels: '-1'
        };
        menus.push(menu);
      }

      menu.items = items;

      this.writeMenuConfig(args.site, menus, appInstance);

      console.log(`[MCP] Set menu "${menuName}" with ${items.length} items`);

      // Notify frontend
      if (appInstance.mainWindow && appInstance.mainWindow.webContents) {
        appInstance.mainWindow.webContents.send('app-menu-updated');
        console.log('[MCP] Frontend notified of menu update');
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Menu "${menuName}" updated with ${items.length} items`,
            site: args.site
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('[MCP] set_menu error:', error);
      throw error;
    }
  }

  /**
   * Add a single menu item
   */
  static async addMenuItem(args, appInstance) {
    try {
      const menuName = args.menuName || 'Main menu';
      const menus = this.readMenuConfig(args.site, appInstance);

      // Find or create menu
      let menu = menus.find(m => m.name === menuName);

      if (!menu) {
        menu = {
          name: menuName,
          position: 'mainMenu',
          items: [],
          maxLevels: '-1'
        };
        menus.push(menu);
      }

      // Create menu item
      const menuItem = this.createMenuItem({
        label: args.label,
        type: args.type,
        link: args.link,
        target: args.target,
        cssClass: args.cssClass
      });

      // Add at position or append
      if (args.position !== undefined && args.position >= 0 && args.position <= menu.items.length) {
        menu.items.splice(args.position, 0, menuItem);
      } else {
        menu.items.push(menuItem);
      }

      this.writeMenuConfig(args.site, menus, appInstance);

      console.log(`[MCP] Added menu item "${args.label}" to "${menuName}"`);

      // Notify frontend
      if (appInstance.mainWindow && appInstance.mainWindow.webContents) {
        appInstance.mainWindow.webContents.send('app-menu-updated');
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Menu item "${args.label}" added to "${menuName}"`,
            itemId: menuItem.id,
            site: args.site
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('[MCP] add_menu_item error:', error);
      throw error;
    }
  }

  /**
   * Remove a menu item
   */
  static async removeMenuItem(args, appInstance) {
    try {
      const menuName = args.menuName || 'Main menu';
      const menus = this.readMenuConfig(args.site, appInstance);

      const menu = menus.find(m => m.name === menuName);

      if (!menu) {
        throw new Error(`Menu "${menuName}" not found`);
      }

      let removed = false;

      if (args.itemId !== undefined) {
        const index = menu.items.findIndex(item => item.id === args.itemId);
        if (index !== -1) {
          menu.items.splice(index, 1);
          removed = true;
        }
      } else if (args.position !== undefined) {
        if (args.position >= 0 && args.position < menu.items.length) {
          menu.items.splice(args.position, 1);
          removed = true;
        }
      }

      if (!removed) {
        throw new Error('Menu item not found');
      }

      this.writeMenuConfig(args.site, menus, appInstance);

      console.log(`[MCP] Removed menu item from "${menuName}"`);

      // Notify frontend
      if (appInstance.mainWindow && appInstance.mainWindow.webContents) {
        appInstance.mainWindow.webContents.send('app-menu-updated');
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Menu item removed from "${menuName}"`,
            site: args.site
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('[MCP] remove_menu_item error:', error);
      throw error;
    }
  }

  /**
   * Clear all menu items
   */
  static async clearMenu(siteName, menuName, appInstance) {
    try {
      const targetMenu = menuName || 'Main menu';
      const menus = this.readMenuConfig(siteName, appInstance);

      const menu = menus.find(m => m.name === targetMenu);

      if (!menu) {
        throw new Error(`Menu "${targetMenu}" not found`);
      }

      const removedCount = menu.items.length;
      menu.items = [];

      this.writeMenuConfig(siteName, menus, appInstance);

      console.log(`[MCP] Cleared menu "${targetMenu}" (removed ${removedCount} items)`);

      // Notify frontend
      if (appInstance.mainWindow && appInstance.mainWindow.webContents) {
        appInstance.mainWindow.webContents.send('app-menu-updated');
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Menu "${targetMenu}" cleared (removed ${removedCount} items)`,
            site: siteName
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('[MCP] clear_menu error:', error);
      throw error;
    }
  }

  /**
   * Create a menu item object
   */
  static createMenuItem(options) {
    return {
      id: Date.now() + Math.floor(Math.random() * 1000),
      label: options.label,
      title: options.title || '',
      type: options.type,
      target: options.target || '_self',
      rel: options.rel || '',
      link: options.link,
      // NOTE: Do NOT include linkID - it causes rendering errors in Publii
      cssClass: options.cssClass || '',
      isHidden: options.isHidden || false,
      items: options.items || []
    };
  }
}

module.exports = MenuTools;
