<template>
    <section class="content mcp-activity">
        <p-header :title="$t('mcp.mcpActivity')">
            <p-button
                :onClick="refreshStatus"
                slot="buttons"
                type="outline icon"
                icon="refresh"
                :disabled="isRefreshing">
                {{ $t('ui.refresh') }}
            </p-button>
        </p-header>

        <!-- Summary Card -->
        <div class="mcp-status-card">
            <div class="mcp-status-header">
                <span :class="['mcp-status-indicator', summaryStatusClass]"></span>
                <h3>{{ summaryStatusText }}</h3>
            </div>

            <div v-if="hasClients" class="mcp-summary-stats">
                <div class="mcp-detail">
                    <span class="label">{{ $t('mcp.connectedClients') }}:</span>
                    <span class="value">{{ activeClientCount }}</span>
                </div>
                <div class="mcp-detail">
                    <span class="label">{{ $t('mcp.totalToolCalls') }}:</span>
                    <span class="value">{{ mcpStatus.totalToolCalls || 0 }}</span>
                </div>
            </div>
        </div>

        <!-- Connected Clients List -->
        <div v-if="hasClients" class="mcp-clients-section">
            <h3>{{ $t('mcp.connectedClientsTitle') }}</h3>

            <div class="mcp-clients-grid">
                <div
                    v-for="client in mcpStatus.clients"
                    :key="client.sessionId"
                    :class="['mcp-client-card', getClientStatusClass(client)]">
                    <div class="mcp-client-header">
                        <span :class="['mcp-status-indicator', getClientStatusClass(client)]"></span>
                        <span class="mcp-client-name">{{ client.clientName || $t('mcp.unknownClient') }}</span>
                    </div>
                    <div class="mcp-client-details">
                        <div class="mcp-client-detail">
                            <span class="label">{{ $t('mcp.status') }}:</span>
                            <span class="value">{{ getClientStatusText(client) }}</span>
                        </div>
                        <div class="mcp-client-detail">
                            <span class="label">{{ $t('mcp.toolCalls') }}:</span>
                            <span class="value">{{ client.toolCalls || 0 }}</span>
                        </div>
                        <div class="mcp-client-detail">
                            <span class="label">{{ $t('mcp.lastActivity') }}:</span>
                            <span class="value">{{ getLastActivityText(client) }}</span>
                        </div>
                        <div class="mcp-client-detail">
                            <span class="label">{{ $t('mcp.processId') }}:</span>
                            <span class="value">{{ client.pid || '-' }}</span>
                        </div>
                        <div class="mcp-client-detail">
                            <span class="label">{{ $t('mcp.startedAt') }}:</span>
                            <span class="value">{{ getStartedAtText(client) }}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- No Clients Connected -->
        <div v-else class="mcp-status-card">
            <div class="mcp-not-connected">
                <p v-if="hasActivityLog">{{ $t('mcp.noClientsCurrentlyActive') }}</p>
                <p v-else>{{ $t('mcp.notConnectedMessage') }}</p>
            </div>
        </div>

        <!-- MCP Configuration (always visible) -->
        <div class="mcp-status-card">
            <h3>{{ $t('mcp.configurationTitle') }}</h3>
            <p class="mcp-config-intro">{{ $t('mcp.setupInstructionsIntro') }}</p>
            <div class="mcp-code-block">
                <pre ref="mcpConfig">{{ mcpConfigJson }}</pre>
                <button
                    class="mcp-copy-btn"
                    @click="copyMcpConfig"
                    :title="$t('mcp.copyConfig')">
                    <icon name="duplicate" size="s" />
                </button>
            </div>
            <p class="mcp-copy-status" v-if="copyStatus">{{ copyStatus }}</p>
        </div>

        <!-- Activity Log -->
        <div class="mcp-activity-log-section">
            <div class="mcp-activity-log-header">
                <h3>{{ $t('mcp.activityLog') }}</h3>
                <p-button
                    v-if="hasActivityLog"
                    :onClick="clearActivityLog"
                    type="outline small"
                    :disabled="isClearingLog">
                    {{ $t('mcp.clearLog') }}
                </p-button>
            </div>

            <div v-if="hasActivityLog" class="mcp-activity-log">
                <div
                    v-for="(entry, index) in mcpStatus.activityLog"
                    :key="index"
                    class="mcp-log-entry">
                    <span class="mcp-log-time">{{ formatLogTime(entry.timestamp) }}</span>
                    <span class="mcp-log-client">{{ entry.clientName }}</span>
                    <span class="mcp-log-summary">{{ entry.summary }}</span>
                </div>
            </div>
            <div v-else class="mcp-no-activity">
                <p>{{ $t('mcp.noActivityYet') }}</p>
            </div>
        </div>

        <!-- About MCP Card -->
        <div class="mcp-info-card">
            <h3>{{ $t('mcp.aboutMcp') }}</h3>
            <p>{{ $t('mcp.aboutMcpDescription') }}</p>
            <ul>
                <li>{{ $t('mcp.featureCreatePosts') }}</li>
                <li>{{ $t('mcp.featureManageTags') }}</li>
                <li>{{ $t('mcp.featureUploadMedia') }}</li>
                <li>{{ $t('mcp.featureManageMenus') }}</li>
            </ul>
        </div>
    </section>
</template>

<script>
export default {
    name: 'mcp-activity',
    data() {
        return {
            mcpStatus: {
                active: false,
                clients: [],
                totalToolCalls: 0,
                activityLog: [],
                // Legacy fields
                pid: null,
                startedAt: null,
                lastActivity: null,
                toolCalls: 0,
                isStale: true,
                processRunning: false
            },
            isRefreshing: false,
            isClearingLog: false,
            pollInterval: null,
            copyStatus: ''
        };
    },
    computed: {
        hasClients() {
            return this.mcpStatus.clients && this.mcpStatus.clients.length > 0;
        },
        hasActivityLog() {
            return this.mcpStatus.activityLog && this.mcpStatus.activityLog.length > 0;
        },
        mcpConfigJson() {
            // Get the actual path to the MCP CLI from the store
            const cliPath = this.$store.state.mcpCliPath || '/path/to/Publii/app/back-end/mcp/cli.js';
            const config = {
                "publii": {
                    "command": "node",
                    "args": [cliPath]
                }
            };
            return JSON.stringify(config, null, 2);
        },
        activeClientCount() {
            if (!this.mcpStatus.clients) return 0;
            return this.mcpStatus.clients.filter(c => c.processRunning).length;
        },
        summaryStatusClass() {
            if (this.activeClientCount > 0) {
                const hasActiveClient = this.mcpStatus.clients.some(c => c.processRunning && !c.isStale);
                return hasActiveClient ? 'mcp-active' : 'mcp-idle';
            }
            return 'mcp-inactive';
        },
        summaryStatusText() {
            if (this.activeClientCount === 0) {
                return this.$t('mcp.statusNoClients');
            }
            if (this.activeClientCount === 1) {
                const client = this.mcpStatus.clients.find(c => c.processRunning);
                if (client && !client.isStale) {
                    return this.$t('mcp.statusOneClientActive');
                }
                return this.$t('mcp.statusOneClientIdle');
            }
            return this.$t('mcp.statusMultipleClients', { count: this.activeClientCount });
        }
    },
    methods: {
        getClientStatusClass(client) {
            if (client.processRunning && !client.isStale) {
                return 'mcp-active';
            } else if (client.processRunning && client.isStale) {
                return 'mcp-idle';
            }
            return 'mcp-inactive';
        },
        getClientStatusText(client) {
            if (client.processRunning && !client.isStale) {
                return this.$t('mcp.clientActive');
            } else if (client.processRunning && client.isStale) {
                return this.$t('mcp.clientIdle');
            }
            return this.$t('mcp.clientDisconnected');
        },
        getLastActivityText(client) {
            if (!client.lastActivity) {
                return '-';
            }
            const seconds = client.secondsSinceActivity || 0;
            if (seconds < 60) {
                return `${seconds} ${this.$t('mcp.secondsAgo')}`;
            } else if (seconds < 3600) {
                return `${Math.floor(seconds / 60)} ${this.$t('mcp.minutesAgo')}`;
            }
            return this.$moment(client.lastActivity).format('HH:mm:ss');
        },
        getStartedAtText(client) {
            if (!client.startedAt) {
                return '-';
            }
            return this.$moment(client.startedAt).format('HH:mm:ss');
        },
        formatLogTime(timestamp) {
            if (!timestamp) return '-';
            return this.$moment(timestamp).format('HH:mm:ss');
        },
        checkStatus() {
            mainProcessAPI.send('app-mcp-cli-status');
            mainProcessAPI.receiveOnce('app-mcp-cli-status-result', (status) => {
                this.mcpStatus = status;
                this.isRefreshing = false;
            });
        },
        refreshStatus() {
            this.isRefreshing = true;
            this.checkStatus();
        },
        clearActivityLog() {
            this.isClearingLog = true;
            mainProcessAPI.send('app-mcp-clear-activity-log');
            mainProcessAPI.receiveOnce('app-mcp-activity-log-cleared', (result) => {
                this.isClearingLog = false;
                if (result.success) {
                    this.mcpStatus.activityLog = [];
                }
            });
        },
        async copyMcpConfig() {
            try {
                await navigator.clipboard.writeText(this.mcpConfigJson);
                this.copyStatus = this.$t('mcp.configCopied');
                setTimeout(() => {
                    this.copyStatus = '';
                }, 2000);
            } catch (err) {
                this.copyStatus = this.$t('mcp.copyFailed');
                setTimeout(() => {
                    this.copyStatus = '';
                }, 2000);
            }
        }
    },
    mounted() {
        this.checkStatus();
        this.pollInterval = setInterval(() => {
            this.checkStatus();
        }, 5000);
    },
    beforeDestroy() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
        }
    }
};
</script>

<style lang="scss" scoped>
@import '../scss/variables.scss';

.mcp-activity {
    padding: 4rem;
}

.mcp-status-card,
.mcp-info-card {
    background: var(--bg-secondary);
    border-radius: var(--border-radius);
    margin-bottom: 2rem;
    padding: 2rem;
}

.mcp-status-header {
    align-items: center;
    display: flex;
    gap: 1rem;
    margin-bottom: 1.5rem;

    h3 {
        margin: 0;
    }
}

.mcp-status-indicator {
    border-radius: 50%;
    flex-shrink: 0;
    height: 14px;
    width: 14px;

    &.mcp-active {
        background: #4ade80;
        box-shadow: 0 0 8px #4ade80;
        animation: pulse-green 2s infinite;
    }

    &.mcp-idle {
        background: #fbbf24;
    }

    &.mcp-inactive {
        background: #6b7280;
    }
}

.mcp-summary-stats {
    display: flex;
    gap: 3rem;
}

.mcp-clients-section {
    margin-bottom: 2rem;

    h3 {
        margin: 0 0 1.5rem;
    }
}

.mcp-clients-grid {
    display: grid;
    gap: 1.5rem;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
}

.mcp-client-card {
    background: var(--bg-secondary);
    border-radius: var(--border-radius);
    padding: 1.5rem;
    border-left: 4px solid #6b7280;

    &.mcp-active {
        border-left-color: #4ade80;
    }

    &.mcp-idle {
        border-left-color: #fbbf24;
    }
}

.mcp-client-header {
    align-items: center;
    display: flex;
    gap: 0.75rem;
    margin-bottom: 1rem;

    .mcp-client-name {
        font-size: 1.4rem;
        font-weight: var(--font-weight-semibold);
    }
}

.mcp-client-details {
    display: grid;
    gap: 0.5rem;
}

.mcp-client-detail,
.mcp-detail {
    .label {
        color: var(--text-light-color);
        display: inline-block;
        font-size: 1.2rem;
        margin-right: 0.5rem;
    }

    .value {
        font-size: 1.3rem;
        font-weight: var(--font-weight-semibold);
    }
}

.mcp-not-connected {
    color: var(--text-light-color);

    p {
        margin: 0 0 1rem;
    }
}

.mcp-help-text {
    background: var(--bg-primary);
    border-left: 3px solid var(--color-primary);
    font-size: 1.2rem;
    padding: 1rem;

    code {
        background: var(--bg-secondary);
        border-radius: 3px;
        padding: 0.2rem 0.4rem;
    }
}

.mcp-setup-instructions {
    p {
        color: var(--text-light-color);
        margin: 0 0 1rem;
    }
}

.mcp-config-intro {
    color: var(--text-light-color);
    margin: 0 0 1rem !important;
}

.mcp-code-block {
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius);
    position: relative;
    margin-bottom: 0.5rem;

    pre {
        font-family: monospace;
        font-size: 1.2rem;
        margin: 0;
        overflow-x: auto;
        padding: 1rem;
        padding-right: 4rem;
        white-space: pre-wrap;
        word-break: break-all;
    }

    .mcp-copy-btn {
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius);
        cursor: pointer;
        padding: 0.5rem;
        position: absolute;
        right: 0.5rem;
        top: 0.5rem;
        transition: background 0.2s;

        &:hover {
            background: var(--color-primary);
            border-color: var(--color-primary);
            color: white;
        }
    }
}

.mcp-copy-status {
    color: var(--color-primary);
    font-size: 1.2rem;
    margin: 0;
}

/* Activity Log Styles */
.mcp-activity-log-section {
    background: var(--bg-secondary);
    border-radius: var(--border-radius);
    margin-bottom: 2rem;
    padding: 2rem;
}

.mcp-activity-log-header {
    align-items: center;
    display: flex;
    justify-content: space-between;
    margin-bottom: 1.5rem;

    h3 {
        margin: 0;
    }
}

.mcp-activity-log {
    background: var(--bg-primary);
    border-radius: var(--border-radius);
    font-family: monospace;
    font-size: 1.2rem;
    max-height: 400px;
    overflow-y: auto;
    padding: 1rem;
}

.mcp-log-entry {
    border-bottom: 1px solid var(--border-color);
    display: flex;
    gap: 1rem;
    padding: 0.5rem 0;

    &:last-child {
        border-bottom: none;
    }
}

.mcp-log-time {
    color: var(--text-light-color);
    flex-shrink: 0;
    width: 70px;
}

.mcp-log-client {
    color: var(--color-primary);
    flex-shrink: 0;
    font-weight: var(--font-weight-semibold);
    width: 120px;
}

.mcp-log-summary {
    color: var(--text-primary-color);
    flex: 1;
}

.mcp-no-activity {
    color: var(--text-light-color);
    font-style: italic;

    p {
        margin: 0;
    }
}

.mcp-info-card {
    h3 {
        margin: 0 0 1rem;
    }

    p {
        color: var(--text-light-color);
        margin: 0 0 1rem;
    }

    ul {
        color: var(--text-light-color);
        margin: 0;
        padding-left: 2rem;

        li {
            margin-bottom: 0.5rem;
        }
    }
}

@keyframes pulse-green {
    0%, 100% {
        box-shadow: 0 0 8px #4ade80;
    }
    50% {
        box-shadow: 0 0 16px #4ade80;
    }
}
</style>
