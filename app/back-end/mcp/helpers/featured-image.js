/**
 * Image Helper for MCP Tools
 *
 * Uses Publii's Image class to properly save images and generate responsive versions.
 * This ensures MCP-created content has the same image handling as UI-created content.
 *
 * Supports all image types:
 * - featuredImages: Post/page hero images
 * - contentImages: Images in post/page content
 * - galleryImages: Images in galleries (thumbnail generation)
 * - optionImages: Theme option images
 * - tagImages/authorImages: Tag and author images
 */

const path = require('path');
const fs = require('fs-extra');
const Image = require('../../image.js');
const sizeOf = require('image-size');
const normalizePath = require('normalize-path');
const slugify = require('../../helpers/slug.js');

/**
 * Save an image using Publii's Image class with responsive generation
 *
 * @param {string} sourcePath - Absolute path to the source image file
 * @param {Object} appInstance - Publii app instance with site info
 * @param {string} siteName - Site name
 * @param {number|string} itemId - Post/Page ID (0 or 'temp' for new items)
 * @param {string} imageType - 'featuredImages', 'contentImages', 'galleryImages', etc.
 * @returns {Promise<Object>} - { featuredImage, featuredImageFilename, dimensions }
 */
async function saveFeaturedImage(sourcePath, appInstance, siteName, itemId, imageType = 'featuredImages') {
  // Validate source file exists
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error(`Image file not found: ${sourcePath}`);
  }

  // Ensure appConfig exists with resizeEngine (required by Image class)
  if (!appInstance.appConfig) {
    appInstance.appConfig = { resizeEngine: 'sharp' };
  } else if (!appInstance.appConfig.resizeEngine) {
    appInstance.appConfig.resizeEngine = 'sharp';
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

  // Store original itemId since Image class converts 'temp' to NaN via parseInt
  const originalItemId = itemId;

  // Save image to correct location based on type
  const result = await saveImageToDirectory(image, imageType, originalItemId);

  if (!result || !result.newPath) {
    throw new Error('Failed to save image');
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
  } else {
    console.error(`[MCP] No responsive images configured for type: ${imageType}`);
  }

  return {
    featuredImage: result.url,
    featuredImageFilename: result.filename,
    dimensions: result.size
  };
}

/**
 * Save image to the correct directory based on image type
 * @param {Object} imageInstance - Image instance with siteDir and path
 * @param {string} imageType - Type of image (featuredImages, contentImages, etc.)
 * @param {number|string} originalItemId - Original item ID (preserves 'temp' or actual ID)
 */
function saveImageToDirectory(imageInstance, imageType, originalItemId) {
  return new Promise((resolve, reject) => {
    try {
      // Use originalItemId to avoid NaN from parseInt('temp')
      const idStr = originalItemId.toString();
      let dirPath;
      let responsiveDirPath;

      // Determine directory based on image type (mirrors Image.save() logic)
      switch (imageType) {
        case 'galleryImages':
          dirPath = path.join(imageInstance.siteDir, 'input', 'media', 'posts', idStr, 'gallery');
          responsiveDirPath = null;  // Gallery images don't have separate responsive dir
          break;

        case 'tagImages':
          dirPath = path.join(imageInstance.siteDir, 'input', 'media', 'tags', idStr);
          responsiveDirPath = path.join(dirPath, 'responsive');
          break;

        case 'authorImages':
          dirPath = path.join(imageInstance.siteDir, 'input', 'media', 'authors', idStr);
          responsiveDirPath = path.join(dirPath, 'responsive');
          break;

        case 'optionImages':
          dirPath = path.join(imageInstance.siteDir, 'input', 'media', 'website');
          responsiveDirPath = path.join(dirPath, 'responsive');
          break;

        default:  // featuredImages, contentImages
          dirPath = path.join(imageInstance.siteDir, 'input', 'media', 'posts', idStr);
          responsiveDirPath = path.join(dirPath, 'responsive');
      }

      // Ensure directories exist
      fs.ensureDirSync(dirPath);
      if (responsiveDirPath) {
        fs.ensureDirSync(responsiveDirPath);
      }

      // Generate clean filename
      const fileName = path.basename(imageInstance.path);
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
