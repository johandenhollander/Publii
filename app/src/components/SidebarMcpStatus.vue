<template>
    <div
        :class="statusClasses"
        :title="statusTitle"
        @click="toggleDetails">
        <span class="mcp-status-dot"></span>
        <span class="mcp-status-text">MCP</span>
        <span v-if="showDetails && statusDetails" class="mcp-status-details">
            {{ statusDetails }}
        </span>
    </div>
</template>

<script>
export default {
    name: 'sidebar-mcp-status',
    data() {
        return {
            mcpStatus: {
                active: false,
                toolCalls: 0,
                lastActivity: null,
                isStale: true,
                processRunning: false
            },
            showDetails: false,
            pollInterval: null
        };
    },
    computed: {
        showIndicator() {
            // Show if MCP was ever active or is currently active
            return this.mcpStatus.active || this.mcpStatus.toolCalls > 0;
        },
        isActive() {
            return this.mcpStatus.active && this.mcpStatus.processRunning && !this.mcpStatus.isStale;
        },
        statusClasses() {
            return {
                'mcp-status': true,
                'mcp-status-active': this.isActive,
                'mcp-status-idle': this.mcpStatus.active && this.mcpStatus.isStale,
                'mcp-status-inactive': !this.mcpStatus.active
            };
        },
        statusTitle() {
            if (this.isActive) {
                return this.$t('mcp.statusActive');
            } else if (this.mcpStatus.active && this.mcpStatus.isStale) {
                return this.$t('mcp.statusIdle');
            }
            return this.$t('mcp.statusInactive');
        },
        statusDetails() {
            if (!this.mcpStatus.lastActivity) {
                return '';
            }
            const secondsAgo = this.mcpStatus.secondsSinceActivity || 0;
            if (secondsAgo < 60) {
                return `${this.mcpStatus.toolCalls} calls, ${secondsAgo}s ago`;
            } else if (secondsAgo < 3600) {
                return `${this.mcpStatus.toolCalls} calls, ${Math.floor(secondsAgo / 60)}m ago`;
            }
            return `${this.mcpStatus.toolCalls} calls`;
        }
    },
    methods: {
        checkStatus() {
            mainProcessAPI.send('app-mcp-cli-status');
            mainProcessAPI.receiveOnce('app-mcp-cli-status-result', (status) => {
                this.mcpStatus = status;
            });
        },
        toggleDetails() {
            this.showDetails = !this.showDetails;
        }
    },
    mounted() {
        // Check status immediately
        this.checkStatus();

        // Poll every 5 seconds
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

.mcp-status {
    align-items: center;
    background: rgba(0, 0, 0, 0.15);
    border-radius: 3px;
    bottom: 24rem;
    color: var(--sidebar-link-color);
    cursor: pointer;
    display: flex;
    font-size: 1.1rem;
    gap: 0.5rem;
    left: $app-sidebar-margin;
    opacity: 0.8;
    padding: 0.4rem 0.8rem;
    position: absolute;
    transition: all 0.2s ease;
    z-index: 10;

    &:hover {
        opacity: 1;
        background: rgba(0, 0, 0, 0.3);
    }

    &-dot {
        border-radius: 50%;
        display: inline-block;
        height: 8px;
        width: 8px;
    }

    &-text {
        font-weight: 600;
        letter-spacing: 0.05em;
    }

    &-details {
        font-size: 1rem;
        opacity: 0.8;
    }

    &-active {
        .mcp-status-dot {
            background: #4ade80;
            box-shadow: 0 0 6px #4ade80;
            animation: pulse-green 2s infinite;
        }
    }

    &-idle {
        .mcp-status-dot {
            background: #fbbf24;
        }
    }

    &-inactive {
        .mcp-status-dot {
            background: #6b7280;
        }
    }
}

@keyframes pulse-green {
    0%, 100% {
        box-shadow: 0 0 6px #4ade80;
    }
    50% {
        box-shadow: 0 0 12px #4ade80;
    }
}
</style>
