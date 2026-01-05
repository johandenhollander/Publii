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

// Logs directory for deployment/render logs
const LOGS_DIR = path.join(os.homedir(), 'Documents', 'Publii', 'logs');

// Deployment status file (tracks last deployment attempt per site)
const DEPLOY_STATUS_FILE = path.join(os.homedir(), 'Documents', 'Publii', 'config', 'mcp-deploy-status.json');

class DeployTools {
  /**
   * Save deployment status for a site
   */
  static saveDeployStatus(siteName, status) {
    try {
      let allStatus = {};
      if (fs.existsSync(DEPLOY_STATUS_FILE)) {
        allStatus = JSON.parse(fs.readFileSync(DEPLOY_STATUS_FILE, 'utf8'));
      }
      allStatus[siteName] = {
        ...status,
        timestamp: Date.now(),
        timestampFormatted: new Date().toISOString()
      };
      fs.writeFileSync(DEPLOY_STATUS_FILE, JSON.stringify(allStatus, null, 2));
    } catch (e) {
      console.error('[MCP] Error saving deploy status:', e.message);
    }
  }

  /**
   * Get deployment status for a site
   */
  static getDeployStatus(siteName) {
    try {
      if (fs.existsSync(DEPLOY_STATUS_FILE)) {
        const allStatus = JSON.parse(fs.readFileSync(DEPLOY_STATUS_FILE, 'utf8'));
        return allStatus[siteName] || null;
      }
    } catch (e) {
      console.error('[MCP] Error reading deploy status:', e.message);
    }
    return null;
  }

  /**
   * Read last N lines from a log file
   */
  static readLogTail(logPath, maxLines = 50) {
    try {
      if (fs.existsSync(logPath)) {
        const content = fs.readFileSync(logPath, 'utf8');
        const lines = content.split('\n').filter(l => l.trim());
        return lines.slice(-maxLines).join('\n');
      }
    } catch (e) {
      // Ignore read errors
    }
    return '';
  }

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
   * @param {string} toolName - The tool to execute
   * @param {object} args - Tool arguments
   * @param {object} appInstance - App instance
   * @param {function} sendProgress - Optional callback for progress notifications (progress, total, message)
   */
  static async handleToolCall(toolName, args, appInstance, sendProgress = null) {
    switch (toolName) {
      case 'render_site':
        return await this.renderSite(args.site, appInstance, sendProgress);

      case 'deploy_site':
        return await this.deploySite(args.site, appInstance, sendProgress);

      case 'get_sync_status':
        return await this.getSyncStatus(args.site, appInstance);

      default:
        throw new Error(`Unknown deploy tool: ${toolName}`);
    }
  }

  /**
   * Render site - generate static HTML
   * @param {string} siteName - Site to render
   * @param {object} appInstance - App instance
   * @param {function} sendProgress - Optional callback for progress notifications
   */
  static async renderSite(siteName, appInstance, sendProgress = null) {
    try {
      // Validate site exists
      if (!appInstance.sites || !appInstance.sites[siteName]) {
        const availableSites = Object.keys(appInstance.sites || {}).join(', ');
        throw new Error(`Site "${siteName}" not found. Available sites: ${availableSites || 'none'}. Use list_sites tool first.`);
      }

      const siteConfig = appInstance.sites[siteName];
      const outputDir = path.join(appInstance.sitesDir, siteName, 'output');

      console.error(`[MCP] Starting render for site: ${siteName}`);

      // Send initial progress
      if (sendProgress) {
        await sendProgress(0, 100, 'Starting render...');
      }

      // Use worker process like Publii does for proper progress handling
      const result = await this.runRendererWorker(appInstance, siteConfig, sendProgress);

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
   * @param {object} appInstance - App instance
   * @param {object} siteConfig - Site configuration
   * @param {function} sendProgress - Optional callback for progress notifications
   */
  static runRendererWorker(appInstance, siteConfig, sendProgress = null) {
    return new Promise((resolve, reject) => {
      // Use basedir (installation directory) for worker paths, not appDir (user data directory)
      const workerPath = path.join(appInstance.basedir, 'back-end', 'workers', 'renderer', 'preview.js');

      // Create log directory if needed
      if (!fs.existsSync(LOGS_DIR)) {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
      }

      const stdoutLogPath = path.join(LOGS_DIR, 'mcp-rendering-process.log');
      const stderrLogPath = path.join(LOGS_DIR, 'mcp-rendering-errors.log');

      const rendererProcess = childProcess.fork(workerPath, {
        stdio: [
          null,
          fs.openSync(stdoutLogPath, 'w'),
          fs.openSync(stderrLogPath, 'w'),
          'ipc'
        ]
      });

      let progressMessages = [];
      let hasResolved = false;
      let lastProgress = 0;

      // Timeout after 5 minutes for rendering (large sites may take longer)
      const timeout = setTimeout(() => {
        if (!hasResolved) {
          hasResolved = true;
          try {
            rendererProcess.kill();
          } catch (e) {}

          const errorLog = this.readLogTail(stderrLogPath, 20);
          reject(new Error(`Rendering timed out after 5 minutes at ${lastProgress}% progress.${errorLog ? `\n\nError log:\n${errorLog}` : ''}\n\nLog files:\n- ${stdoutLogPath}\n- ${stderrLogPath}`));
        }
      }, 300000); // 5 minutes

      rendererProcess.on('message', (data) => {
        if (data.type === 'app-rendering-results') {
          clearTimeout(timeout);
          if (!hasResolved) {
            hasResolved = true;
            if (data.result === true) {
              resolve({ success: true, progressMessages });
            } else {
              let errorMsg = 'Rendering failed';
              if (data.result && data.result[0] && data.result[0].message) {
                errorMsg = `${data.result[0].message}: ${data.result[0].desc || ''}`;
              }
              const errorLog = this.readLogTail(stderrLogPath, 20);
              resolve({
                success: false,
                error: errorMsg,
                errorLog: errorLog,
                logFiles: { stdout: stdoutLogPath, stderr: stderrLogPath }
              });
            }
          }
        } else if (data.type === 'app-rendering-progress') {
          lastProgress = data.progress || 0;
          progressMessages.push(data.message);
          console.error(`[MCP] Render progress: ${lastProgress}% - ${data.message}`);

          // Send MCP progress notification
          if (sendProgress) {
            sendProgress(lastProgress, 100, data.message).catch(() => {});
          }
        }
      });

      rendererProcess.on('error', (err) => {
        clearTimeout(timeout);
        if (!hasResolved) {
          hasResolved = true;
          const errorLog = this.readLogTail(stderrLogPath, 20);
          reject(new Error(`Renderer process error: ${err.message}${errorLog ? `\n\nError log:\n${errorLog}` : ''}\n\nLog files:\n- ${stdoutLogPath}\n- ${stderrLogPath}`));
        }
      });

      rendererProcess.on('exit', (code) => {
        clearTimeout(timeout);
        if (!hasResolved) {
          hasResolved = true;
          if (code !== 0 && code !== null) {
            const errorLog = this.readLogTail(stderrLogPath, 20);
            reject(new Error(`Renderer process exited with code ${code}${errorLog ? `\n\nError log:\n${errorLog}` : ''}\n\nLog files:\n- ${stdoutLogPath}\n- ${stderrLogPath}`));
          } else {
            // Process exited normally without sending results - treat as success
            resolve({ success: true, progressMessages });
          }
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
   * @param {string} siteName - Site to deploy
   * @param {object} appInstance - App instance
   * @param {function} sendProgress - Optional callback for progress notifications
   */
  static async deploySite(siteName, appInstance, sendProgress = null) {
    const protocol = appInstance.sites?.[siteName]?.deployment?.protocol || 'unknown';
    const startTime = Date.now();

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
      if (!siteConfig.deployment?.protocol) {
        throw new Error('No deployment protocol configured. Please configure deployment settings in Publii first.');
      }

      console.error(`[MCP] Starting deployment for site: ${siteName} (protocol: ${protocol})`);

      // Send initial progress
      if (sendProgress) {
        await sendProgress(0, 100, 'Starting deployment...');
      }

      // Run deployment worker
      const result = await this.runDeploymentWorker(appInstance, siteConfig, siteName, sendProgress);

      if (result.success) {
        // Update sync status in config
        await this.updateSyncStatus(siteName, appInstance);

        // Save successful deployment status
        this.saveDeployStatus(siteName, {
          result: 'success',
          protocol: protocol,
          path: result.path || siteConfig.deployment?.path || '',
          duration: Date.now() - startTime
        });

        console.error(`[MCP] Deployment complete for: ${siteName}`);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Site "${siteName}" deployed successfully`,
              site: siteName,
              protocol: protocol,
              deploymentPath: result.path || siteConfig.deployment?.path || '',
              duration: `${Date.now() - startTime}ms`
            }, null, 2)
          }]
        };
      } else {
        // Save failed deployment status
        this.saveDeployStatus(siteName, {
          result: 'failed',
          protocol: protocol,
          error: result.error,
          errorLog: result.errorLog || null,
          logFiles: result.logFiles || null,
          duration: Date.now() - startTime
        });

        // Include log info in error message
        let errorMessage = result.error || 'Deployment failed';
        if (result.errorLog) {
          errorMessage += `\n\nError log (last 50 lines):\n${result.errorLog}`;
        }
        if (result.logFiles) {
          errorMessage += `\n\nFull logs available at:\n- ${result.logFiles.stdout}\n- ${result.logFiles.stderr}`;
        }
        throw new Error(errorMessage);
      }
    } catch (error) {
      console.error('[MCP] deploy_site error:', error);

      // Save error status if not already saved
      const currentStatus = this.getDeployStatus(siteName);
      if (!currentStatus || currentStatus.timestamp < startTime) {
        this.saveDeployStatus(siteName, {
          result: 'failed',
          protocol: protocol,
          error: error.message,
          duration: Date.now() - startTime
        });
      }

      throw error;
    }
  }

  /**
   * Run deployment worker process
   * @param {object} appInstance - App instance
   * @param {object} siteConfig - Site configuration
   * @param {string} siteName - Site name
   * @param {function} sendProgress - Optional callback for progress notifications
   */
  static runDeploymentWorker(appInstance, siteConfig, siteName, sendProgress = null) {
    return new Promise((resolve, reject) => {
      // Use basedir (installation directory) for worker paths
      const workerPath = path.join(appInstance.basedir, 'back-end', 'workers', 'deploy', 'deployment.js');

      // Create log directory if needed
      if (!fs.existsSync(LOGS_DIR)) {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
      }

      const stdoutLogPath = path.join(LOGS_DIR, 'mcp-deployment-process.log');
      const stderrLogPath = path.join(LOGS_DIR, 'mcp-deployment-errors.log');

      const deploymentProcess = childProcess.fork(workerPath, {
        stdio: [
          null,
          fs.openSync(stdoutLogPath, 'w'),
          fs.openSync(stderrLogPath, 'w'),
          'ipc'
        ]
      });

      let lastProgress = 0;
      let deploymentPath = '';
      let hasResolved = false;
      let errorMessages = [];

      // Timeout after 10 minutes
      const timeout = setTimeout(() => {
        if (!hasResolved) {
          hasResolved = true;
          try {
            deploymentProcess.kill();
          } catch (e) {}

          const errorLog = this.readLogTail(stderrLogPath, 50);
          resolve({
            success: false,
            error: `Deployment timed out after 10 minutes at ${lastProgress}% progress`,
            errorLog: errorLog,
            logFiles: { stdout: stdoutLogPath, stderr: stderrLogPath }
          });
        }
      }, 600000);

      deploymentProcess.on('message', (data) => {
        if (data.type === 'web-contents') {
          const message = data.message;
          const value = data.value;

          if (message === 'app-uploading-progress') {
            lastProgress = value.progress || 0;
            console.error(`[MCP] Upload progress: ${lastProgress}%`);

            // Send MCP progress notification
            if (sendProgress) {
              const ops = value.operations;
              const msg = ops ? `Uploading files (${ops[0]}/${ops[1]})` : `Uploading... ${lastProgress}%`;
              sendProgress(lastProgress, 100, msg).catch(() => {});
            }
          } else if (message === 'app-deploy-uploaded') {
            clearTimeout(timeout);
            if (!hasResolved) {
              hasResolved = true;
              if (value && value.status) {
                resolve({ success: true, path: value.path || deploymentPath });
              } else {
                const errorLog = this.readLogTail(stderrLogPath, 50);
                resolve({
                  success: false,
                  error: 'Deployment completed but reported failure status',
                  errorLog: errorLog,
                  logFiles: { stdout: stdoutLogPath, stderr: stderrLogPath }
                });
              }
            }
          } else if (message === 'app-connection-error') {
            clearTimeout(timeout);
            if (!hasResolved) {
              hasResolved = true;
              let errorMsg = 'Connection error';
              if (value?.additionalMessage?.translation) {
                errorMsg = value.additionalMessage.translation;
              } else if (value?.message) {
                errorMsg = value.message;
              }
              errorMessages.push(errorMsg);

              const errorLog = this.readLogTail(stderrLogPath, 50);
              resolve({
                success: false,
                error: errorMsg,
                errorLog: errorLog,
                logFiles: { stdout: stdoutLogPath, stderr: stderrLogPath }
              });
            }
          } else if (message === 'no-remote-files') {
            // First-time sync or mismatch - continue anyway
            console.error('[MCP] No remote file list found, performing full sync');
            deploymentProcess.send({ type: 'continue-sync' });
          } else if (message === 'app-deploy-error' || message === 'app-upload-error') {
            // Capture error messages
            const errorMsg = value?.message || value?.error || message;
            errorMessages.push(errorMsg);
            console.error(`[MCP] Deployment error: ${errorMsg}`);
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
                const errorLog = this.readLogTail(stderrLogPath, 50);
                resolve({
                  success: false,
                  error: 'Deployment failed',
                  errorLog: errorLog,
                  logFiles: { stdout: stdoutLogPath, stderr: stderrLogPath }
                });
              }
            }
          }
        }
      });

      deploymentProcess.on('error', (err) => {
        clearTimeout(timeout);
        if (!hasResolved) {
          hasResolved = true;
          const errorLog = this.readLogTail(stderrLogPath, 50);
          resolve({
            success: false,
            error: `Deployment process error: ${err.message}`,
            errorLog: errorLog,
            logFiles: { stdout: stdoutLogPath, stderr: stderrLogPath }
          });
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
            const errorLog = this.readLogTail(stderrLogPath, 50);
            const collectedErrors = errorMessages.length > 0 ? `\nCollected errors: ${errorMessages.join('; ')}` : '';
            resolve({
              success: false,
              error: `Deployment process exited with code ${code}${collectedErrors}`,
              errorLog: errorLog,
              logFiles: { stdout: stdoutLogPath, stderr: stderrLogPath }
            });
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

      // Format sync date (last SUCCESSFUL sync from Publii)
      let lastSuccessfulSyncFormatted = 'Never';
      if (siteConfig.syncDate) {
        lastSuccessfulSyncFormatted = new Date(siteConfig.syncDate).toISOString();
      }

      // Get last deployment attempt (success OR failure) from MCP status
      const lastDeployment = this.getDeployStatus(siteName);
      let lastDeploymentInfo = null;
      if (lastDeployment) {
        lastDeploymentInfo = {
          result: lastDeployment.result,
          timestamp: lastDeployment.timestamp,
          timestampFormatted: lastDeployment.timestampFormatted,
          protocol: lastDeployment.protocol,
          duration: lastDeployment.duration ? `${lastDeployment.duration}ms` : null,
          error: lastDeployment.error || null,
          logFiles: lastDeployment.logFiles || null
        };
      }

      // Determine actual sync state
      // If last deployment failed AFTER last successful sync, we're NOT synced
      let actualSyncStatus = siteConfig.synced || 'not synced';
      let isActuallySynced = siteConfig.synced === 'synced';

      if (lastDeployment && lastDeployment.result === 'failed') {
        // Check if this failure is more recent than the last successful sync
        if (!siteConfig.syncDate || lastDeployment.timestamp > siteConfig.syncDate) {
          actualSyncStatus = 'deployment failed';
          isActuallySynced = false;
        }
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            site: siteName,
            synced: isActuallySynced,
            syncStatus: actualSyncStatus,
            lastSuccessfulSync: siteConfig.syncDate || null,
            lastSuccessfulSyncFormatted: lastSuccessfulSyncFormatted,
            lastDeploymentAttempt: lastDeploymentInfo,
            outputGenerated: outputExists,
            outputFileCount: outputFileCount,
            deployment: deploymentInfo,
            logDirectory: LOGS_DIR
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
