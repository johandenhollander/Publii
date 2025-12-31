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

        <div class="mcp-status-card">
            <div class="mcp-status-header">
                <span :class="['mcp-status-indicator', statusClass]"></span>
                <h3>{{ statusText }}</h3>
            </div>

            <div v-if="mcpStatus.active" class="mcp-status-details">
                <div class="mcp-detail">
                    <span class="label">{{ $t('mcp.toolCalls') }}:</span>
                    <span class="value">{{ mcpStatus.toolCalls || 0 }}</span>
                </div>
                <div class="mcp-detail">
                    <span class="label">{{ $t('mcp.lastActivity') }}:</span>
                    <span class="value">{{ lastActivityText }}</span>
                </div>
                <div class="mcp-detail">
                    <span class="label">{{ $t('mcp.processId') }}:</span>
                    <span class="value">{{ mcpStatus.pid || '-' }}</span>
                </div>
                <div class="mcp-detail">
                    <span class="label">{{ $t('mcp.startedAt') }}:</span>
                    <span class="value">{{ startedAtText }}</span>
                </div>
            </div>

            <div v-else class="mcp-not-connected">
                <p>{{ $t('mcp.notConnectedMessage') }}</p>
                <p class="mcp-help-text" v-pure-html="$t('mcp.setupInstructions')"></p>
            </div>
        </div>

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
                pid: null,
                startedAt: null,
                lastActivity: null,
                toolCalls: 0,
                isStale: true,
                processRunning: false
            },
            isRefreshing: false,
            pollInterval: null
        };
    },
    computed: {
        statusClass() {
            if (this.mcpStatus.active && this.mcpStatus.processRunning && !this.mcpStatus.isStale) {
                return 'mcp-active';
            } else if (this.mcpStatus.active && this.mcpStatus.isStale) {
                return 'mcp-idle';
            }
            return 'mcp-inactive';
        },
        statusText() {
            if (this.mcpStatus.active && this.mcpStatus.processRunning && !this.mcpStatus.isStale) {
                return this.$t('mcp.statusActiveText');
            } else if (this.mcpStatus.active && this.mcpStatus.isStale) {
                return this.$t('mcp.statusIdleText');
            }
            return this.$t('mcp.statusInactiveText');
        },
        lastActivityText() {
            if (!this.mcpStatus.lastActivity) {
                return '-';
            }
            const seconds = this.mcpStatus.secondsSinceActivity || 0;
            if (seconds < 60) {
                return `${seconds} ${this.$t('mcp.secondsAgo')}`;
            } else if (seconds < 3600) {
                return `${Math.floor(seconds / 60)} ${this.$t('mcp.minutesAgo')}`;
            }
            return this.$moment(this.mcpStatus.lastActivity).format('HH:mm:ss');
        },
        startedAtText() {
            if (!this.mcpStatus.startedAt) {
                return '-';
            }
            return this.$moment(this.mcpStatus.startedAt).format('HH:mm:ss');
        }
    },
    methods: {
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

.mcp-status-details {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
}

.mcp-detail {
    .label {
        color: var(--text-light-color);
        display: block;
        font-size: 1.2rem;
        margin-bottom: 0.3rem;
    }

    .value {
        font-size: 1.4rem;
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
