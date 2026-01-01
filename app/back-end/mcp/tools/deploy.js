/**
 * MCP Tools for Site Rendering and Deployment
 *
 * Provides tools to:
 * - Render site (generate static HTML)
 * - Deploy site (upload to configured server)
 * - Get sync status
 */

const path = require('path');
const fs = require('fs-extra');
const childProcess = require('child_process');
const os = require('os');

class DeployTools {
  /**
   * Get tool definitions for MCP protocol
   */
  static getToolDefinitions() {
    return [
      {
        name: 'render_site',
        description: 'Generate static HTML for a site. This must be done before deploying. Returns the path to the generated output directory.',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site directory name (use list_sites to see available sites)'
            }
          },
          required: ['site']
        }
      },
      {
        name: 'deploy_site',
        description: 'Deploy site to the configured server. Requires render_site to be run first. Supports all deployment protocols configured in Publii (FTP, SFTP, S3, GitHub Pages, Netlify, etc.). For protocols requiring credentials, these must be configured in Publii first.',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site directory name (use list_sites to see available sites)'
            }
          },
          required: ['site']
        }
      },
      {
        name: 'get_sync_status',
        description: 'Get the synchronization status of a site. Shows when the site was last synced and the current deployment configuration.',
        inputSchema: {
          type: 'object',
          properties: {
            site: {
              type: 'string',
              description: 'Site directory name (use list_sites to see available sites)'
            }
          },
          required: ['site']
        }
      }
    ];
  }

  /**
   * Handle tool calls
   */
  static async handleToolCall(toolName, args, appInstance) {
    switch (toolName) {
      case 'render_site':
        return await this.renderSite(args.site, appInstance);

      case 'deploy_site':
        return await this.deploySite(args.site, appInstance);

      case 'get_sync_status':
        return await this.getSyncStatus(args.site, appInstance);

      default:
        throw new Error(`Unknown deploy tool: ${toolName}`);
    }
  }

  /**
   * Render site - generate static HTML
   */
  static async renderSite(siteName, appInstance) {
    try {
      // Validate site exists
      if (!appInstance.sites || !appInstance.sites[siteName]) {
        const availableSites = Object.keys(appInstance.sites || {}).join(', ');
        throw new Error(`Site "${siteName}" not found. Available sites: ${availableSites || 'none'}. Use list_sites tool first.`);
      }

      const siteConfig = appInstance.sites[siteName];
      const outputDir = path.join(appInstance.sitesDir, siteName, 'output');

      console.error(`[MCP] Starting render for site: ${siteName}`);

      // Use worker process like Publii does for proper progress handling
      const result = await this.runRendererWorker(appInstance, siteConfig);

      if (result.success) {
        // Count generated files
        let fileCount = 0;
        try {
          fileCount = this.countFilesRecursive(outputDir);
        } catch (e) {
          // Ignore count errors
        }

        console.error(`[MCP] Render complete: ${fileCount} files generated`);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Site "${siteName}" rendered successfully`,
              site: siteName,
              outputPath: outputDir,
              filesGenerated: fileCount
            }, null, 2)
          }]
        };
      } else {
        throw new Error(result.error || 'Rendering failed');
      }
    } catch (error) {
      console.error('[MCP] render_site error:', error);
      throw error;
    }
  }

  /**
   * Run renderer worker process
   */
  static runRendererWorker(appInstance, siteConfig) {
    return new Promise((resolve, reject) => {
      // Use basedir (installation directory) for worker paths, not appDir (user data directory)
      const workerPath = path.join(appInstance.basedir, 'back-end', 'workers', 'renderer', 'preview.js');

      // Create log directory if needed
      const logsDir = path.join(os.homedir(), 'Documents', 'Publii', 'logs');
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      const rendererProcess = childProcess.fork(workerPath, {
        stdio: [
          null,
          fs.openSync(path.join(logsDir, 'mcp-rendering-process.log'), 'w'),
          fs.openSync(path.join(logsDir, 'mcp-rendering-errors.log'), 'w'),
          'ipc'
        ]
      });

      let progressMessages = [];

      rendererProcess.on('message', (data) => {
        if (data.type === 'app-rendering-results') {
          if (data.result === true) {
            resolve({ success: true });
          } else {
            let errorMsg = 'Rendering failed';
            if (data.result && data.result[0] && data.result[0].message) {
              errorMsg = `${data.result[0].message}: ${data.result[0].desc || ''}`;
            }
            resolve({ success: false, error: errorMsg });
          }
        } else if (data.type === 'app-rendering-progress') {
          progressMessages.push(data.message);
          console.error(`[MCP] Render progress: ${data.progress}% - ${data.message}`);
        }
      });

      rendererProcess.on('error', (err) => {
        reject(new Error(`Renderer process error: ${err.message}`));
      });

      rendererProcess.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          reject(new Error(`Renderer process exited with code ${code}`));
        }
      });

      // Send configuration to worker
      rendererProcess.send({
        type: 'dependencies',
        appDir: appInstance.appDir,
        sitesDir: appInstance.sitesDir,
        siteConfig: siteConfig,
        itemID: false,
        postData: false,
        previewMode: false,
        singlePageMode: false,
        homepageOnlyMode: false,
        tagOnlyMode: false,
        authorOnlyMode: false,
        previewLocation: ''
      });
    });
  }

  /**
   * Deploy site to configured server
   */
  static async deploySite(siteName, appInstance) {
    try {
      // Validate site exists
      if (!appInstance.sites || !appInstance.sites[siteName]) {
        const availableSites = Object.keys(appInstance.sites || {}).join(', ');
        throw new Error(`Site "${siteName}" not found. Available sites: ${availableSites || 'none'}. Use list_sites tool first.`);
      }

      const siteConfig = appInstance.sites[siteName];
      const outputDir = path.join(appInstance.sitesDir, siteName, 'output');

      // Check if output directory exists (site must be rendered first)
      if (!fs.existsSync(outputDir) || fs.readdirSync(outputDir).length === 0) {
        throw new Error('Site must be rendered first. Use render_site tool before deploying.');
      }

      // Check deployment configuration
      const protocol = siteConfig.deployment?.protocol;
      if (!protocol) {
        throw new Error('No deployment protocol configured. Please configure deployment settings in Publii first.');
      }

      console.error(`[MCP] Starting deployment for site: ${siteName} (protocol: ${protocol})`);

      // Run deployment worker
      const result = await this.runDeploymentWorker(appInstance, siteConfig);

      if (result.success) {
        // Update sync status in config
        await this.updateSyncStatus(siteName, appInstance);

        console.error(`[MCP] Deployment complete for: ${siteName}`);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Site "${siteName}" deployed successfully`,
              site: siteName,
              protocol: protocol,
              deploymentPath: result.path || siteConfig.deployment?.path || ''
            }, null, 2)
          }]
        };
      } else {
        throw new Error(result.error || 'Deployment failed');
      }
    } catch (error) {
      console.error('[MCP] deploy_site error:', error);
      throw error;
    }
  }

  /**
   * Run deployment worker process
   */
  static runDeploymentWorker(appInstance, siteConfig) {
    return new Promise((resolve, reject) => {
      // Use basedir (installation directory) for worker paths
      const workerPath = path.join(appInstance.basedir, 'back-end', 'workers', 'deploy', 'deployment.js');

      // Create log directory if needed
      const logsDir = path.join(os.homedir(), 'Documents', 'Publii', 'logs');
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      const deploymentProcess = childProcess.fork(workerPath, {
        stdio: [
          null,
          fs.openSync(path.join(logsDir, 'mcp-deployment-process.log'), 'w'),
          fs.openSync(path.join(logsDir, 'mcp-deployment-errors.log'), 'w'),
          'ipc'
        ]
      });

      let lastProgress = 0;
      let deploymentPath = '';
      let hasResolved = false;

      // Timeout after 10 minutes
      const timeout = setTimeout(() => {
        if (!hasResolved) {
          hasResolved = true;
          try {
            deploymentProcess.kill();
          } catch (e) {}
          reject(new Error('Deployment timed out after 10 minutes'));
        }
      }, 600000);

      deploymentProcess.on('message', (data) => {
        if (data.type === 'web-contents') {
          const message = data.message;
          const value = data.value;

          if (message === 'app-uploading-progress') {
            lastProgress = value.progress || 0;
            console.error(`[MCP] Upload progress: ${lastProgress}%`);
          } else if (message === 'app-deploy-uploaded') {
            clearTimeout(timeout);
            if (!hasResolved) {
              hasResolved = true;
              if (value && value.status) {
                resolve({ success: true, path: value.path || deploymentPath });
              } else {
                resolve({ success: false, error: 'Deployment failed' });
              }
            }
          } else if (message === 'app-connection-error') {
            clearTimeout(timeout);
            if (!hasResolved) {
              hasResolved = true;
              const errorMsg = value?.additionalMessage?.translation || 'Connection error';
              resolve({ success: false, error: errorMsg });
            }
          } else if (message === 'no-remote-files') {
            // First-time sync or mismatch - continue anyway
            console.error('[MCP] No remote file list found, performing full sync');
            deploymentProcess.send({ type: 'continue-sync' });
          }
        } else if (data.type === 'sender') {
          // Handle sender-type messages
          if (data.message === 'app-deploy-uploaded') {
            clearTimeout(timeout);
            if (!hasResolved) {
              hasResolved = true;
              if (data.value && data.value.status) {
                resolve({ success: true, path: data.value.path || '' });
              } else {
                resolve({ success: false, error: 'Deployment failed' });
              }
            }
          }
        }
      });

      deploymentProcess.on('error', (err) => {
        clearTimeout(timeout);
        if (!hasResolved) {
          hasResolved = true;
          reject(new Error(`Deployment process error: ${err.message}`));
        }
      });

      deploymentProcess.on('exit', (code) => {
        clearTimeout(timeout);
        if (!hasResolved) {
          hasResolved = true;
          if (code === 0 || code === null) {
            // Normal exit - assume success if we haven't received an error
            resolve({ success: true, path: deploymentPath });
          } else {
            reject(new Error(`Deployment process exited with code ${code}`));
          }
        }
      });

      // Send configuration to worker
      deploymentProcess.send({
        type: 'dependencies',
        appDir: appInstance.appDir,
        sitesDir: appInstance.sitesDir,
        siteConfig: siteConfig,
        useFtpAlt: appInstance.appConfig?.experimentalFeatureAppFtpAlt || false
      });
    });
  }

  /**
   * Update sync status in site config
   */
  static async updateSyncStatus(siteName, appInstance) {
    try {
      const configPath = path.join(appInstance.sitesDir, siteName, 'input', 'config', 'site.config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        config.synced = 'synced';
        config.syncDate = Date.now();
        fs.writeFileSync(configPath, JSON.stringify(config, null, 4));

        // Update in-memory config
        if (appInstance.sites && appInstance.sites[siteName]) {
          appInstance.sites[siteName].synced = 'synced';
          appInstance.sites[siteName].syncDate = config.syncDate;
        }
      }
    } catch (e) {
      console.error('[MCP] Error updating sync status:', e.message);
    }
  }

  /**
   * Get sync status for a site
   */
  static async getSyncStatus(siteName, appInstance) {
    try {
      // Validate site exists
      if (!appInstance.sites || !appInstance.sites[siteName]) {
        const availableSites = Object.keys(appInstance.sites || {}).join(', ');
        throw new Error(`Site "${siteName}" not found. Available sites: ${availableSites || 'none'}. Use list_sites tool first.`);
      }

      const siteConfig = appInstance.sites[siteName];
      const outputDir = path.join(appInstance.sitesDir, siteName, 'output');

      // Check if output exists
      const outputExists = fs.existsSync(outputDir) && fs.readdirSync(outputDir).length > 0;
      let outputFileCount = 0;
      if (outputExists) {
        try {
          outputFileCount = this.countFilesRecursive(outputDir);
        } catch (e) {
          // Ignore
        }
      }

      // Get deployment config (without sensitive info)
      const deploymentInfo = {
        protocol: siteConfig.deployment?.protocol || 'not configured',
        server: siteConfig.deployment?.server || '',
        path: siteConfig.deployment?.path || '',
        relativeUrls: siteConfig.deployment?.relativeUrls || false
      };

      // Format sync date
      let syncDateFormatted = 'Never';
      if (siteConfig.syncDate) {
        syncDateFormatted = new Date(siteConfig.syncDate).toISOString();
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            site: siteName,
            synced: siteConfig.synced === 'synced',
            syncStatus: siteConfig.synced || 'not synced',
            lastSyncDate: siteConfig.syncDate || null,
            lastSyncDateFormatted: syncDateFormatted,
            outputGenerated: outputExists,
            outputFileCount: outputFileCount,
            deployment: deploymentInfo
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error('[MCP] get_sync_status error:', error);
      throw error;
    }
  }

  /**
   * Count files recursively in a directory
   */
  static countFilesRecursive(dir) {
    let count = 0;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        count += this.countFilesRecursive(path.join(dir, entry.name));
      } else {
        count++;
      }
    }
    return count;
  }
}

module.exports = DeployTools;
