/**
 * Image Helper for MCP Tools
 *
 * Uses Publii's worker process to save images and generate responsive versions.
 * This ensures MCP-created content has the same image handling as UI-created content.
 *
 * Based on: app/back-end/events/image-uploader.js
 */

const path = require('path');
const fs = require('fs-extra');
const childProcess = require('child_process');
const sizeOf = require('image-size');
const normalizePath = require('normalize-path');
const slugify = require('../../helpers/slug.js');

// Debug logging helper
function debug(message, data = null) {
  const timestamp = new Date().toISOString();
  if (data) {
    console.error(`[MCP ${timestamp}] ${message}`, JSON.stringify(data, null, 2));
  } else {
    console.error(`[MCP ${timestamp}] ${message}`);
  }
}

/**
 * Save an image using Publii's worker process (same as UI)
 *
 * @param {string} sourcePath - Absolute path to the source image file
 * @param {Object} appInstance - Publii app instance with site info
 * @param {string} siteName - Site name
 * @param {number|string} itemId - Post/Page ID (0 or 'temp' for new items)
 * @param {string} imageType - 'featuredImages', 'contentImages', 'galleryImages', etc.
 * @returns {Promise<Object>} - { featuredImage, featuredImageFilename, dimensions }
 */
async function saveFeaturedImage(sourcePath, appInstance, siteName, itemId, imageType = 'featuredImages') {
  debug(`saveFeaturedImage called`, { sourcePath, siteName, itemId, imageType });

  // Validate source file exists
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    debug(`ERROR: Image file not found: ${sourcePath}`);
    throw new Error(`Image file not found: ${sourcePath}`);
  }

  // Get image dimensions before processing
  let originalDimensions = { width: 0, height: 0 };
  try {
    originalDimensions = sizeOf(sourcePath);
    debug(`Original image dimensions: ${originalDimensions.width}x${originalDimensions.height}`);
  } catch (e) {
    debug(`WARNING: Could not read original image dimensions: ${e.message}`);
  }

  // Ensure appConfig exists with resizeEngine (required by Image class)
  if (!appInstance.appConfig) {
    appInstance.appConfig = { resizeEngine: 'sharp' };
  } else if (!appInstance.appConfig.resizeEngine) {
    appInstance.appConfig.resizeEngine = 'sharp';
  }

  // Use Publii's worker process for image handling (same as UI)
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, '../../workers/thumbnails/post-images.js');
    debug(`Forking worker: ${workerPath}`);

    const imageProcess = childProcess.fork(workerPath);

    // Prepare image data (same format as UI sends)
    const imageData = {
      id: itemId === 0 ? 0 : itemId,  // 0 means temp directory
      path: sourcePath,
      imageType: imageType,
      site: siteName
    };

    // Send dependencies to worker (same as image-uploader.js)
    imageProcess.send({
      type: 'dependencies',
      appInstance: {
        appConfig: appInstance.appConfig,
        appDir: appInstance.appDir,
        sitesDir: appInstance.sitesDir,
        db: appInstance.db
      },
      imageData: imageData
    });

    debug(`Sent dependencies to worker`, { imageData });

    // Handle worker messages
    imageProcess.on('message', function(data) {
      debug(`Worker message received`, { type: data.type });

      if (data.type === 'image-copied') {
        debug(`Image copied, starting responsive image generation`);
        imageProcess.send({
          type: 'start-regenerating'
        });
      } else if (data.type === 'finished') {
        debug(`Worker finished`, data.result);

        const baseImage = data.result.baseImage || data.result;
        const filename = baseImage.filename || path.basename(sourcePath);

        resolve({
          featuredImage: baseImage.url,
          featuredImageFilename: filename,
          dimensions: [originalDimensions.width, originalDimensions.height],
          thumbnailPath: data.result.thumbnailPath,
          thumbnailDimensions: data.result.thumbnailDimensions
        });
      }
    });

    // Handle worker errors
    imageProcess.on('error', function(err) {
      debug(`Worker error: ${err.message}`);
      reject(new Error(`Image worker error: ${err.message}`));
    });

    // Handle worker exit without finish message
    imageProcess.on('exit', function(code) {
      if (code !== 0) {
        debug(`Worker exited with code ${code}`);
        // Don't reject here - the worker exits after sending 'finished'
      }
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      debug(`Worker timeout - killing process`);
      imageProcess.kill();
      reject(new Error('Image processing timeout after 30 seconds'));
    }, 30000);
  });
}

/**
 * Remove featured image files for a post/page
 */
function removeFeaturedImage(appInstance, siteName, itemId) {
  debug(`removeFeaturedImage called`, { siteName, itemId });

  const dirPath = path.join(appInstance.sitesDir, siteName, 'input', 'media', 'posts', itemId.toString());
  const responsiveDirPath = path.join(dirPath, 'responsive');

  // Remove responsive images
  if (fs.existsSync(responsiveDirPath)) {
    fs.emptyDirSync(responsiveDirPath);
    debug(`Cleared responsive images directory: ${responsiveDirPath}`);
  }

  debug(`Finished removing featured image for item ${itemId}`);
}

module.exports = {
  saveFeaturedImage,
  removeFeaturedImage,
  debug  // Export for use in other MCP modules
};
