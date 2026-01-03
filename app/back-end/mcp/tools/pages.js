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
const { saveFeaturedImage } = require('../helpers/featured-image.js');
const BlockEditorHelper = require('../helpers/block-editor.js');

/**
 * Strip CDATA wrapper from text content.
 * AI assistants sometimes wrap content in CDATA tags which should not be stored literally.
 * @param {string} text - The text content
 * @returns {string} - The text without CDATA wrapper
 */
function stripCDATA(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/^<!\[CDATA\[/, '')
    .replace(/\]\]>$/, '')
    .trim();
}

/**
 * Convert any file:/// URLs in content to relative paths.
 * Handles URLs pointing to any location within the site's media directory.
 * @param {string} text - The HTML content
 * @param {string} sitePath - Path to the site directory
 * @param {number} pageId - The page ID (for logging)
 * @returns {string} - The text with converted URLs
 */
function convertAllFileUrls(text, sitePath, pageId) {
  if (!text || typeof text !== 'string') return text;

  const mediaDir = path.join(sitePath, 'input', 'media');
  const mediaDirNormalized = normalizePath(mediaDir);
  const mediaDirWithoutSlash = mediaDirNormalized.replace(/^\//, '');
  const escapedMediaDir = mediaDirWithoutSlash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Match file:// followed by any number of slashes, then the media path
  const fileUrlPattern = new RegExp(`file:/{2,}/?${escapedMediaDir}/([^"'\\s]+)`, 'gi');

  const matches = [...text.matchAll(fileUrlPattern)];
  if (matches.length > 0) {
    console.error(`[MCP] Found ${matches.length} file:/// URLs to convert for page ${pageId}`);
  }

  // Convert: file:///path/to/site/input/media/posts/88/image.jpg -> /media/posts/88/image.jpg
  return text.replace(fileUrlPattern, '/media/$1');
}

/**
 * Convert file:/// URLs to relative paths and copy images from temp to page directory.
 * This handles the case where Page.save() doesn't do the conversion (e.g., when temp dir was already processed).
 * @param {string} text - The HTML content
 * @param {string} sitePath - Path to the site directory
 * @param {number} pageId - The page ID (used for the target directory)
 * @returns {string} - The text with converted URLs
 */
function convertTempImageUrls(text, sitePath, pageId) {
  if (!text || typeof text !== 'string') return text;

  const tempDir = path.join(sitePath, 'input', 'media', 'posts', 'temp');
  const pageDir = path.join(sitePath, 'input', 'media', 'posts', pageId.toString());
  const tempDirNormalized = normalizePath(tempDir);

  // First, normalize all file:// URLs to a consistent format
  // file://// -> file:/// and handle both /home and home after slashes
  let convertedText = text;

  // Extract filenames from file:/// URLs pointing to temp directory
  // Handle both: file:///home/... and file:////home/... (extra slashes)
  const tempDirWithoutSlash = tempDirNormalized.replace(/^\//, '');
  const escapedTempDir = tempDirWithoutSlash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Match file:// followed by any number of slashes, optional leading slash, then the temp path
  const fileUrlPattern = new RegExp(`file:/{2,}/?${escapedTempDir}/([^"'\\s]+)`, 'gi');

  const matches = [...text.matchAll(fileUrlPattern)];
  const filesToCopy = new Set();

  for (const match of matches) {
    filesToCopy.add(match[1]); // filename including responsive/ subdirectory
    console.error(`[MCP] Found temp image: ${match[1]}`);
  }

  // Copy files from temp to page directory if they exist
  if (filesToCopy.size > 0) {
    try {
      fs.ensureDirSync(pageDir);

      for (const filename of filesToCopy) {
        const srcFile = path.join(tempDir, filename);
        const destFile = path.join(pageDir, filename);

        if (fs.existsSync(srcFile)) {
          fs.ensureDirSync(path.dirname(destFile));
          fs.copySync(srcFile, destFile);
          console.error(`[MCP] Copied image: ${filename} to page ${pageId}`);
        } else {
          console.error(`[MCP] Warning: Source file not found: ${srcFile}`);
        }
      }
    } catch (e) {
      console.error(`[MCP] Warning: Could not copy images: ${e.message}`);
    }
  }

  // Convert URLs: file:///path/to/temp/image.jpg -> #DOMAIN_NAME#image.jpg
  // Use #DOMAIN_NAME# placeholder so Publii editor can display images
  convertedText = convertedText.replace(fileUrlPattern, `#DOMAIN_NAME#$1`);

  console.error(`[MCP] URL conversion complete for page ${pageId}, found ${filesToCopy.size} images`);

  return convertedText;
}

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
              description: 'Page content (HTML, blocks JSON, or markdown). To include images: upload with upload_image first, then use the returned relative URL: <img src="/media/posts/88/image.jpg">'
            },
            slug: {
              type: 'string',
              description: 'URL slug (auto-generated if not provided)'
            },
            status: {
              type: 'string',
              description: 'Page status. Defaults to "published" when created via MCP',
              enum: ['published', 'draft', 'hidden'],
              default: 'published'
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

    try {
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
    } finally {
      // Always close database connection to prevent locks
      this.closeConnection(appInstance);
    }
  }

  /**
   * Close database connection to prevent locks
   */
  static closeConnection(appInstance) {
    if (appInstance.db) {
      try {
        appInstance.db.close();
        appInstance.db = null;
      } catch (e) {
        // Already closed
      }
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
    console.error(`[MCP] Connected to database: ${dbPath}`);
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
      const baseStatus = args.status || 'published';

      // Handle featured image if provided - use Publii's Image class for responsive generation
      let featuredImage = '';
      let featuredImageFilename = '';
      let featuredImageData = false;

      if (args.featuredImage) {
        // Use Publii's Image class to save image with responsive versions
        // For new pages, use 0 as ID - Image class converts 0 to 'temp' directory
        const imageResult = await saveFeaturedImage(
          args.featuredImage,
          appInstance,
          args.site,
          0,  // 0 = new page, Image class will use 'temp' directory
          'featuredImages'
        );

        featuredImage = imageResult.featuredImage;
        featuredImageFilename = imageResult.featuredImageFilename;
        featuredImageData = {
          alt: args.featuredImageAlt || '',
          caption: args.featuredImageCaption || '',
          credits: args.featuredImageCredits || ''
        };

        console.error(`[MCP] Saved featured image with responsive versions: ${featuredImageFilename}`);
      }

      // Transform block editor content if needed
      // Strip CDATA wrapper if present (AI assistants sometimes add this)
      let pageText = stripCDATA(args.text);
      const editorType = args.editor || 'tinymce';

      if (editorType === 'blockeditor') {
        const sitePath = path.join(appInstance.sitesDir, args.site);
        pageText = BlockEditorHelper.transformContent(args.text, {
          sitePath: sitePath,
          postId: 0,  // New page uses temp directory
          db: null    // Images will be registered after page is saved
        });
        console.error('[MCP] Transformed block editor content for new page');
      }

      // Pages need ',is-page' suffix in status
      const fullStatus = baseStatus + ',is-page';

      // BEFORE calling page.save(), backup temp images so they survive multiple page creations
      // Page.save() deletes temp after processing the first page
      const sitePath = path.join(appInstance.sitesDir, args.site);
      const tempDir = path.join(sitePath, 'input', 'media', 'posts', 'temp');
      const backupDir = path.join(sitePath, 'input', 'media', 'posts', 'mcp-backup');

      // Backup temp files if they exist
      if (fs.existsSync(tempDir)) {
        try {
          fs.ensureDirSync(backupDir);
          fs.copySync(tempDir, backupDir, { overwrite: true });
          console.error('[MCP] Backed up temp images to mcp-backup');
        } catch (e) {
          console.error('[MCP] Warning: Could not backup temp images:', e.message);
        }
      }

      const pageData = {
        site: args.site,
        id: 0, // 0 = new page
        title: args.title,
        slug: pageSlug,
        text: pageText,
        author: args.author || 1,
        status: fullStatus,
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
          editor: editorType
        },
        pageViewSettings: {}
      };

      const page = new Page(appInstance, pageData);
      const result = page.save();

      // Convert temp URLs to page-specific URLs
      // This handles both file:/// URLs and /media/posts/temp/ relative URLs
      if (result.pageID) {
        try {
          const savedPage = appInstance.db.prepare('SELECT text FROM posts WHERE id = @id').get({ id: result.pageID });

          if (savedPage && savedPage.text) {
            let convertedText = savedPage.text;
            let needsUpdate = false;

            // Handle file:/// URLs (legacy format)
            if (convertedText.includes('file:///')) {
              // Restore temp from backup so convertTempImageUrls can find the files
              if (fs.existsSync(backupDir) && !fs.existsSync(tempDir)) {
                fs.copySync(backupDir, tempDir);
                console.error('[MCP] Restored temp from mcp-backup');
              }
              convertedText = convertTempImageUrls(convertedText, sitePath, result.pageID);
              needsUpdate = true;
              console.error('[MCP] Converted file:/// URLs to relative paths for page', result.pageID);
            }

            // Handle /media/posts/temp/ relative URLs (new format from upload_image)
            if (convertedText.includes('/media/posts/temp/')) {
              // First, copy files from temp to page directory
              const pageDir = path.join(sitePath, 'input', 'media', 'posts', result.pageID.toString());
              const tempDirForCopy = path.join(sitePath, 'input', 'media', 'posts', 'temp');

              // Also check mcp-backup if temp was already processed
              const backupDirForCopy = path.join(sitePath, 'input', 'media', 'posts', 'mcp-backup');
              const sourceDir = fs.existsSync(tempDirForCopy) ? tempDirForCopy :
                               (fs.existsSync(backupDirForCopy) ? backupDirForCopy : null);

              if (sourceDir) {
                // Extract filenames from content
                const imgRegex = /\/media\/posts\/temp\/([^"'\s]+)/g;
                const imgMatches = [...convertedText.matchAll(imgRegex)];
                const filesToCopy = new Set(imgMatches.map(m => m[1]));

                if (filesToCopy.size > 0) {
                  fs.ensureDirSync(pageDir);
                  for (const filename of filesToCopy) {
                    const srcFile = path.join(sourceDir, filename);
                    const destFile = path.join(pageDir, filename);
                    if (fs.existsSync(srcFile)) {
                      fs.ensureDirSync(path.dirname(destFile));
                      fs.copySync(srcFile, destFile);
                      console.error(`[MCP] Copied content image: ${filename} to page ${result.pageID}`);
                    }
                  }
                }
              }

              // Then update URLs in content - use #DOMAIN_NAME# placeholder so Publii editor can display images
              convertedText = convertedText.replace(/\/media\/posts\/temp\//g, `#DOMAIN_NAME#`);
              needsUpdate = true;
              console.error('[MCP] Converted /media/posts/temp/ URLs to #DOMAIN_NAME# for page', result.pageID);
            }

            if (needsUpdate) {
              appInstance.db.prepare('UPDATE posts SET text = @text WHERE id = @id').run({ text: convertedText, id: result.pageID });
            }
          }
        } catch (e) {
          console.error('[MCP] Warning: Could not convert image URLs:', e.message);
        }
      }

      // Fix block editor image URLs: Page.save() produces #DOMAIN_NAME#/filename
      // but it should be #DOMAIN_NAME#filename (without the slash)
      if (editorType === 'blockeditor' && result.pageID) {
        try {
          const fixedText = appInstance.db.prepare('SELECT text FROM posts WHERE id = @id').get({ id: result.pageID });
          if (fixedText && fixedText.text && fixedText.text.includes('#DOMAIN_NAME#/')) {
            const correctedText = fixedText.text.replace(/#DOMAIN_NAME#\//g, '#DOMAIN_NAME#');
            appInstance.db.prepare('UPDATE posts SET text = @text WHERE id = @id').run({ text: correctedText, id: result.pageID });
            console.error('[MCP] Fixed block editor image URLs for page', result.pageID);
          }
        } catch (e) {
          console.error('[MCP] Warning: Could not fix image URLs:', e.message);
        }
      }

      // Register content images for block editor pages
      if (editorType === 'blockeditor' && result.pageID) {
        try {
          const sitePath = path.join(appInstance.sitesDir, args.site);
          BlockEditorHelper.registerContentImagesFromText(
            appInstance.db,
            result.pageID,
            pageText,
            sitePath
          );
        } catch (e) {
          console.error('[MCP] Warning: Could not register content images:', e.message);
        }
      }

      // Validate block editor image paths
      let imageValidation = null;
      if (editorType === 'blockeditor' && result.pageID) {
        try {
          const sitePath = path.join(appInstance.sitesDir, args.site);
          imageValidation = BlockEditorHelper.validateImagePaths(pageText, sitePath, result.pageID);
          if (!imageValidation.valid) {
            console.error(`[MCP] Warning: ${imageValidation.missingImages.length} missing images in page ${result.pageID}`);
          }
        } catch (e) {
          console.error('[MCP] Warning: Could not validate image paths:', e.message);
        }
      }

      console.error(`[MCP] Created page: ${args.title} (ID: ${result.pageID})`);

      // Notify frontend
      if (appInstance.mainWindow && appInstance.mainWindow.webContents) {
        appInstance.mainWindow.webContents.send('app-page-saved', result);
        console.error('[MCP] Frontend notified of new page');
      }

      // Build response with optional warnings
      const response = {
        success: true,
        message: `Page "${args.title}" created successfully`,
        pageId: result.pageID,
        site: args.site
      };

      // Add image validation warnings if there are missing images
      if (imageValidation && !imageValidation.valid) {
        response.warnings = {
          missingImages: imageValidation.missingImages.map(img => ({
            filename: img.filename,
            url: img.url,
            type: img.type
          })),
          suggestions: imageValidation.suggestions
        };
        response.message += ` (WARNING: ${imageValidation.missingImages.length} image(s) not found - they may not display correctly)`;
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(response, null, 2)
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
          console.error('[MCP] Removing featured image');
        } else {
          // New featured image provided - use Publii's Image class for responsive generation
          const imageResult = await saveFeaturedImage(
            args.featuredImage,
            appInstance,
            args.site,
            args.id,  // Use actual page ID for existing pages
            'featuredImages'
          );

          featuredImage = imageResult.featuredImage;
          featuredImageFilename = imageResult.featuredImageFilename;
          featuredImageData = {
            alt: args.featuredImageAlt || '',
            caption: args.featuredImageCaption || '',
            credits: args.featuredImageCredits || ''
          };

          console.error(`[MCP] Updated featured image with responsive versions: ${featuredImageFilename}`);
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

      // Determine editor type
      const editorType = args.editor !== undefined ? args.editor : (existingData.additionalData?.editor || 'tinymce');

      // Transform block editor content if text is being updated
      // Strip CDATA wrapper if present (AI assistants sometimes add this)
      let pageText = args.text !== undefined ? stripCDATA(args.text) : existing.text;
      if (args.text !== undefined && editorType === 'blockeditor') {
        const sitePath = path.join(appInstance.sitesDir, args.site);
        pageText = BlockEditorHelper.transformContent(args.text, {
          sitePath: sitePath,
          postId: args.id,  // Existing page ID
          db: appInstance.db
        });
        console.error('[MCP] Transformed block editor content for page update');
      }

      // Merge existing data with updates
      // Note: DB columns are: id, title, authors, slug, text, featured_image_id, created_at, modified_at, status, template
      // Pages need ',is-page' suffix in status
      let newStatus;
      if (args.status !== undefined) {
        // User provided status - ensure it has ,is-page
        newStatus = args.status.includes(',is-page') ? args.status : args.status + ',is-page';
      } else {
        // Keep existing status (which should already have ,is-page)
        newStatus = existing.status;
      }

      const pageData = {
        site: args.site,
        id: args.id,
        title: args.title !== undefined ? args.title : existing.title,
        slug: args.slug !== undefined ? args.slug : existing.slug,
        text: pageText,
        author: existing.authors,  // DB column is 'authors'
        status: newStatus,
        creationDate: existing.created_at,  // DB column is 'created_at'
        modificationDate: now,
        template: args.template !== undefined ? args.template : (existing.template || ''),
        featuredImage: featuredImage,
        featuredImageFilename: featuredImageFilename,
        featuredImageData: featuredImageData,
        additionalData: {
          ...(existingData.additionalData || {}),  // From existingData, not existing
          editor: editorType
        },
        pageViewSettings: existingData.pageViewSettings || {}  // From existingData, not existing
      };

      const updatedPage = new Page(appInstance, pageData);
      const result = updatedPage.save();

      // Convert temp URLs to page-specific URLs
      if (args.text !== undefined) {
        try {
          const savedPage = appInstance.db.prepare('SELECT text FROM posts WHERE id = @id').get({ id: args.id });
          if (savedPage && savedPage.text) {
            let convertedText = savedPage.text;
            let needsUpdate = false;

            // Handle file:/// URLs
            if (convertedText.includes('file:///')) {
              const sitePath = path.join(appInstance.sitesDir, args.site);
              convertedText = convertAllFileUrls(convertedText, sitePath, args.id);
              needsUpdate = true;
              console.error('[MCP] Converted file:/// URLs to relative paths for page', args.id);
            }

            // Handle /media/posts/temp/ relative URLs
            if (convertedText.includes('/media/posts/temp/')) {
              // First, copy files from temp to page directory
              const pageDir = path.join(sitePath, 'input', 'media', 'posts', args.id.toString());
              const tempDirForCopy = path.join(sitePath, 'input', 'media', 'posts', 'temp');
              const backupDirForCopy = path.join(sitePath, 'input', 'media', 'posts', 'mcp-backup');
              const sourceDir = fs.existsSync(tempDirForCopy) ? tempDirForCopy :
                               (fs.existsSync(backupDirForCopy) ? backupDirForCopy : null);

              if (sourceDir) {
                const imgRegex = /\/media\/posts\/temp\/([^"'\s]+)/g;
                const imgMatches = [...convertedText.matchAll(imgRegex)];
                const filesToCopy = new Set(imgMatches.map(m => m[1]));

                if (filesToCopy.size > 0) {
                  fs.ensureDirSync(pageDir);
                  for (const filename of filesToCopy) {
                    const srcFile = path.join(sourceDir, filename);
                    const destFile = path.join(pageDir, filename);
                    if (fs.existsSync(srcFile)) {
                      fs.ensureDirSync(path.dirname(destFile));
                      fs.copySync(srcFile, destFile);
                      console.error(`[MCP] Copied content image: ${filename} to page ${args.id}`);
                    }
                  }
                }
              }

              // Use #DOMAIN_NAME# placeholder so Publii editor can display images
              convertedText = convertedText.replace(/\/media\/posts\/temp\//g, `#DOMAIN_NAME#`);
              needsUpdate = true;
              console.error('[MCP] Converted /media/posts/temp/ URLs to #DOMAIN_NAME# for page', args.id);
            }

            if (needsUpdate) {
              appInstance.db.prepare('UPDATE posts SET text = @text WHERE id = @id').run({ text: convertedText, id: args.id });
            }
          }
        } catch (e) {
          console.error('[MCP] Warning: Could not convert URLs:', e.message);
        }
      }

      // Fix block editor image URLs: Page.save() produces #DOMAIN_NAME#/filename
      // but it should be #DOMAIN_NAME#filename (without the slash)
      if (editorType === 'blockeditor') {
        try {
          const fixedText = appInstance.db.prepare('SELECT text FROM posts WHERE id = @id').get({ id: args.id });
          if (fixedText && fixedText.text && fixedText.text.includes('#DOMAIN_NAME#/')) {
            const correctedText = fixedText.text.replace(/#DOMAIN_NAME#\//g, '#DOMAIN_NAME#');
            appInstance.db.prepare('UPDATE posts SET text = @text WHERE id = @id').run({ text: correctedText, id: args.id });
            console.error('[MCP] Fixed block editor image URLs for page', args.id);
          }
        } catch (e) {
          console.error('[MCP] Warning: Could not fix image URLs:', e.message);
        }
      }

      // Validate block editor image paths if content was updated
      let imageValidation = null;
      if (args.text !== undefined && editorType === 'blockeditor') {
        try {
          const sitePath = path.join(appInstance.sitesDir, args.site);
          imageValidation = BlockEditorHelper.validateImagePaths(pageText, sitePath, args.id);
          if (!imageValidation.valid) {
            console.error(`[MCP] Warning: ${imageValidation.missingImages.length} missing images in page ${args.id}`);
          }
        } catch (e) {
          console.error('[MCP] Warning: Could not validate image paths:', e.message);
        }
      }

      console.error(`[MCP] Updated page: ${pageData.title} (ID: ${args.id})`);

      // Notify frontend
      if (appInstance.mainWindow && appInstance.mainWindow.webContents) {
        appInstance.mainWindow.webContents.send('app-page-saved', result);
        console.error('[MCP] Frontend notified of updated page');
      }

      // Build response with optional warnings
      const response = {
        success: true,
        message: `Page "${pageData.title}" updated successfully`,
        pageId: args.id,
        site: args.site
      };

      // Add image validation warnings if there are missing images
      if (imageValidation && !imageValidation.valid) {
        response.warnings = {
          missingImages: imageValidation.missingImages.map(img => ({
            filename: img.filename,
            url: img.url,
            type: img.type
          })),
          suggestions: imageValidation.suggestions
        };
        response.message += ` (WARNING: ${imageValidation.missingImages.length} image(s) not found - they may not display correctly)`;
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(response, null, 2)
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

      console.error(`[MCP] Deleted page ID: ${pageId}`);

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
