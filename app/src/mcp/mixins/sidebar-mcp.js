/**
 * Sidebar MCP Mixin
 *
 * Provides MCP status polling and menu item logic for SidebarMenu.vue.
 * This isolates MCP-specific code to minimize upstream conflicts.
 *
 * Usage in SidebarMenu.vue:
 *   import McpMixin from '../mcp/mixins/sidebar-mcp';
 *   mixins: [McpMixin],
 */

export default {
    data() {
        return {
            mcpStatus: {
                active: false,
                isStale: true,
                processRunning: false,
                activeLock: null
            },
            mcpPollInterval: null,
            mcpFastPollInterval: null
        };
    },

    computed: {
        /**
         * CSS class for MCP status indicator
         */
        mcpStatusClass() {
            if (this.mcpHasProgress) {
                return 'mcp-progress';
            }
            if (this.mcpStatus.active && this.mcpStatus.processRunning && !this.mcpStatus.isStale) {
                return 'mcp-active';
            } else if (this.mcpStatus.active && this.mcpStatus.isStale) {
                return 'mcp-idle';
            }
            return 'mcp-inactive';
        },

        /**
         * Check if there's an active operation with progress
         */
        mcpHasProgress() {
            const lock = this.mcpStatus.activeLock;
            return lock &&
                   !lock.isCompleted &&
                   lock.progress !== undefined &&
                   lock.progress !== null;
        },

        /**
         * Progress percentage (0-100)
         */
        mcpProgressPercent() {
            if (!this.mcpHasProgress) return 0;
            return Math.min(100, Math.max(0, this.mcpStatus.activeLock.progress || 0));
        },

        /**
         * Check if current operation is deploy (rainbow) or render (gray)
         */
        mcpIsDeployOperation() {
            const lock = this.mcpStatus.activeLock;
            return lock && lock.operation === 'deploy_site';
        },

        /**
         * Check if there's any active lock (for fast polling)
         */
        mcpHasActiveLock() {
            const lock = this.mcpStatus.activeLock;
            return lock && !lock.isCompleted;
        },

        /**
         * Check if MCP integration is enabled
         */
        mcpEnabled() {
            return this.$store?.state?.app?.config?.experimentalMcpIntegration || false;
        },

        /**
         * MCP menu item object (or null if disabled)
         */
        mcpMenuItem() {
            if (!this.mcpEnabled) {
                return null;
            }
            return {
                icon: 'mcp',
                label: 'MCP',
                url: '/site/' + this.$route.params.name + '/mcp/',
                isMcp: true
            };
        }
    },

    methods: {
        /**
         * Check MCP CLI status via IPC
         */
        checkMcpStatus() {
            if (!this.mcpEnabled) {
                return;
            }
            mainProcessAPI.send('app-mcp-cli-status');
            mainProcessAPI.receiveOnce('app-mcp-cli-status-result', (status) => {
                this.mcpStatus = status;

                // Start fast polling when ANY active lock is detected (not just progress)
                // This ensures we catch fast operations like render
                if (this.mcpHasActiveLock && !this.mcpFastPollInterval) {
                    this.startFastPolling();
                }
                // Stop fast polling when no more active lock
                if (!this.mcpHasActiveLock && this.mcpFastPollInterval) {
                    this.stopFastPolling();
                }
            });
        },

        /**
         * Start polling MCP status (normal speed)
         */
        startMcpPolling() {
            if (this.mcpEnabled) {
                this.checkMcpStatus();
                this.mcpPollInterval = setInterval(() => {
                    this.checkMcpStatus();
                }, 5000);
            }
        },

        /**
         * Stop polling MCP status
         */
        stopMcpPolling() {
            if (this.mcpPollInterval) {
                clearInterval(this.mcpPollInterval);
                this.mcpPollInterval = null;
            }
            this.stopFastPolling();
        },

        /**
         * Start fast polling during active operations (every 250ms)
         */
        startFastPolling() {
            if (this.mcpFastPollInterval) return;
            this.mcpFastPollInterval = setInterval(() => {
                this.checkMcpStatus();
            }, 250);
        },

        /**
         * Stop fast polling
         */
        stopFastPolling() {
            if (this.mcpFastPollInterval) {
                clearInterval(this.mcpFastPollInterval);
                this.mcpFastPollInterval = null;
            }
        }
    }
};
