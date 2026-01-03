/**
 * Block Editor Helper for MCP
 *
 * Transforms block editor content to use proper Publii image formats:
 * - Converts image filenames to file:/// URLs (for temp) or #DOMAIN_NAME# (for existing posts)
 * - Adds required fields like id, imageWidth, imageHeight
 * - Handles gallery images with thumbnails
 * - Registers content images in posts_images table
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sizeOf = require('image-size');
const normalizePath = require('normalize-path');

class BlockEditorHelper {
  /**
   * Transform block editor content for saving
   *
   * @param {string|Array} content - Block editor content (JSON string or array)
   * @param {Object} options - Options
   * @param {string} options.sitePath - Path to site directory
   * @param {number|string} options.postId - Post ID (0 or 'temp' for new posts)
   * @param {Object} options.db - Database connection (optional, for registering images)
   * @returns {string} Transformed content as JSON string
   */
  static transformContent(content, options) {
    const { sitePath, postId, db } = options;

    // Parse content if it's a string
    let blocks;
    try {
      blocks = typeof content === 'string' ? JSON.parse(content) : content;
    } catch (e) {
      // Not valid JSON, return as-is (might be HTML for tinymce)
      return typeof content === 'string' ? content : JSON.stringify(content);
    }

    // If not an array, it's not block editor content
    if (!Array.isArray(blocks)) {
      return typeof content === 'string' ? content : JSON.stringify(content);
    }

    // Determine media directory based on postId
    const isNewPost = postId === 0 || postId === 'temp';
    const mediaDir = isNewPost
      ? path.join(sitePath, 'input', 'media', 'posts', 'temp')
      : path.join(sitePath, 'input', 'media', 'posts', postId.toString());

    // Track images for posts_images registration
    const contentImages = [];

    // Transform each block
    const transformedBlocks = blocks.map(block => {
      // Ensure block has an id
      const blockId = block.id || crypto.randomUUID();

      // Handle image blocks
      if (block.type === 'publii-image') {
        block = this.transformImageBlock(block, mediaDir, isNewPost, contentImages);
        // Rebuild object with id FIRST (Publii block editor requires this order)
        const { id: _, ...blockWithoutId } = block;
        return { id: blockId, ...blockWithoutId };
      }

      // Handle gallery blocks
      if (block.type === 'publii-gallery') {
        block = this.transformGalleryBlock(block, mediaDir, isNewPost, contentImages);
        const { id: _, ...blockWithoutId } = block;
        return { id: blockId, ...blockWithoutId };
      }

      // Handle quote blocks - content must be an object with numbered keys + text + author
      if (block.type === 'publii-quote') {
        block = this.transformQuoteBlock(block);
        const { id: _, ...blockWithoutId } = block;
        return { id: blockId, ...blockWithoutId };
      }

      // For other blocks, rebuild with id first
      const { id: _, ...rest } = block;
      return { id: blockId, ...rest };
    });

    // Register content images in database if db is provided
    if (db && contentImages.length > 0) {
      this.registerContentImages(db, postId, contentImages);
    }

    return JSON.stringify(transformedBlocks);
  }

  /**
   * Transform a publii-image block
   */
  static transformImageBlock(block, mediaDir, isNewPost, contentImages) {
    if (!block.content || !block.content.image) {
      return block;
    }

    const originalImageUrl = block.content.image;
    const extractedPath = this.extractFilename(originalImageUrl);
    if (!extractedPath) {
      return block;
    }
    // Get just the filename (for file lookup and URL building)
    const imageFilename = path.basename(extractedPath);

    // Check if image is already in correct #DOMAIN_NAME# format with dimensions
    // If so, skip URL transformation to avoid double-processing
    const alreadyProcessed = originalImageUrl.startsWith('#DOMAIN_NAME#') &&
                              !originalImageUrl.startsWith('#DOMAIN_NAME##') &&
                              block.content.imageWidth > 0 &&
                              block.content.imageHeight > 0;

    // Get image dimensions from file if not already set
    let width = block.content.imageWidth || 0;
    let height = block.content.imageHeight || 0;

    if (width === 0 || height === 0) {
      // Try multiple locations for the image
      const possiblePaths = [
        path.join(mediaDir, imageFilename),
        // For #DOMAIN_NAME# URLs, also try the parent posts directory with post ID subdirs
        path.join(path.dirname(mediaDir), imageFilename)
      ];

      for (const imagePath of possiblePaths) {
        if (fs.existsSync(imagePath)) {
          try {
            const dimensions = sizeOf(imagePath);
            width = dimensions.width || 0;
            height = dimensions.height || 0;
            break;
          } catch (e) {
            console.error(`[MCP] Could not get dimensions for ${imageFilename}:`, e.message);
          }
        }
      }
    }

    // Build the proper image URL (only if not already processed)
    let imageUrl;
    if (alreadyProcessed) {
      // Already in correct format, keep as-is
      imageUrl = originalImageUrl;
    } else if (isNewPost) {
      // For new posts, use file:/// URL to temp directory
      // Post.save() will transform this to #DOMAIN_NAME#
      imageUrl = 'file:///' + normalizePath(path.join(mediaDir, imageFilename));
    } else {
      // For existing posts, use #DOMAIN_NAME# directly with filename
      // Publii's renderer adds the media/posts/{id}/ path automatically for block editor images
      imageUrl = '#DOMAIN_NAME#' + imageFilename;
    }

    // Track for registration
    contentImages.push({
      filename: imageFilename,
      alt: block.content.alt || '',
      caption: block.content.caption || ''
    });

    // Extract link info from content if provided (MCP input format)
    // Link can be a string (just URL) or an object with url, title, noFollow, targetBlank, etc.
    let inputLink = null;
    if (block.content.link) {
      if (typeof block.content.link === 'string') {
        // Simple string format - just the URL
        inputLink = { url: block.content.link };
      } else if (typeof block.content.link === 'object') {
        // Full object format with all properties
        inputLink = block.content.link;
      }
    }

    // Update block content - match Publii property order
    block.content = {
      image: imageUrl,
      imageHeight: height,
      imageWidth: width,
      alt: block.content.alt || '',
      caption: block.content.caption || ''
    };

    // Ensure proper config structure, preserving any existing values
    block.config = block.config || {};
    block.config.imageAlign = block.config.imageAlign || 'center';

    // Handle link config - full structure required by Publii
    // URL formats:
    //   External: https://example.com
    //   Post: #INTERNAL_LINK#/post/{postId}
    //   Page: #INTERNAL_LINK#/page/{pageId}
    //   Tag: #INTERNAL_LINK#/tag/{tagId}
    //   Author: #INTERNAL_LINK#/author/{authorId}
    //   File: #INTERNAL_LINK#/file/{filePath}
    const defaultLink = {
      url: '',
      title: '',
      cssClass: '',
      noFollow: false,
      targetBlank: false,
      sponsored: false,
      ugc: false,
      download: false
    };

    // If link was provided in content (MCP input format), use it
    if (inputLink && inputLink.url) {
      block.config.link = {
        url: inputLink.url,
        title: inputLink.title || block.config.link?.title || '',
        cssClass: inputLink.cssClass || block.config.link?.cssClass || '',
        noFollow: inputLink.noFollow || block.config.link?.noFollow || false,
        targetBlank: inputLink.targetBlank || block.config.link?.targetBlank || false,
        sponsored: inputLink.sponsored || block.config.link?.sponsored || false,
        ugc: inputLink.ugc || block.config.link?.ugc || false,
        download: inputLink.download || block.config.link?.download || false
      };
    } else {
      // Preserve existing link config, ensuring all fields exist
      block.config.link = {
        ...defaultLink,
        ...block.config.link
      };
    }

    // Only keep cssClasses and id in advanced config (other fields like 'style' cause UI errors)
    block.config.advanced = {
      cssClasses: block.config.advanced?.cssClasses || '',
      id: block.config.advanced?.id || ''
    };

    return block;
  }

  /**
   * Transform a publii-gallery block
   */
  static transformGalleryBlock(block, mediaDir, isNewPost, contentImages) {
    if (!block.content || !block.content.images || !Array.isArray(block.content.images)) {
      return block;
    }

    const galleryDir = path.join(mediaDir, 'gallery');

    // Ensure gallery directory exists
    if (!fs.existsSync(galleryDir)) {
      fs.mkdirSync(galleryDir, { recursive: true });
    }

    const transformedImages = block.content.images.map(img => {
      const imageFilename = this.extractFilename(img.src);
      if (!imageFilename) {
        return img;
      }

      // Check if image is in gallery dir or main dir
      let sourcePath = path.join(galleryDir, imageFilename);
      if (!fs.existsSync(sourcePath)) {
        sourcePath = path.join(mediaDir, imageFilename);
      }

      // Copy to gallery dir if needed
      const galleryPath = path.join(galleryDir, imageFilename);
      if (fs.existsSync(sourcePath) && sourcePath !== galleryPath) {
        fs.copyFileSync(sourcePath, galleryPath);
      }

      // Generate thumbnail if it doesn't exist
      const thumbnailFilename = this.getThumbnailFilename(imageFilename);
      const thumbnailPath = path.join(galleryDir, thumbnailFilename);

      // Get dimensions
      let width = 720;
      let height = 540;
      let dimensions = '';

      if (fs.existsSync(galleryPath)) {
        try {
          const imgDimensions = sizeOf(galleryPath);
          dimensions = `${imgDimensions.width}x${imgDimensions.height}`;
          // Calculate thumbnail dimensions (720px wide, proportional height)
          width = 720;
          height = Math.round((imgDimensions.height / imgDimensions.width) * 720);
        } catch (e) {
          console.error(`[MCP] Could not get dimensions for gallery image ${imageFilename}:`, e.message);
        }

        // Generate thumbnail if it doesn't exist
        if (!fs.existsSync(thumbnailPath)) {
          try {
            // Try using ffmpeg for thumbnail generation
            const { execSync } = require('child_process');
            execSync(`ffmpeg -i "${galleryPath}" -vf scale=720:-1 "${thumbnailPath}" -y`, {
              stdio: 'ignore'
            });
            console.error(`[MCP] Generated thumbnail: ${thumbnailFilename}`);
          } catch (e) {
            // Fallback: copy original as thumbnail
            fs.copyFileSync(galleryPath, thumbnailPath);
            console.error(`[MCP] Copied as thumbnail (ffmpeg unavailable): ${thumbnailFilename}`);
          }
        }
      }

      // Build URLs - always use #DOMAIN_NAME# for gallery to avoid temp path issues
      // Gallery images are copied to gallery/ subdir, Post.save() will move them
      const srcUrl = '#DOMAIN_NAME#gallery/' + imageFilename;
      const thumbnailUrl = '#DOMAIN_NAME#gallery/' + thumbnailFilename;

      // Track for registration
      contentImages.push({
        filename: 'gallery/' + imageFilename,
        alt: img.alt || '',
        caption: img.caption || ''
      });

      return {
        src: srcUrl,
        thumbnailSrc: thumbnailUrl,
        height: height,
        width: width,
        dimensions: dimensions,
        alt: img.alt || '',
        caption: img.caption || ''
      };
    });

    block.content.images = transformedImages;

    // Ensure proper config structure
    block.config = block.config || {};
    block.config.imageAlign = block.config.imageAlign || 'center';
    block.config.columns = block.config.columns || 3;
    // Only keep cssClasses and id in advanced config (other fields like 'style' cause UI errors)
    block.config.advanced = {
      cssClasses: block.config.advanced?.cssClasses || '',
      id: block.config.advanced?.id || ''
    };

    return block;
  }

  /**
   * Transform a publii-quote block
   *
   * Quote content is an object with:
   * - "text" property: the actual quote text displayed in <blockquote>
   * - "author" property: the author name displayed in <figcaption>
   * - Numbered keys (0, 1, 2, ...): internal editor state (not used for rendering)
   *
   * The renderer uses content.text for the blockquote content,
   * NOT the numbered character keys.
   */
  static transformQuoteBlock(block) {
    let quoteText = '';
    let authorName = '';

    // Check if content is already in correct object format
    if (block.content && typeof block.content === 'object' && !Array.isArray(block.content)) {
      // Use existing text and author if present
      quoteText = block.content.text || '';
      authorName = block.content.author || '';
    } else if (typeof block.content === 'string') {
      // Content is a string - strip HTML tags for plain text
      quoteText = block.content
        .replace(/<blockquote>/gi, '')
        .replace(/<\/blockquote>/gi, '')
        .replace(/<p>/gi, '')
        .replace(/<\/p>/gi, '')
        .trim();
    }

    // Get author from config if not in content
    if (!authorName && block.config?.author) {
      authorName = block.config.author;
    }

    // Build content object
    // The numbered keys are for internal editor state, text/author are for rendering
    const contentObj = {
      text: quoteText,
      author: authorName
    };

    // Add numbered keys for the HTML representation (for editor compatibility)
    const quoteHtml = '<p>' + quoteText + '</p>';
    for (let i = 0; i < quoteHtml.length; i++) {
      contentObj[String(i)] = quoteHtml[i];
    }

    return {
      id: block.id,
      type: 'publii-quote',
      content: contentObj,
      config: {
        advanced: block.config?.advanced || { cssClasses: '', id: '' },
        textAlign: block.config?.textAlign || 'left',
        quoteType: block.config?.quoteType || 'regular',
        author: block.config?.author || '',
        authorUrl: block.config?.authorUrl || ''
      }
    };
  }

  /**
   * Extract filename from various URL formats
   */
  static extractFilename(url) {
    if (!url) return null;

    // Already just a filename
    if (!url.includes('/') && !url.includes('\\')) {
      return url;
    }

    // file:/// URL
    if (url.startsWith('file:///')) {
      return path.basename(url.replace('file:///', ''));
    }

    // #DOMAIN_NAME# URL
    if (url.includes('#DOMAIN_NAME#')) {
      return url.split('#DOMAIN_NAME#').pop();
    }

    // Regular path
    return path.basename(url);
  }

  /**
   * Get thumbnail filename for a gallery image
   */
  static getThumbnailFilename(filename) {
    const ext = path.extname(filename);
    const name = path.basename(filename, ext);
    return `${name}-thumbnail${ext.toLowerCase() === '.jpg' ? '.jpg' : ext}`;
  }

  /**
   * Register content images in posts_images table
   */
  static registerContentImages(db, postId, images) {
    if (postId === 0 || postId === 'temp') {
      // For new posts, images will be registered after post is saved
      return;
    }

    try {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO posts_images (post_id, url, title, caption, additional_data)
        VALUES (@postId, @url, @title, @caption, @additionalData)
      `);

      for (const img of images) {
        stmt.run({
          postId: postId,
          url: img.filename,
          title: '',
          caption: img.caption || '',
          additionalData: JSON.stringify({
            alt: img.alt || '',
            caption: img.caption || '',
            credits: ''
          })
        });
      }

      console.error(`[MCP] Registered ${images.length} content images for post ${postId}`);
    } catch (e) {
      console.error('[MCP] Error registering content images:', e.message);
    }
  }

  /**
   * Validate that all images referenced in block editor content exist
   * Returns an array of missing images with details
   *
   * @param {string|Array} content - Block editor content (JSON string or array)
   * @param {string} sitePath - Path to site directory
   * @param {number} postId - Post ID (for determining media directory)
   * @returns {Object} Validation result with missing images and suggestions
   */
  static validateImagePaths(content, sitePath, postId) {
    const result = {
      valid: true,
      missingImages: [],
      suggestions: []
    };

    // Parse content
    let blocks;
    try {
      blocks = typeof content === 'string' ? JSON.parse(content) : content;
    } catch (e) {
      // Not valid JSON, skip validation
      return result;
    }

    if (!Array.isArray(blocks)) {
      return result;
    }

    // Determine media directory for this post
    const postMediaDir = path.join(sitePath, 'input', 'media', 'posts', postId.toString());
    const tempMediaDir = path.join(sitePath, 'input', 'media', 'posts', 'temp');

    for (const block of blocks) {
      // Check image blocks
      if (block.type === 'publii-image' && block.content && block.content.image) {
        const imageUrl = block.content.image;
        const validation = this.validateSingleImage(imageUrl, sitePath, postId, postMediaDir, tempMediaDir);

        if (!validation.exists) {
          result.valid = false;
          result.missingImages.push({
            type: 'image',
            url: imageUrl,
            filename: validation.filename,
            expectedPath: validation.expectedPath,
            checkedPaths: validation.checkedPaths
          });

          // Check if image exists in another post's folder
          if (validation.foundInOtherPost) {
            result.suggestions.push({
              image: validation.filename,
              message: `Image found in post ${validation.foundInOtherPost}. Upload it to post ${postId} first with upload_image tool.`,
              sourcePost: validation.foundInOtherPost,
              targetPost: postId
            });
          }
        }
      }

      // Check gallery blocks
      if (block.type === 'publii-gallery' && block.content && block.content.images) {
        for (const img of block.content.images) {
          if (img.src) {
            const validation = this.validateSingleImage(img.src, sitePath, postId, postMediaDir, tempMediaDir, true);

            if (!validation.exists) {
              result.valid = false;
              result.missingImages.push({
                type: 'gallery',
                url: img.src,
                filename: validation.filename,
                expectedPath: validation.expectedPath
              });
            }
          }
        }
      }
    }

    return result;
  }

  /**
   * Validate a single image URL
   * @private
   */
  static validateSingleImage(imageUrl, sitePath, postId, postMediaDir, tempMediaDir, isGallery = false) {
    const filename = this.extractFilename(imageUrl);
    if (!filename) {
      return { exists: true, filename: null }; // Can't validate, assume OK
    }

    const checkedPaths = [];
    let exists = false;
    let foundInOtherPost = null;

    // Build list of paths to check
    const pathsToCheck = [];

    if (isGallery) {
      pathsToCheck.push(path.join(postMediaDir, 'gallery', filename));
      pathsToCheck.push(path.join(tempMediaDir, 'gallery', filename));
    } else {
      pathsToCheck.push(path.join(postMediaDir, filename));
      pathsToCheck.push(path.join(tempMediaDir, filename));
    }

    // Check each path
    for (const checkPath of pathsToCheck) {
      checkedPaths.push(checkPath);
      if (fs.existsSync(checkPath)) {
        exists = true;
        break;
      }
    }

    // If not found, check if it exists in another post's folder
    if (!exists) {
      const postsMediaDir = path.join(sitePath, 'input', 'media', 'posts');
      if (fs.existsSync(postsMediaDir)) {
        try {
          const postDirs = fs.readdirSync(postsMediaDir, { withFileTypes: true })
            .filter(d => d.isDirectory() && d.name !== 'temp' && d.name !== 'mcp-backup' && d.name !== postId.toString())
            .map(d => d.name);

          for (const otherPostId of postDirs) {
            const otherPath = isGallery
              ? path.join(postsMediaDir, otherPostId, 'gallery', filename)
              : path.join(postsMediaDir, otherPostId, filename);

            if (fs.existsSync(otherPath)) {
              foundInOtherPost = otherPostId;
              break;
            }
          }
        } catch (e) {
          // Ignore errors scanning directories
        }
      }
    }

    return {
      exists,
      filename,
      expectedPath: pathsToCheck[0],
      checkedPaths,
      foundInOtherPost
    };
  }

  /**
   * Parse block editor content and register images from it
   * Call this after post is saved to register content images
   *
   * @param {Object} db - Database connection
   * @param {number} postId - Post ID
   * @param {string} text - Post text content (JSON string)
   * @param {string} sitePath - Path to site directory
   */
  static registerContentImagesFromText(db, postId, text, sitePath) {
    if (!db || !postId || postId === 0) {
      return;
    }

    try {
      const blocks = typeof text === 'string' ? JSON.parse(text) : text;
      if (!Array.isArray(blocks)) {
        return;
      }

      const images = [];

      for (const block of blocks) {
        // Handle image blocks
        if (block.type === 'publii-image' && block.content && block.content.image) {
          const filename = this.extractFilename(block.content.image);
          if (filename) {
            images.push({
              filename: filename,
              alt: block.content.alt || '',
              caption: block.content.caption || ''
            });
          }
        }

        // Handle gallery blocks
        if (block.type === 'publii-gallery' && block.content && block.content.images) {
          for (const img of block.content.images) {
            const filename = this.extractFilename(img.src);
            if (filename) {
              images.push({
                filename: filename,
                alt: img.alt || '',
                caption: img.caption || ''
              });
            }
          }
        }
      }

      if (images.length > 0) {
        this.registerContentImages(db, postId, images);
      }
    } catch (e) {
      console.error('[MCP] Error parsing block editor content for images:', e.message);
    }
  }

  /**
   * Generate gallery thumbnails for a post
   * Call this after images are uploaded but before post is saved
   *
   * @param {string} sitePath - Path to site directory
   * @param {number|string} postId - Post ID or 'temp'
   * @param {Array} imageFilenames - Array of image filenames in gallery
   */
  static async generateGalleryThumbnails(sitePath, postId, imageFilenames) {
    const mediaDir = postId === 'temp' || postId === 0
      ? path.join(sitePath, 'input', 'media', 'posts', 'temp')
      : path.join(sitePath, 'input', 'media', 'posts', postId.toString());

    const galleryDir = path.join(mediaDir, 'gallery');

    // Ensure gallery directory exists
    if (!fs.existsSync(galleryDir)) {
      fs.mkdirSync(galleryDir, { recursive: true });
    }

    const results = [];

    for (const filename of imageFilenames) {
      // Source can be in main media dir or already in gallery
      let sourcePath = path.join(galleryDir, filename);
      if (!fs.existsSync(sourcePath)) {
        sourcePath = path.join(mediaDir, filename);
      }

      if (!fs.existsSync(sourcePath)) {
        console.error(`[MCP] Gallery image not found: ${filename}`);
        continue;
      }

      // Copy to gallery dir if needed
      const galleryPath = path.join(galleryDir, filename);
      if (sourcePath !== galleryPath) {
        fs.copyFileSync(sourcePath, galleryPath);
      }

      // Generate thumbnail using sharp or fallback
      const thumbnailFilename = this.getThumbnailFilename(filename);
      const thumbnailPath = path.join(galleryDir, thumbnailFilename);

      try {
        // Try to use sharp for thumbnail generation
        const sharp = require('sharp');
        await sharp(galleryPath)
          .resize(720, null, { withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toFile(thumbnailPath);

        console.error(`[MCP] Generated thumbnail: ${thumbnailFilename}`);
      } catch (e) {
        // Fallback: just copy the original as thumbnail
        // The browser will handle the resize
        if (!fs.existsSync(thumbnailPath)) {
          fs.copyFileSync(galleryPath, thumbnailPath);
          console.error(`[MCP] Copied as thumbnail (sharp unavailable): ${thumbnailFilename}`);
        }
      }

      // Get dimensions
      let dimensions = { width: 0, height: 0 };
      try {
        dimensions = sizeOf(galleryPath);
      } catch (e) {
        // Ignore
      }

      results.push({
        filename: filename,
        thumbnailFilename: thumbnailFilename,
        width: dimensions.width || 0,
        height: dimensions.height || 0
      });
    }

    return results;
  }
}

module.exports = BlockEditorHelper;
