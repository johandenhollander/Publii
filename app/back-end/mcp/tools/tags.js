/**
 * MCP Tools for Tag Operations
 *
 * Manages tags for posts
 */

const path = require('path');
const Database = require('node-sqlite3-wasm').Database;
const DBUtils = require('../../helpers/db.utils.js');
const slugify = require('../../helpers/slug.js');

class TagTools {
  /**
   * Get tool definitions for MCP protocol
   */
  static getToolDefinitions() {
    return [
      {
        name: 'list_tags',
        description: 'List all tags for a site',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site name (catalog name)'
            }
          },
          required: ['site']
        }
      },
      {
        name: 'get_tag',
        description: 'Get a single tag by ID',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site name'
            },
            id: {
              type: 'number',
              description: 'Tag ID'
            }
          },
          required: ['site', 'id']
        }
      },
      {
        name: 'create_tag',
        description: 'Create a new tag',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site name'
            },
            name: {
              type: 'string',
              description: 'Tag name'
            },
            slug: {
              type: 'string',
              description: 'URL slug (auto-generated if not provided)'
            },
            description: {
              type: 'string',
              description: 'Tag description'
            }
          },
          required: ['site', 'name']
        }
      },
      {
        name: 'update_tag',
        description: 'Update an existing tag',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site name'
            },
            id: {
              type: 'number',
              description: 'Tag ID to update'
            },
            name: {
              type: 'string',
              description: 'New tag name'
            },
            slug: {
              type: 'string',
              description: 'New URL slug'
            },
            description: {
              type: 'string',
              description: 'New tag description'
            }
          },
          required: ['site', 'id']
        }
      },
      {
        name: 'delete_tag',
        description: 'Delete a tag by ID',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site name'
            },
            id: {
              type: 'number',
              description: 'Tag ID to delete'
            }
          },
          required: ['site', 'id']
        }
      }
    ];
  }

  /**
   * Handle tool calls
   */
  static async handleToolCall(toolName, args, appInstance) {
    // Ensure we're connected to the right site's database
    await this.ensureSiteConnection(args.site, appInstance);

    switch (toolName) {
      case 'list_tags':
        return await this.listTags(args.site, appInstance);

      case 'get_tag':
        return await this.getTag(args.site, args.id, appInstance);

      case 'create_tag':
        return await this.createTag(args, appInstance);

      case 'update_tag':
        return await this.updateTag(args, appInstance);

      case 'delete_tag':
        return await this.deleteTag(args.site, args.id, appInstance);

      default:
        throw new Error(`Unknown tag tool: ${toolName}`);
    }
  }

  /**
   * Ensure database connection to the specified site
   */
  static async ensureSiteConnection(siteName, appInstance) {
    const siteDir = path.join(appInstance.sitesDir, siteName);
    const dbPath = path.join(siteDir, 'input', 'db.sqlite');

    // Check if site exists
    if (!appInstance.sites[siteName]) {
      throw new Error(`Site not found: ${siteName}`);
    }

    // Connect to site database
    if (appInstance.db) {
      try {
        appInstance.db.close();
      } catch (e) {
        // Already closed
      }
    }

    appInstance.db = new DBUtils(new Database(dbPath));
    console.log(`[MCP] Connected to database: ${dbPath}`);
  }

  /**
   * List all tags for a site
   */
  static async listTags(siteName, appInstance) {
    try {
      const tags = appInstance.db.prepare('SELECT * FROM tags ORDER BY name ASC').all();

      // Get post count for each tag
      const tagsWithCount = tags.map(tag => {
        const countResult = appInstance.db.prepare(
          'SELECT COUNT(*) as count FROM posts_tags WHERE tag_id = ?'
        ).get([tag.id]);

        return {
          id: tag.id,
          name: tag.name,
          slug: tag.slug,
          description: tag.description || '',
          postCount: countResult?.count || 0
        };
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            site: siteName,
            count: tagsWithCount.length,
            tags: tagsWithCount
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('[MCP] list_tags error:', error);
      throw error;
    }
  }

  /**
   * Get a single tag
   */
  static async getTag(siteName, tagId, appInstance) {
    try {
      const tag = appInstance.db.prepare('SELECT * FROM tags WHERE id = ?').get([tagId]);

      if (!tag) {
        throw new Error(`Tag ${tagId} not found`);
      }

      // Get posts with this tag
      const posts = appInstance.db.prepare(`
        SELECT p.id, p.title, p.slug, p.status
        FROM posts p
        INNER JOIN posts_tags pt ON p.id = pt.post_id
        WHERE pt.tag_id = ?
        ORDER BY p.modified_at DESC
      `).all([tagId]);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            site: siteName,
            tag: {
              id: tag.id,
              name: tag.name,
              slug: tag.slug,
              description: tag.description || '',
              posts: posts
            }
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('[MCP] get_tag error:', error);
      throw error;
    }
  }

  /**
   * Create a new tag
   */
  static async createTag(args, appInstance) {
    try {
      const tagSlug = args.slug || slugify(args.name);

      const result = appInstance.db.prepare(`
        INSERT INTO tags (name, slug, description, additional_data)
        VALUES (?, ?, ?, ?)
      `).run([
        args.name,
        tagSlug,
        args.description || '',
        '{}'
      ]);

      const tagId = result.lastInsertRowid;

      console.log(`[MCP] Created tag: ${args.name} (ID: ${tagId})`);

      // Notify frontend
      if (appInstance.mainWindow && appInstance.mainWindow.webContents) {
        appInstance.mainWindow.webContents.send('app-tag-saved', { tagID: tagId });
        console.log('[MCP] Frontend notified of new tag');
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Tag "${args.name}" created successfully`,
            tagId: tagId,
            site: args.site
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('[MCP] create_tag error:', error);
      throw error;
    }
  }

  /**
   * Update an existing tag
   */
  static async updateTag(args, appInstance) {
    try {
      // Check if tag exists
      const existing = appInstance.db.prepare('SELECT * FROM tags WHERE id = ?').get([args.id]);

      if (!existing) {
        throw new Error(`Tag ${args.id} not found`);
      }

      // Build update query
      const updates = [];
      const values = [];

      if (args.name !== undefined) {
        updates.push('name = ?');
        values.push(args.name);
      }

      if (args.slug !== undefined) {
        updates.push('slug = ?');
        values.push(args.slug);
      }

      if (args.description !== undefined) {
        updates.push('description = ?');
        values.push(args.description);
      }

      if (updates.length > 0) {
        values.push(args.id);
        appInstance.db.prepare(`UPDATE tags SET ${updates.join(', ')} WHERE id = ?`).run(values);
      }

      console.log(`[MCP] Updated tag ID: ${args.id}`);

      // Notify frontend
      if (appInstance.mainWindow && appInstance.mainWindow.webContents) {
        appInstance.mainWindow.webContents.send('app-tag-saved', { tagID: args.id });
        console.log('[MCP] Frontend notified of updated tag');
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Tag ${args.id} updated successfully`,
            tagId: args.id,
            site: args.site
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('[MCP] update_tag error:', error);
      throw error;
    }
  }

  /**
   * Delete a tag
   */
  static async deleteTag(siteName, tagId, appInstance) {
    try {
      // Remove tag associations first
      appInstance.db.prepare('DELETE FROM posts_tags WHERE tag_id = ?').run([tagId]);

      // Delete the tag
      appInstance.db.prepare('DELETE FROM tags WHERE id = ?').run([tagId]);

      console.log(`[MCP] Deleted tag ID: ${tagId}`);

      // Notify frontend
      if (appInstance.mainWindow && appInstance.mainWindow.webContents) {
        appInstance.mainWindow.webContents.send('app-tag-deleted', { tagID: tagId });
        console.log('[MCP] Frontend notified of deleted tag');
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Tag ${tagId} deleted successfully`,
            site: siteName
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('[MCP] delete_tag error:', error);
      throw error;
    }
  }
}

module.exports = TagTools;
