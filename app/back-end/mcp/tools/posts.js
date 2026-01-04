/**
 * MCP Tools for Post Operations
 *
 * Wraps Publii's Post class for creating and managing posts
 */

const path = require('path');
const fs = require('fs-extra');
const Database = require('node-sqlite3-wasm').Database;
const DBUtils = require('../../helpers/db.utils.js');
const Post = require('../../post.js');
const Posts = require('../../posts.js');
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
 * @param {number} postId - The post ID (for logging)
 * @returns {string} - The text with converted URLs
 */
function convertAllFileUrls(text, sitePath, postId) {
  if (!text || typeof text !== 'string') return text;

  const mediaDir = path.join(sitePath, 'input', 'media');
  const mediaDirNormalized = normalizePath(mediaDir);
  const mediaDirWithoutSlash = mediaDirNormalized.replace(/^\//, '');
  const escapedMediaDir = mediaDirWithoutSlash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Match file:// followed by any number of slashes, then the media path
  // Capture everything after /media/ to preserve the full relative path
  const fileUrlPattern = new RegExp(`file:/{2,}/?${escapedMediaDir}/([^"'\\s]+)`, 'gi');

  const matches = [...text.matchAll(fileUrlPattern)];
  if (matches.length > 0) {
    console.error(`[MCP] Found ${matches.length} file:/// URLs to convert for post ${postId}`);
  }

  // Convert: file:///path/to/site/input/media/posts/88/image.jpg -> /media/posts/88/image.jpg
  return text.replace(fileUrlPattern, '/media/$1');
}

/**
 * Convert file:/// URLs to relative paths and copy images from temp to post directory.
 * This handles the case where Post.save() doesn't do the conversion (e.g., when temp dir was already processed).
 * @param {string} text - The HTML content
 * @param {string} sitePath - Path to the site directory
 * @param {number} postId - The post ID (used for the target directory)
 * @returns {string} - The text with converted URLs
 */
function convertTempImageUrls(text, sitePath, postId) {
  if (!text || typeof text !== 'string') return text;

  const tempDir = path.join(sitePath, 'input', 'media', 'posts', 'temp');
  const postDir = path.join(sitePath, 'input', 'media', 'posts', postId.toString());
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

  // Copy files from temp to post directory if they exist
  if (filesToCopy.size > 0) {
    try {
      fs.ensureDirSync(postDir);

      for (const filename of filesToCopy) {
        const srcFile = path.join(tempDir, filename);
        const destFile = path.join(postDir, filename);

        if (fs.existsSync(srcFile)) {
          fs.ensureDirSync(path.dirname(destFile));
          fs.copySync(srcFile, destFile);
          console.error(`[MCP] Copied image: ${filename} to post ${postId}`);
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

  console.error(`[MCP] URL conversion complete for post ${postId}, found ${filesToCopy.size} images`);

  return convertedText;
}

class PostTools {
  /**
   * Get tool definitions for MCP protocol
   */
  static getToolDefinitions() {
    return [
      {
        name: 'list_posts',
        description: 'List all posts for a Publii site. Use list_sites first to get available site names.',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site directory name (use list_sites to see available sites). Example: "my-blog" or "ndh-allround"'
            },
            status: {
              type: 'string',
              description: 'Optional filter by status',
              enum: ['published', 'draft', 'hidden', 'trashed']
            }
          },
          required: ['site']
        }
      },
      {
        name: 'get_post',
        description: 'Get a single post by its numeric ID. Use list_posts first to find post IDs.',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site directory name (use list_sites to see available sites)'
            },
            id: {
              type: 'integer',
              description: 'Numeric post ID (use list_posts to find IDs)'
            }
          },
          required: ['site', 'id']
        }
      },
      {
        name: 'create_post',
        description: 'Create a new blog post. Requires site name, title, and content. Use list_sites first to get the site name.',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site directory name (REQUIRED - use list_sites to see available sites). Example: "ndh-allround"'
            },
            title: {
              type: 'string',
              description: 'Post title (REQUIRED). Example: "My First Blog Post"'
            },
            text: {
              type: 'string',
              description: 'Post content as HTML (REQUIRED). Example: "<p>Hello world!</p><h2>Section</h2><p>More content...</p>". To include images: 1) Upload with upload_image, 2) Use the returned relative URL in your HTML: <img src="/media/posts/88/image.jpg">. For new posts, upload with postId=0 first, then use the URL from the response.'
            },
            slug: {
              type: 'string',
              description: 'URL-friendly slug. Auto-generated from title if not provided. Example: "my-first-blog-post"'
            },
            status: {
              type: 'string',
              description: 'Publication status. Defaults to "published" when created via MCP',
              enum: ['published', 'draft', 'hidden'],
              default: 'published'
            },
            author: {
              type: 'integer',
              description: 'Author ID number. Defaults to 1 (primary author)',
              default: 1
            },
            tags: {
              type: 'array',
              items: { type: 'integer' },
              description: 'Array of tag ID numbers. Use list_tags to find tag IDs. Example: [1, 3, 5]'
            },
            template: {
              type: 'string',
              description: 'Custom template name. Leave empty for default template'
            },
            editor: {
              type: 'string',
              description: 'Editor format for content. Use "tinymce" for HTML (recommended), "blockeditor" for Publii block JSON, "markdown" for plain markdown. NOTE: blockeditor requires Publii-specific JSON array format: [{"type":"publii-paragraph","content":"<p>text</p>","config":{"textAlign":"left","advanced":{"id":"","cssClasses":"","style":""}}}]. Block types: publii-paragraph, publii-header, publii-list, publii-quote, publii-code, publii-image, publii-gallery, publii-embed, publii-html, publii-separator, publii-readmore, publii-toc. For simplicity, prefer tinymce with HTML content.',
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
        name: 'update_post',
        description: 'Update an existing post',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site name'
            },
            id: {
              type: 'number',
              description: 'Post ID to update'
            },
            title: {
              type: 'string',
              description: 'New post title'
            },
            text: {
              type: 'string',
              description: 'New post content'
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
            author: {
              type: 'number',
              description: 'New author ID'
            },
            tags: {
              type: 'array',
              items: { type: 'number' },
              description: 'New array of tag IDs'
            },
            template: {
              type: 'string',
              description: 'New template name'
            },
            editor: {
              type: 'string',
              description: 'Editor type. WARNING: Changing editor type requires content in matching format. See create_post for blockeditor format details.',
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

    try {
      switch (toolName) {
        case 'list_posts':
          return await this.listPosts(args.site, args.status, appInstance);

        case 'get_post':
          return await this.getPost(args.site, args.id, appInstance);

        case 'create_post':
          return await this.createPost(args, appInstance);

        case 'update_post':
          return await this.updatePost(args, appInstance);

        case 'delete_post':
          return await this.deletePost(args.site, args.id, appInstance);

        default:
          throw new Error(`Unknown post tool: ${toolName}`);
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

    appInstance.db = new DBUtils(new Database(dbPath), true);
    console.error(`[MCP] Connected to database: ${dbPath}`);
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

      // Handle featured image if provided - use Publii's Image class for responsive generation
      let featuredImage = '';
      let featuredImageFilename = '';
      let featuredImageData = false;

      if (args.featuredImage) {
        // Use Publii's Image class to save image with responsive versions
        // For new posts, use 0 as ID - Image class converts 0 to 'temp' directory
        const imageResult = await saveFeaturedImage(
          args.featuredImage,
          appInstance,
          args.site,
          0,  // 0 = new post, Image class will use 'temp' directory
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
      let postText = stripCDATA(args.text);
      const editorType = args.editor || 'tinymce';

      if (editorType === 'blockeditor') {
        const sitePath = path.join(appInstance.sitesDir, args.site);
        postText = BlockEditorHelper.transformContent(args.text, {
          sitePath: sitePath,
          postId: 0,  // New post uses temp directory
          db: null    // Images will be registered after post is saved
        });
        console.error('[MCP] Transformed block editor content for new post');
      }

      // BEFORE calling post.save(), backup temp images so they survive multiple post creations
      // Post.save() deletes temp after processing the first post
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

      const postData = {
        site: args.site,
        id: 0, // 0 = new post
        title: args.title,
        slug: postSlug,
        text: postText,
        author: args.author || 1,
        status: args.status || 'published',
        creationDate: now,
        modificationDate: now,
        template: args.template || '',
        tags: args.tags || [],
        featuredImage: featuredImage,
        featuredImageFilename: featuredImageFilename,
        featuredImageData: featuredImageData,
        additionalData: {
          metaTitle: '',
          metaDesc: '',
          metaRobots: 'index, follow',
          canonicalUrl: '',
          mainTag: 0,
          editor: editorType
        },
        postViewSettings: {}
      };

      const post = new Post(appInstance, postData);
      const result = post.save();

      // Convert temp URLs to post-specific URLs
      // This handles both file:/// URLs and /media/posts/temp/ relative URLs
      if (result.postID) {
        try {
          const savedPost = appInstance.db.prepare('SELECT text FROM posts WHERE id = @id').get({ id: result.postID });

          if (savedPost && savedPost.text) {
            let convertedText = savedPost.text;
            let needsUpdate = false;

            // Handle file:/// URLs (legacy format)
            if (convertedText.includes('file:///')) {
              // Restore temp from backup so convertTempImageUrls can find the files
              if (fs.existsSync(backupDir) && !fs.existsSync(tempDir)) {
                fs.copySync(backupDir, tempDir);
                console.error('[MCP] Restored temp from mcp-backup');
              }
              convertedText = convertTempImageUrls(convertedText, sitePath, result.postID);
              needsUpdate = true;
              console.error('[MCP] Converted file:/// URLs to relative paths for post', result.postID);
            }

            // Handle /media/posts/temp/ relative URLs (new format from upload_image)
            if (convertedText.includes('/media/posts/temp/')) {
              // First, copy files from temp to post directory
              const postDir = path.join(sitePath, 'input', 'media', 'posts', result.postID.toString());
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
                  fs.ensureDirSync(postDir);
                  for (const filename of filesToCopy) {
                    const srcFile = path.join(sourceDir, filename);
                    const destFile = path.join(postDir, filename);
                    if (fs.existsSync(srcFile)) {
                      fs.ensureDirSync(path.dirname(destFile));
                      fs.copySync(srcFile, destFile);
                      console.error(`[MCP] Copied content image: ${filename} to post ${result.postID}`);
                    }
                  }
                }
              }

              // Then update URLs in content - use #DOMAIN_NAME# placeholder so Publii editor can display images
              convertedText = convertedText.replace(/\/media\/posts\/temp\//g, `#DOMAIN_NAME#`);
              needsUpdate = true;
              console.error('[MCP] Converted /media/posts/temp/ URLs to #DOMAIN_NAME# for post', result.postID);
            }

            if (needsUpdate) {
              appInstance.db.prepare('UPDATE posts SET text = @text WHERE id = @id').run({ text: convertedText, id: result.postID });
            }
          }
        } catch (e) {
          console.error('[MCP] Warning: Could not convert image URLs:', e.message);
        }
      }

      // Fix block editor image URLs: Post.save() produces #DOMAIN_NAME#/filename
      // but it should be #DOMAIN_NAME#filename (without the slash)
      if (editorType === 'blockeditor' && result.postID) {
        try {
          const fixedText = appInstance.db.prepare('SELECT text FROM posts WHERE id = @id').get({ id: result.postID });
          if (fixedText && fixedText.text && fixedText.text.includes('#DOMAIN_NAME#/')) {
            const correctedText = fixedText.text.replace(/#DOMAIN_NAME#\//g, '#DOMAIN_NAME#');
            appInstance.db.prepare('UPDATE posts SET text = @text WHERE id = @id').run({ text: correctedText, id: result.postID });
            console.error('[MCP] Fixed block editor image URLs for post', result.postID);
          }
        } catch (e) {
          console.error('[MCP] Warning: Could not fix image URLs:', e.message);
        }
      }

      // Register content images for block editor posts
      if (editorType === 'blockeditor' && result.postID) {
        try {
          const sitePath = path.join(appInstance.sitesDir, args.site);
          BlockEditorHelper.registerContentImagesFromText(
            appInstance.db,
            result.postID,
            postText,
            sitePath
          );
        } catch (e) {
          console.error('[MCP] Warning: Could not register content images:', e.message);
        }
      }

      // Validate block editor image paths
      let imageValidation = null;
      if (editorType === 'blockeditor' && result.postID) {
        try {
          const sitePath = path.join(appInstance.sitesDir, args.site);
          imageValidation = BlockEditorHelper.validateImagePaths(postText, sitePath, result.postID);
          if (!imageValidation.valid) {
            console.error(`[MCP] Warning: ${imageValidation.missingImages.length} missing images in post ${result.postID}`);
          }
        } catch (e) {
          console.error('[MCP] Warning: Could not validate image paths:', e.message);
        }
      }

      console.error(`[MCP] Created post: ${args.title} (ID: ${result.postID})`);

      // Notify frontend to refresh posts list
      if (appInstance.mainWindow && appInstance.mainWindow.webContents) {
        appInstance.mainWindow.webContents.send('app-post-saved', result);
        console.error('[MCP] Frontend notified of new post');
      }

      // Build response with optional warnings
      const response = {
        success: true,
        message: `Post "${args.title}" created successfully`,
        postId: result.postID,
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
      console.error('[MCP] create_post error:', error);
      throw error;
    }
  }

  /**
   * Update an existing post
   */
  static async updatePost(args, appInstance) {
    try {
      // Load existing post
      const post = new Post(appInstance, { site: args.site, id: args.id });
      const existingData = post.load();

      if (!existingData || !existingData.posts || existingData.posts.length === 0) {
        throw new Error(`Post ${args.id} not found`);
      }

      const existing = existingData.posts[0];
      const now = Date.now();

      // Extract existing featured image info from loaded data
      // Note: post.load() returns featuredImage as { url, additional_data } from posts_images table
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
            args.id,  // Use actual post ID for existing posts
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

      // Extract tag IDs from the loaded tags data
      const existingTagIds = existingData.tags ? existingData.tags.map(t => t.id) : [];

      // Determine editor type
      const editorType = args.editor !== undefined ? args.editor : (existingData.additionalData?.editor || 'tinymce');

      // Transform block editor content if text is being updated
      // Strip CDATA wrapper if present (AI assistants sometimes add this)
      let postText = args.text !== undefined ? stripCDATA(args.text) : existing.text;
      if (args.text !== undefined && editorType === 'blockeditor') {
        const sitePath = path.join(appInstance.sitesDir, args.site);
        postText = BlockEditorHelper.transformContent(args.text, {
          sitePath: sitePath,
          postId: args.id,  // Existing post ID
          db: appInstance.db
        });
        console.error('[MCP] Transformed block editor content for post update');
      }

      // Merge existing data with updates
      // Note: DB columns are: id, title, authors, slug, text, featured_image_id, created_at, modified_at, status, template
      const postData = {
        site: args.site,
        id: args.id,
        title: args.title !== undefined ? args.title : existing.title,
        slug: args.slug !== undefined ? args.slug : existing.slug,
        text: postText,
        author: args.author !== undefined ? args.author : existing.authors,  // DB column is 'authors'
        status: args.status !== undefined ? args.status : existing.status,
        creationDate: existing.created_at,  // DB column is 'created_at'
        modificationDate: now,
        template: args.template !== undefined ? args.template : (existing.template || ''),
        tags: args.tags !== undefined ? args.tags : existingTagIds,  // Tags come from existingData.tags
        featuredImage: featuredImage,
        featuredImageFilename: featuredImageFilename,
        featuredImageData: featuredImageData,
        additionalData: {
          ...(existingData.additionalData || {}),  // From existingData, not existing
          editor: editorType
        },
        postViewSettings: existingData.postViewSettings || {}  // From existingData, not existing
      };

      const updatedPost = new Post(appInstance, postData);
      const result = updatedPost.save();

      // Convert temp URLs to post-specific URLs
      if (args.text !== undefined) {
        try {
          const savedPost = appInstance.db.prepare('SELECT text FROM posts WHERE id = @id').get({ id: args.id });
          if (savedPost && savedPost.text) {
            let convertedText = savedPost.text;
            let needsUpdate = false;

            // Handle file:/// URLs
            if (convertedText.includes('file:///')) {
              const sitePath = path.join(appInstance.sitesDir, args.site);
              convertedText = convertAllFileUrls(convertedText, sitePath, args.id);
              needsUpdate = true;
              console.error('[MCP] Converted file:/// URLs to relative paths for post', args.id);
            }

            // Handle /media/posts/temp/ relative URLs
            if (convertedText.includes('/media/posts/temp/')) {
              // First, copy files from temp to post directory
              const postDir = path.join(sitePath, 'input', 'media', 'posts', args.id.toString());
              const tempDirForCopy = path.join(sitePath, 'input', 'media', 'posts', 'temp');
              const backupDirForCopy = path.join(sitePath, 'input', 'media', 'posts', 'mcp-backup');
              const sourceDir = fs.existsSync(tempDirForCopy) ? tempDirForCopy :
                               (fs.existsSync(backupDirForCopy) ? backupDirForCopy : null);

              if (sourceDir) {
                const imgRegex = /\/media\/posts\/temp\/([^"'\s]+)/g;
                const imgMatches = [...convertedText.matchAll(imgRegex)];
                const filesToCopy = new Set(imgMatches.map(m => m[1]));

                if (filesToCopy.size > 0) {
                  fs.ensureDirSync(postDir);
                  for (const filename of filesToCopy) {
                    const srcFile = path.join(sourceDir, filename);
                    const destFile = path.join(postDir, filename);
                    if (fs.existsSync(srcFile)) {
                      fs.ensureDirSync(path.dirname(destFile));
                      fs.copySync(srcFile, destFile);
                      console.error(`[MCP] Copied content image: ${filename} to post ${args.id}`);
                    }
                  }
                }
              }

              // Use #DOMAIN_NAME# placeholder so Publii editor can display images
              convertedText = convertedText.replace(/\/media\/posts\/temp\//g, `#DOMAIN_NAME#`);
              needsUpdate = true;
              console.error('[MCP] Converted /media/posts/temp/ URLs to #DOMAIN_NAME# for post', args.id);
            }

            if (needsUpdate) {
              appInstance.db.prepare('UPDATE posts SET text = @text WHERE id = @id').run({ text: convertedText, id: args.id });
            }
          }
        } catch (e) {
          console.error('[MCP] Warning: Could not convert URLs:', e.message);
        }
      }

      // Fix block editor image URLs: Post.save() produces #DOMAIN_NAME#/filename
      // but it should be #DOMAIN_NAME#filename (without the slash)
      if (editorType === 'blockeditor') {
        try {
          const fixedText = appInstance.db.prepare('SELECT text FROM posts WHERE id = @id').get({ id: args.id });
          if (fixedText && fixedText.text && fixedText.text.includes('#DOMAIN_NAME#/')) {
            const correctedText = fixedText.text.replace(/#DOMAIN_NAME#\//g, '#DOMAIN_NAME#');
            appInstance.db.prepare('UPDATE posts SET text = @text WHERE id = @id').run({ text: correctedText, id: args.id });
            console.error('[MCP] Fixed block editor image URLs for post', args.id);
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
          imageValidation = BlockEditorHelper.validateImagePaths(postText, sitePath, args.id);
          if (!imageValidation.valid) {
            console.error(`[MCP] Warning: ${imageValidation.missingImages.length} missing images in post ${args.id}`);
          }
        } catch (e) {
          console.error('[MCP] Warning: Could not validate image paths:', e.message);
        }
      }

      console.error(`[MCP] Updated post: ${postData.title} (ID: ${args.id})`);

      // Notify frontend
      if (appInstance.mainWindow && appInstance.mainWindow.webContents) {
        appInstance.mainWindow.webContents.send('app-post-saved', result);
        console.error('[MCP] Frontend notified of updated post');
      }

      // Build response with optional warnings
      const response = {
        success: true,
        message: `Post "${postData.title}" updated successfully`,
        postId: args.id,
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
      console.error('[MCP] update_post error:', error);
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

      console.error(`[MCP] Deleted post ID: ${postId}`);

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
