/**
 * MCP Tools for Page Operations
 *
 * Pages in Publii are posts with status containing 'is-page'
 */

const path = require('path');
const fs = require('fs-extra');
const Database = require('node-sqlite3-wasm').Database;
const DBUtils = require('../../helpers/db.utils.js');
const Page = require('../../page.js');
const slugify = require('../../helpers/slug.js');
const normalizePath = require('normalize-path');

class PageTools {
  /**
   * Get tool definitions for MCP protocol
   */
  static getToolDefinitions() {
    return [
      {
        name: 'list_pages',
        description: 'List all pages for a site',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site name (catalog name)'
            },
            status: {
              type: 'string',
              description: 'Filter by status: published, draft, hidden',
              enum: ['published', 'draft', 'hidden']
            }
          },
          required: ['site']
        }
      },
      {
        name: 'get_page',
        description: 'Get a single page by ID',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site name'
            },
            id: {
              type: 'number',
              description: 'Page ID'
            }
          },
          required: ['site', 'id']
        }
      },
      {
        name: 'create_page',
        description: 'Create a new page',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site name'
            },
            title: {
              type: 'string',
              description: 'Page title'
            },
            text: {
              type: 'string',
              description: 'Page content (HTML, blocks JSON, or markdown)'
            },
            slug: {
              type: 'string',
              description: 'URL slug (auto-generated if not provided)'
            },
            status: {
              type: 'string',
              description: 'Page status',
              enum: ['published', 'draft', 'hidden'],
              default: 'draft'
            },
            author: {
              type: 'number',
              description: 'Author ID (defaults to 1)'
            },
            template: {
              type: 'string',
              description: 'Template name (optional)'
            },
            editor: {
              type: 'string',
              description: 'Editor type: tinymce, blockeditor, or markdown',
              enum: ['tinymce', 'blockeditor', 'markdown'],
              default: 'tinymce'
            },
            featuredImage: {
              type: 'string',
              description: 'Absolute path to featured image file. Example: "/home/user/images/hero.jpg"'
            },
            featuredImageAlt: {
              type: 'string',
              description: 'Alt text for featured image (for accessibility)'
            },
            featuredImageCaption: {
              type: 'string',
              description: 'Caption text displayed below featured image'
            },
            featuredImageCredits: {
              type: 'string',
              description: 'Credits/attribution for the featured image'
            }
          },
          required: ['site', 'title', 'text']
        }
      },
      {
        name: 'update_page',
        description: 'Update an existing page',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site name'
            },
            id: {
              type: 'number',
              description: 'Page ID to update'
            },
            title: {
              type: 'string',
              description: 'New page title'
            },
            text: {
              type: 'string',
              description: 'New page content'
            },
            slug: {
              type: 'string',
              description: 'New URL slug'
            },
            status: {
              type: 'string',
              description: 'New status',
              enum: ['published', 'draft', 'hidden']
            },
            template: {
              type: 'string',
              description: 'New template name'
            },
            editor: {
              type: 'string',
              description: 'Editor type',
              enum: ['tinymce', 'blockeditor', 'markdown']
            },
            featuredImage: {
              type: 'string',
              description: 'Absolute path to new featured image file. Set to empty string to remove existing image.'
            },
            featuredImageAlt: {
              type: 'string',
              description: 'Alt text for featured image'
            },
            featuredImageCaption: {
              type: 'string',
              description: 'Caption text for featured image'
            },
            featuredImageCredits: {
              type: 'string',
              description: 'Credits/attribution for featured image'
            }
          },
          required: ['site', 'id']
        }
      },
      {
        name: 'delete_page',
        description: 'Delete a page by ID',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site name'
            },
            id: {
              type: 'number',
              description: 'Page ID to delete'
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
      case 'list_pages':
        return await this.listPages(args.site, args.status, appInstance);

      case 'get_page':
        return await this.getPage(args.site, args.id, appInstance);

      case 'create_page':
        return await this.createPage(args, appInstance);

      case 'update_page':
        return await this.updatePage(args, appInstance);

      case 'delete_page':
        return await this.deletePage(args.site, args.id, appInstance);

      default:
        throw new Error(`Unknown page tool: ${toolName}`);
    }
  }

  /**
   * Ensure database connection to the specified site
   */
  static async ensureSiteConnection(siteName, appInstance) {
    // Validate site name is provided
    if (!siteName || typeof siteName !== 'string') {
      const availableSites = Object.keys(appInstance.sites || {}).join(', ');
      throw new Error(`Site name is required. Available sites: ${availableSites || 'none found'}. Use list_sites tool first.`);
    }

    // Check if site exists
    if (!appInstance.sites || !appInstance.sites[siteName]) {
      const availableSites = Object.keys(appInstance.sites || {}).join(', ');
      throw new Error(`Site "${siteName}" not found. Available sites: ${availableSites || 'none'}. Use list_sites tool first.`);
    }

    const siteDir = path.join(appInstance.sitesDir, siteName);
    const dbPath = path.join(siteDir, 'input', 'db.sqlite');

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
   * List all pages for a site
   */
  static async listPages(siteName, status, appInstance) {
    try {
      // Query pages directly - they have 'is-page' in status
      let sql = "SELECT * FROM posts WHERE status LIKE '%is-page%'";
      const params = {};

      if (status) {
        sql += " AND status LIKE ?";
        params.status = `%${status}%`;
      }

      sql += ' ORDER BY modified_at DESC';

      const pages = appInstance.db.prepare(sql).all(status ? [`%${status}%`] : []);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            site: siteName,
            count: pages.length,
            pages: pages.map(p => ({
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
      console.error('[MCP] list_pages error:', error);
      throw error;
    }
  }

  /**
   * Get a single page
   */
  static async getPage(siteName, pageId, appInstance) {
    try {
      const page = new Page(appInstance, { site: siteName, id: pageId });
      const result = page.load();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            site: siteName,
            page: result
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('[MCP] get_page error:', error);
      throw error;
    }
  }

  /**
   * Create a new page
   */
  static async createPage(args, appInstance) {
    try {
      const now = Date.now();
      const pageSlug = args.slug || slugify(args.title);

      // Pages have status with 'is-page' suffix
      const baseStatus = args.status || 'draft';

      // Handle featured image if provided
      let featuredImage = '';
      let featuredImageFilename = '';
      let featuredImageData = false;

      if (args.featuredImage) {
        // Validate source file exists
        if (!fs.existsSync(args.featuredImage)) {
          throw new Error(`Featured image file not found: ${args.featuredImage}`);
        }

        featuredImageFilename = path.basename(args.featuredImage);

        // Featured image data with alt, caption, credits
        featuredImageData = {
          alt: args.featuredImageAlt || '',
          caption: args.featuredImageCaption || '',
          credits: args.featuredImageCredits || ''
        };

        // For new pages, we need to copy to temp directory first
        // Publii will move it to the correct page ID directory after saving
        const siteDir = path.join(appInstance.sitesDir, args.site);
        const tempImagesDir = path.join(siteDir, 'input', 'media', 'posts', 'temp');

        // Ensure temp directory exists
        fs.ensureDirSync(tempImagesDir);

        // Slugify the filename for consistency
        const fileNameData = path.parse(featuredImageFilename);
        const finalFileName = slugify(fileNameData.name, false, true) + fileNameData.ext;
        const destPath = path.join(tempImagesDir, finalFileName);

        // Copy the image file
        fs.copySync(args.featuredImage, destPath);

        // Set the featured image path (Publii expects the full path)
        featuredImage = normalizePath(destPath);
        featuredImageFilename = finalFileName;

        console.log(`[MCP] Copied featured image to: ${destPath}`);
      }

      const pageData = {
        site: args.site,
        id: 0, // 0 = new page
        title: args.title,
        slug: pageSlug,
        text: args.text,
        author: args.author || 1,
        status: baseStatus,
        creationDate: now,
        modificationDate: now,
        template: args.template || '',
        featuredImage: featuredImage,
        featuredImageFilename: featuredImageFilename,
        featuredImageData: featuredImageData,
        additionalData: {
          metaTitle: '',
          metaDesc: '',
          metaRobots: 'index, follow',
          canonicalUrl: '',
          editor: args.editor || 'tinymce'
        },
        pageViewSettings: {}
      };

      const page = new Page(appInstance, pageData);
      const result = page.save();

      console.log(`[MCP] Created page: ${args.title} (ID: ${result.pageID})`);

      // Notify frontend
      if (appInstance.mainWindow && appInstance.mainWindow.webContents) {
        appInstance.mainWindow.webContents.send('app-page-saved', result);
        console.log('[MCP] Frontend notified of new page');
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Page "${args.title}" created successfully`,
            pageId: result.pageID,
            site: args.site
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('[MCP] create_page error:', error);
      throw error;
    }
  }

  /**
   * Update an existing page
   */
  static async updatePage(args, appInstance) {
    try {
      // Load existing page
      const page = new Page(appInstance, { site: args.site, id: args.id });
      const existingData = page.load();

      if (!existingData || !existingData.pages || existingData.pages.length === 0) {
        throw new Error(`Page ${args.id} not found`);
      }

      const existing = existingData.pages[0];
      const now = Date.now();

      // Extract existing featured image info from loaded data
      // Note: page.load() returns featuredImage as { url, additional_data } from posts_images table
      let existingFeaturedImageUrl = '';
      let existingFeaturedImageData = false;

      if (existingData.featuredImage && existingData.featuredImage.url) {
        existingFeaturedImageUrl = existingData.featuredImage.url;
        try {
          existingFeaturedImageData = existingData.featuredImage.additional_data
            ? JSON.parse(existingData.featuredImage.additional_data)
            : false;
        } catch (e) {
          existingFeaturedImageData = false;
        }
      }

      // Handle featured image update
      let featuredImage = existingFeaturedImageUrl ? path.join(
        appInstance.sitesDir, args.site, 'input', 'media', 'posts', args.id.toString(), existingFeaturedImageUrl
      ) : '';
      let featuredImageFilename = existingFeaturedImageUrl || '';
      let featuredImageData = existingFeaturedImageData;

      // Check if featured image is being updated
      if (args.featuredImage !== undefined) {
        if (args.featuredImage === '') {
          // User wants to remove the featured image
          featuredImage = '';
          featuredImageFilename = '';
          featuredImageData = false;
          console.log('[MCP] Removing featured image');
        } else if (fs.existsSync(args.featuredImage)) {
          // New featured image provided
          const siteDir = path.join(appInstance.sitesDir, args.site);
          const pageImagesDir = path.join(siteDir, 'input', 'media', 'posts', args.id.toString());

          // Ensure page images directory exists
          fs.ensureDirSync(pageImagesDir);

          // Slugify the filename
          const originalFilename = path.basename(args.featuredImage);
          const fileNameData = path.parse(originalFilename);
          const finalFileName = slugify(fileNameData.name, false, true) + fileNameData.ext;
          const destPath = path.join(pageImagesDir, finalFileName);

          // Copy the image file
          fs.copySync(args.featuredImage, destPath);

          featuredImage = normalizePath(destPath);
          featuredImageFilename = finalFileName;
          featuredImageData = {
            alt: args.featuredImageAlt || '',
            caption: args.featuredImageCaption || '',
            credits: args.featuredImageCredits || ''
          };

          console.log(`[MCP] Updated featured image: ${destPath}`);
        } else {
          throw new Error(`Featured image file not found: ${args.featuredImage}`);
        }
      } else if (args.featuredImageAlt !== undefined || args.featuredImageCaption !== undefined || args.featuredImageCredits !== undefined) {
        // Update just the featured image metadata without changing the image itself
        if (featuredImageData) {
          featuredImageData = {
            alt: args.featuredImageAlt !== undefined ? args.featuredImageAlt : (featuredImageData.alt || ''),
            caption: args.featuredImageCaption !== undefined ? args.featuredImageCaption : (featuredImageData.caption || ''),
            credits: args.featuredImageCredits !== undefined ? args.featuredImageCredits : (featuredImageData.credits || '')
          };
        }
      }

      // Merge existing data with updates
      // Note: DB columns are: id, title, authors, slug, text, featured_image_id, created_at, modified_at, status, template
      const pageData = {
        site: args.site,
        id: args.id,
        title: args.title !== undefined ? args.title : existing.title,
        slug: args.slug !== undefined ? args.slug : existing.slug,
        text: args.text !== undefined ? args.text : existing.text,
        author: existing.authors,  // DB column is 'authors'
        status: args.status !== undefined ? args.status : existing.status.replace(',is-page', ''),
        creationDate: existing.created_at,  // DB column is 'created_at'
        modificationDate: now,
        template: args.template !== undefined ? args.template : (existing.template || ''),
        featuredImage: featuredImage,
        featuredImageFilename: featuredImageFilename,
        featuredImageData: featuredImageData,
        additionalData: {
          ...(existingData.additionalData || {}),  // From existingData, not existing
          editor: args.editor !== undefined ? args.editor : (existingData.additionalData?.editor || 'tinymce')
        },
        pageViewSettings: existingData.pageViewSettings || {}  // From existingData, not existing
      };

      const updatedPage = new Page(appInstance, pageData);
      const result = updatedPage.save();

      console.log(`[MCP] Updated page: ${pageData.title} (ID: ${args.id})`);

      // Notify frontend
      if (appInstance.mainWindow && appInstance.mainWindow.webContents) {
        appInstance.mainWindow.webContents.send('app-page-saved', result);
        console.log('[MCP] Frontend notified of updated page');
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Page "${pageData.title}" updated successfully`,
            pageId: args.id,
            site: args.site
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('[MCP] update_page error:', error);
      throw error;
    }
  }

  /**
   * Delete a page
   */
  static async deletePage(siteName, pageId, appInstance) {
    try {
      const page = new Page(appInstance, { site: siteName, id: pageId });
      const result = page.delete();

      console.log(`[MCP] Deleted page ID: ${pageId}`);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Page ${pageId} deleted successfully`,
            site: siteName
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('[MCP] delete_page error:', error);
      throw error;
    }
  }
}

module.exports = PageTools;
