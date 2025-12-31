/**
 * MCP Tools for Media Operations
 *
 * Manages media files (images, PDFs, etc.)
 */

const path = require('path');
const fs = require('fs');

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
              description: 'Media type: posts, website, files',
              enum: ['posts', 'website', 'files'],
              default: 'posts'
            }
          },
          required: ['site']
        }
      },
      {
        name: 'upload_media',
        description: 'Copy a media file to the site',
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
              description: 'Media type: posts, website, files',
              enum: ['posts', 'website', 'files'],
              default: 'posts'
            },
            filename: {
              type: 'string',
              description: 'Destination filename (uses source filename if not provided)'
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
        description: 'Get information about a media file',
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
        return await this.listMedia(args.site, args.type, appInstance);

      case 'upload_media':
        return await this.uploadMedia(args, appInstance);

      case 'delete_media':
        return await this.deleteMedia(args.site, args.relativePath, appInstance);

      case 'get_media_info':
        return await this.getMediaInfo(args.site, args.relativePath, appInstance);

      default:
        throw new Error(`Unknown media tool: ${toolName}`);
    }
  }

  /**
   * Get media directory path
   */
  static getMediaPath(siteName, type, appInstance) {
    return path.join(appInstance.sitesDir, siteName, 'input', 'media', type || 'posts');
  }

  /**
   * List media files
   */
  static async listMedia(siteName, type, appInstance) {
    try {
      const mediaType = type || 'posts';
      const mediaDir = this.getMediaPath(siteName, mediaType, appInstance);

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
            files.push({
              path: `media/${mediaType}/${relativePath}`,
              filename: entry.name,
              size: stats.size,
              modified: stats.mtime.toISOString()
            });
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
   * Upload (copy) a media file
   */
  static async uploadMedia(args, appInstance) {
    try {
      const { site, sourcePath, type = 'posts', filename } = args;

      // Verify source file exists
      if (!fs.existsSync(sourcePath)) {
        throw new Error(`Source file not found: ${sourcePath}`);
      }

      // Get destination directory
      const mediaDir = this.getMediaPath(site, type, appInstance);

      // Create directory if it doesn't exist
      if (!fs.existsSync(mediaDir)) {
        fs.mkdirSync(mediaDir, { recursive: true });
      }

      // Determine destination filename
      const destFilename = filename || path.basename(sourcePath);
      const destPath = path.join(mediaDir, destFilename);

      // Copy file
      fs.copyFileSync(sourcePath, destPath);

      const stats = fs.statSync(destPath);
      const relativePath = `media/${type}/${destFilename}`;

      console.log(`[MCP] Uploaded media: ${relativePath}`);

      // Notify frontend
      if (appInstance.mainWindow && appInstance.mainWindow.webContents) {
        appInstance.mainWindow.webContents.send('app-file-manager-uploaded', { path: relativePath });
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            message: `File uploaded to ${relativePath}`,
            path: relativePath,
            filename: destFilename,
            size: stats.size,
            site: site
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('[MCP] upload_media error:', error);
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

      console.log(`[MCP] Deleted media: ${relativePath}`);

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
   * Get media file information
   */
  static async getMediaInfo(siteName, relativePath, appInstance) {
    try {
      const fullPath = path.join(appInstance.sitesDir, siteName, 'input', relativePath);

      if (!fs.existsSync(fullPath)) {
        throw new Error(`File not found: ${relativePath}`);
      }

      const stats = fs.statSync(fullPath);
      const ext = path.extname(relativePath).toLowerCase();

      const info = {
        path: relativePath,
        filename: path.basename(relativePath),
        extension: ext,
        size: stats.size,
        created: stats.birthtime.toISOString(),
        modified: stats.mtime.toISOString(),
        isImage: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext),
        isPdf: ext === '.pdf'
      };

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
