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
                processRunning: false
            },
            mcpPollInterval: null
        };
    },

    computed: {
        /**
         * CSS class for MCP status indicator
         */
        mcpStatusClass() {
            if (this.mcpStatus.active && this.mcpStatus.processRunning && !this.mcpStatus.isStale) {
                return 'mcp-active';
            } else if (this.mcpStatus.active && this.mcpStatus.isStale) {
                return 'mcp-idle';
            }
            return 'mcp-inactive';
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
            });
        },

        /**
         * Start polling MCP status
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
        }
    }
};
