/**
 * MCP Tools for Media Operations
 *
 * Uses Publii's native Image class for proper handling of:
 * - Responsive images
 * - Gallery thumbnails
 * - Proper file naming (slug)
 */

const path = require('path');
const fs = require('fs');
const sizeOf = require('image-size');
const normalizePath = require('normalize-path');
const { saveFeaturedImage } = require('../helpers/featured-image.js');

class MediaTools {
  /**
   * Get tool definitions for MCP protocol
   */
  static getToolDefinitions() {
    return [
      {
        name: 'list_media',
        description: 'List media files for a site',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site name (catalog name)'
            },
            type: {
              type: 'string',
              description: 'Media type: posts, website, files, gallery',
              enum: ['posts', 'website', 'files', 'gallery'],
              default: 'posts'
            },
            postId: {
              type: 'number',
              description: 'Post ID (required for gallery type)'
            }
          },
          required: ['site']
        }
      },
      {
        name: 'upload_image',
        description: 'Upload an image using Publii\'s native image handling (with responsive images and thumbnails). Returns a file:/// URL for use in post content. For block editor: use the returned "url" field in your image block content, along with imageWidth and imageHeight. Available imageAlign options: "center" (default), "wide", "full". Example workflow: 1) upload_image with postId=0, 2) Create post with block: {"type":"publii-image","content":{"image":"<url from response>","imageWidth":800,"imageHeight":600,"alt":"","caption":""},"config":{"imageAlign":"center"}}',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site name'
            },
            sourcePath: {
              type: 'string',
              description: 'Absolute path to the source image'
            },
            postId: {
              type: 'number',
              description: 'Post ID to associate the image with. Use 0 for new posts (images go to temp directory). Use existing post ID to add images to that post\'s directory.',
              default: 0
            },
            imageType: {
              type: 'string',
              description: 'Image type: contentImages (default, for post content), galleryImages (for galleries), optionImages (for theme options)',
              enum: ['contentImages', 'galleryImages', 'optionImages'],
              default: 'contentImages'
            }
          },
          required: ['site', 'sourcePath']
        }
      },
      {
        name: 'upload_file',
        description: 'Upload a non-image file (PDF, etc.) to the site',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site name'
            },
            sourcePath: {
              type: 'string',
              description: 'Absolute path to the source file'
            },
            type: {
              type: 'string',
              description: 'File type: website, files',
              enum: ['website', 'files'],
              default: 'files'
            }
          },
          required: ['site', 'sourcePath']
        }
      },
      {
        name: 'delete_media',
        description: 'Delete a media file',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site name'
            },
            relativePath: {
              type: 'string',
              description: 'Relative path to the file (e.g., media/website/logo.png)'
            }
          },
          required: ['site', 'relativePath']
        }
      },
      {
        name: 'get_media_info',
        description: 'Get information about a media file including dimensions',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site name'
            },
            relativePath: {
              type: 'string',
              description: 'Relative path to the file'
            }
          },
          required: ['site', 'relativePath']
        }
      }
    ];
  }

  /**
   * Handle tool calls
   */
  static async handleToolCall(toolName, args, appInstance) {
    switch (toolName) {
      case 'list_media':
        return await this.listMedia(args.site, args.type, args.postId, appInstance);

      case 'upload_image':
        return await this.uploadImage(args, appInstance);

      case 'upload_file':
        return await this.uploadFile(args, appInstance);

      case 'delete_media':
        return await this.deleteMedia(args.site, args.relativePath, appInstance);

      case 'get_media_info':
        return await this.getMediaInfo(args.site, args.relativePath, appInstance);

      default:
        throw new Error(`Unknown media tool: ${toolName}`);
    }
  }

  /**
   * List media files
   */
  static async listMedia(siteName, type, postId, appInstance) {
    try {
      const mediaType = type || 'posts';
      let mediaDir;

      if (mediaType === 'gallery' && postId) {
        mediaDir = path.join(appInstance.sitesDir, siteName, 'input', 'media', 'posts', postId.toString(), 'gallery');
      } else {
        mediaDir = path.join(appInstance.sitesDir, siteName, 'input', 'media', mediaType);
      }

      if (!fs.existsSync(mediaDir)) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              site: siteName,
              type: mediaType,
              count: 0,
              files: []
            }, null, 2)
          }]
        };
      }

      const files = [];

      // Recursively scan directory
      const scanDir = (dir, baseDir = '') => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.join(baseDir, entry.name);

          if (entry.isDirectory()) {
            scanDir(fullPath, relativePath);
          } else {
            const stats = fs.statSync(fullPath);
            const ext = path.extname(entry.name).toLowerCase();
            const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);

            const fileInfo = {
              path: `media/${mediaType}/${relativePath}`,
              fullPath: fullPath,
              filename: entry.name,
              size: stats.size,
              modified: stats.mtime.toISOString(),
              isImage: isImage
            };

            // Get dimensions for images
            if (isImage) {
              try {
                const dimensions = sizeOf(fullPath);
                fileInfo.width = dimensions.width;
                fileInfo.height = dimensions.height;
                fileInfo.dimensions = `${dimensions.width}x${dimensions.height}`;
              } catch (e) {
                // Ignore dimension errors
              }
            }

            files.push(fileInfo);
          }
        }
      };

      scanDir(mediaDir);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            site: siteName,
            type: mediaType,
            count: files.length,
            files: files
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('[MCP] list_media error:', error);
      throw error;
    }
  }

  /**
   * Upload image to site media directory with responsive image generation
   * Uses Publii's Image class for proper handling
   */
  static async uploadImage(args, appInstance) {
    try {
      const { site, sourcePath, postId = 0, imageType = 'contentImages' } = args;

      // Verify source file exists
      if (!fs.existsSync(sourcePath)) {
        throw new Error(`Source file not found: ${sourcePath}`);
      }

      // Use Publii's Image class to save with responsive generation
      // The helper works for all image types: contentImages, galleryImages, featuredImages, etc.
      // Use 0 for new posts - the Image class internally converts this to 'temp' directory
      const itemId = postId === 0 ? 0 : postId;

      const result = await saveFeaturedImage(
        sourcePath,
        appInstance,
        site,
        itemId,
        imageType
      );

      // Get dimensions from result
      const [width, height] = result.dimensions || [0, 0];

      console.error(`[MCP] Uploaded image with responsive versions: ${result.featuredImageFilename} (${width}x${height})`);

      // Notify frontend if running in Publii
      if (appInstance.mainWindow && appInstance.mainWindow.webContents) {
        appInstance.mainWindow.webContents.send('app-image-uploaded', {
          url: result.featuredImage,
          postId: postId
        });
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `Image uploaded with responsive versions`,
            url: result.featuredImage,
            filename: result.featuredImageFilename,
            imageWidth: width,
            imageHeight: height,
            site: site,
            postId: postId,
            imageType: imageType
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('[MCP] upload_image error:', error);
      throw error;
    }
  }

  /**
   * Upload a non-image file (PDF, etc.)
   */
  static async uploadFile(args, appInstance) {
    try {
      const { site, sourcePath, type = 'files' } = args;

      // Verify source file exists
      if (!fs.existsSync(sourcePath)) {
        throw new Error(`Source file not found: ${sourcePath}`);
      }

      // Get destination directory
      const mediaDir = path.join(appInstance.sitesDir, site, 'input', 'media', type);

      // Create directory if it doesn't exist
      if (!fs.existsSync(mediaDir)) {
        fs.mkdirSync(mediaDir, { recursive: true });
      }

      // Determine destination filename
      const destFilename = path.basename(sourcePath);
      const destPath = path.join(mediaDir, destFilename);

      // Copy file
      fs.copyFileSync(sourcePath, destPath);

      const stats = fs.statSync(destPath);
      const relativePath = `media/${type}/${destFilename}`;
      const fileUrl = 'file://' + normalizePath(destPath);

      console.error(`[MCP] Uploaded file: ${relativePath}`);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `File uploaded to ${relativePath}`,
            path: relativePath,
            url: fileUrl,
            filename: destFilename,
            size: stats.size,
            site: site
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('[MCP] upload_file error:', error);
      throw error;
    }
  }

  /**
   * Delete a media file
   */
  static async deleteMedia(siteName, relativePath, appInstance) {
    try {
      const fullPath = path.join(appInstance.sitesDir, siteName, 'input', relativePath);

      if (!fs.existsSync(fullPath)) {
        throw new Error(`File not found: ${relativePath}`);
      }

      fs.unlinkSync(fullPath);

      console.error(`[MCP] Deleted media: ${relativePath}`);

      // Notify frontend
      if (appInstance.mainWindow && appInstance.mainWindow.webContents) {
        appInstance.mainWindow.webContents.send('app-file-manager-deleted', { path: relativePath });
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `File deleted: ${relativePath}`,
            site: siteName
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('[MCP] delete_media error:', error);
      throw error;
    }
  }

  /**
   * Get media file information including dimensions
   */
  static async getMediaInfo(siteName, relativePath, appInstance) {
    try {
      const fullPath = path.join(appInstance.sitesDir, siteName, 'input', relativePath);

      if (!fs.existsSync(fullPath)) {
        throw new Error(`File not found: ${relativePath}`);
      }

      const stats = fs.statSync(fullPath);
      const ext = path.extname(relativePath).toLowerCase();
      const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext);

      const info = {
        path: relativePath,
        fullPath: fullPath,
        url: 'file://' + normalizePath(fullPath),
        filename: path.basename(relativePath),
        extension: ext,
        size: stats.size,
        created: stats.birthtime.toISOString(),
        modified: stats.mtime.toISOString(),
        isImage: isImage,
        isPdf: ext === '.pdf'
      };

      // Get dimensions for images
      if (isImage && ext !== '.svg') {
        try {
          const dimensions = sizeOf(fullPath);
          info.width = dimensions.width;
          info.height = dimensions.height;
          info.dimensions = `${dimensions.width}x${dimensions.height}`;
        } catch (e) {
          // Ignore dimension errors
        }
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            site: siteName,
            file: info
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('[MCP] get_media_info error:', error);
      throw error;
    }
  }
}

module.exports = MediaTools;
