/**
 * MCP Tools for Post Operations
 *
 * Wraps Publii's Post class for creating and managing posts
 */

const path = require('path');
const Database = require('node-sqlite3-wasm').Database;
const DBUtils = require('../../helpers/db.utils.js');
const Post = require('../../post.js');
const Posts = require('../../posts.js');
const slugify = require('../../helpers/slug.js');

class PostTools {
  /**
   * Get tool definitions for MCP protocol
   */
  static getToolDefinitions() {
    return [
      {
        name: 'list_posts',
        description: 'List all posts for a site',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site name (catalog name)'
            },
            status: {
              type: 'string',
              description: 'Filter by status: published, draft, hidden, trashed',
              enum: ['published', 'draft', 'hidden', 'trashed']
            }
          },
          required: ['site']
        }
      },
      {
        name: 'get_post',
        description: 'Get a single post by ID',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site name'
            },
            id: {
              type: 'number',
              description: 'Post ID'
            }
          },
          required: ['site', 'id']
        }
      },
      {
        name: 'create_post',
        description: 'Create a new post with HTML content',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site name'
            },
            title: {
              type: 'string',
              description: 'Post title'
            },
            text: {
              type: 'string',
              description: 'Post content in HTML'
            },
            slug: {
              type: 'string',
              description: 'URL slug (auto-generated if not provided)'
            },
            status: {
              type: 'string',
              description: 'Post status',
              enum: ['published', 'draft', 'hidden'],
              default: 'draft'
            },
            author: {
              type: 'number',
              description: 'Author ID (defaults to 1)'
            },
            tags: {
              type: 'array',
              items: { type: 'number' },
              description: 'Array of tag IDs'
            },
            template: {
              type: 'string',
              description: 'Template name (optional)'
            },
            editor: {
              type: 'string',
              description: 'Editor type: tinymce (WYSIWYG), blockeditor, or markdown',
              enum: ['tinymce', 'blockeditor', 'markdown'],
              default: 'tinymce'
            }
          },
          required: ['site', 'title', 'text']
        }
      },
      {
        name: 'delete_post',
        description: 'Delete a post by ID',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site name'
            },
            id: {
              type: 'number',
              description: 'Post ID to delete'
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
      case 'list_posts':
        return await this.listPosts(args.site, args.status, appInstance);

      case 'get_post':
        return await this.getPost(args.site, args.id, appInstance);

      case 'create_post':
        return await this.createPost(args, appInstance);

      case 'delete_post':
        return await this.deletePost(args.site, args.id, appInstance);

      default:
        throw new Error(`Unknown post tool: ${toolName}`);
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
   * List all posts for a site
   */
  static async listPosts(siteName, status, appInstance) {
    try {
      const posts = new Posts(appInstance, { site: siteName });
      let allPosts = posts.load();

      // Filter by status if specified
      if (status) {
        allPosts = allPosts.filter(p => p.status === status);
      }

      // Filter out pages (status contains 'is-page')
      allPosts = allPosts.filter(p => !p.status.includes('is-page'));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            site: siteName,
            count: allPosts.length,
            posts: allPosts.map(p => ({
              id: p.id,
              title: p.title,
              slug: p.slug,
              status: p.status,
              created_at: p.created_at,
              modified_at: p.modified_at
            }))
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('[MCP] list_posts error:', error);
      throw error;
    }
  }

  /**
   * Get a single post
   */
  static async getPost(siteName, postId, appInstance) {
    try {
      const post = new Post(appInstance, { site: siteName, id: postId });
      const result = post.load();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            site: siteName,
            post: result
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('[MCP] get_post error:', error);
      throw error;
    }
  }

  /**
   * Create a new post
   */
  static async createPost(args, appInstance) {
    try {
      const now = Date.now();

      // Generate slug from title if not provided
      const postSlug = args.slug || slugify(args.title);

      const postData = {
        site: args.site,
        id: 0, // 0 = new post
        title: args.title,
        slug: postSlug,
        text: args.text,
        author: args.author || 1,
        status: args.status || 'draft',
        creationDate: now,
        modificationDate: now,
        template: args.template || '',
        tags: args.tags || [],
        featuredImage: '',
        featuredImageFilename: '',
        featuredImageData: false,
        additionalData: {
          metaTitle: '',
          metaDesc: '',
          metaRobots: 'index, follow',
          canonicalUrl: '',
          mainTag: 0,
          editor: args.editor || 'tinymce'
        },
        postViewSettings: {}
      };

      const post = new Post(appInstance, postData);
      const result = post.save();

      console.log(`[MCP] Created post: ${args.title} (ID: ${result.postID})`);

      // Notify frontend to refresh posts list
      if (appInstance.mainWindow && appInstance.mainWindow.webContents) {
        appInstance.mainWindow.webContents.send('app-post-saved', result);
        console.log('[MCP] Frontend notified of new post');
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Post "${args.title}" created successfully`,
            postId: result.postID,
            site: args.site
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('[MCP] create_post error:', error);
      throw error;
    }
  }

  /**
   * Delete a post
   */
  static async deletePost(siteName, postId, appInstance) {
    try {
      const post = new Post(appInstance, { site: siteName, id: postId });
      const result = post.delete();

      console.log(`[MCP] Deleted post ID: ${postId}`);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Post ${postId} deleted successfully`,
            site: siteName
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('[MCP] delete_post error:', error);
      throw error;
    }
  }
}

module.exports = PostTools;
