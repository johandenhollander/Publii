/**
 * Featured Image Helper for MCP Tools
 *
 * Uses Publii's Image class to properly save images and generate responsive versions.
 * This ensures MCP-created posts have the same image handling as UI-created posts.
 */

const path = require('path');
const fs = require('fs-extra');
const Image = require('../../image.js');
const sizeOf = require('image-size');
const normalizePath = require('normalize-path');

/**
 * Save a featured image using Publii's Image class
 *
 * @param {string} sourcePath - Absolute path to the source image file
 * @param {Object} appInstance - Publii app instance with site info
 * @param {string} siteName - Site name
 * @param {number|string} itemId - Post/Page ID (0 or 'temp' for new items)
 * @param {string} imageType - 'featuredImages', 'contentImages', etc.
 * @returns {Promise<Object>} - { featuredImage, featuredImageFilename, dimensions }
 */
async function saveFeaturedImage(sourcePath, appInstance, siteName, itemId, imageType = 'featuredImages') {
  // Validate source file exists
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error(`Featured image file not found: ${sourcePath}`);
  }

  // Create image data for Publii's Image class
  const imageData = {
    id: itemId,
    path: sourcePath,
    imageType: imageType,
    site: siteName
  };

  // Create Image instance using Publii's class
  const image = new Image(appInstance, imageData);

  // Save returns synchronously with path info, but file copy is async
  // We need to wait for the file to be copied before generating responsive images
  const result = await saveImageSync(image);

  if (!result || !result.newPath) {
    throw new Error('Failed to save featured image');
  }

  // Generate responsive images using Publii's method
  const promises = image.createResponsiveImages(result.newPath, imageType);

  if (promises && promises.length > 0) {
    try {
      await Promise.all(promises);
      console.error(`[MCP] Generated ${promises.length} responsive images for: ${result.filename}`);
    } catch (err) {
      console.error('[MCP] Warning: Some responsive images may not have been generated:', err.message);
    }
  }

  return {
    featuredImage: result.url,
    featuredImageFilename: result.filename,
    dimensions: result.size
  };
}

/**
 * Synchronous wrapper for Image.save() that waits for file copy
 */
function saveImageSync(imageInstance) {
  return new Promise((resolve, reject) => {
    try {
      // Get the paths that Image.save() will use
      const dirPath = path.join(imageInstance.siteDir, 'input', 'media', 'posts', imageInstance.id.toString());
      const responsiveDirPath = path.join(dirPath, 'responsive');

      // Ensure directories exist
      fs.ensureDirSync(dirPath);
      fs.ensureDirSync(responsiveDirPath);

      // Get source file info
      const fileName = path.basename(imageInstance.path);
      const slugify = require('../../helpers/slug.js');
      const fileNameData = path.parse(fileName);
      const finalFileName = slugify(fileNameData.name, false, true) + fileNameData.ext;
      const destPath = path.join(dirPath, finalFileName);

      // Copy file synchronously
      fs.copySync(imageInstance.path, destPath);

      // Get dimensions
      let dimensions = [0, 0];
      try {
        const size = sizeOf(destPath);
        dimensions = [size.width, size.height];
      } catch (e) {
        console.error('[MCP] Warning: Could not read image dimensions');
      }

      resolve({
        size: dimensions,
        url: 'file:///' + normalizePath(destPath),
        filename: finalFileName,
        newPath: destPath
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Remove featured image files for a post/page
 */
function removeFeaturedImage(appInstance, siteName, itemId) {
  const dirPath = path.join(appInstance.sitesDir, siteName, 'input', 'media', 'posts', itemId.toString());
  const responsiveDirPath = path.join(dirPath, 'responsive');

  // Remove responsive images
  if (fs.existsSync(responsiveDirPath)) {
    fs.emptyDirSync(responsiveDirPath);
  }

  // Note: We don't remove the main image dir as it may contain other images
  console.error(`[MCP] Cleared responsive images for item ${itemId}`);
}

module.exports = {
  saveFeaturedImage,
  removeFeaturedImage
};
