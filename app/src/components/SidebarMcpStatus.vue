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
        <!-- Progress bar for render/deploy operations -->
        <div v-if="hasProgress" class="mcp-progress">
            <div class="mcp-progress-bar">
                <div
                    class="mcp-progress-fill"
                    :style="{ width: progressPercent + '%' }">
                </div>
            </div>
            <span class="mcp-progress-text">{{ progressText }}</span>
        </div>
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
                processRunning: false,
                activeLock: null
            },
            showDetails: false,
            pollInterval: null,
            fastPollInterval: null
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
        isLocked() {
            return this.mcpStatus.activeLock !== null && this.mcpStatus.activeLock !== undefined;
        },
        isLockCompleted() {
            return this.isLocked && this.mcpStatus.activeLock.isCompleted;
        },
        hasProgress() {
            // Show progress bar when there's an active lock with progress data
            return this.isLocked &&
                   !this.isLockCompleted &&
                   this.mcpStatus.activeLock.progress !== undefined &&
                   this.mcpStatus.activeLock.progress !== null;
        },
        progressPercent() {
            if (!this.hasProgress) return 0;
            return Math.min(100, Math.max(0, this.mcpStatus.activeLock.progress || 0));
        },
        progressText() {
            if (!this.hasProgress) return '';
            const lock = this.mcpStatus.activeLock;
            // Show message if available, otherwise just percentage
            if (lock.message) {
                return `${lock.progress}% - ${lock.message}`;
            }
            return `${lock.progress}%`;
        },
        statusClasses() {
            return {
                'mcp-status': true,
                'mcp-status-completed': this.isLockCompleted,
                'mcp-status-locked': this.isLocked && !this.isLockCompleted,
                'mcp-status-active': this.isActive && !this.isLocked,
                'mcp-status-idle': this.mcpStatus.active && this.mcpStatus.isStale && !this.isLocked,
                'mcp-status-inactive': !this.mcpStatus.active && !this.isLocked
            };
        },
        statusTitle() {
            if (this.isLockCompleted) {
                const lock = this.mcpStatus.activeLock;
                return `MCP completed: ${lock.operation} on ${lock.site} (${lock.duration || 0}ms)`;
            }
            if (this.isLocked) {
                const lock = this.mcpStatus.activeLock;
                return `MCP writing: ${lock.operation} on ${lock.site}`;
            }
            if (this.isActive) {
                return this.$t('mcp.statusActive');
            } else if (this.mcpStatus.active && this.mcpStatus.isStale) {
                return this.$t('mcp.statusIdle');
            }
            return this.$t('mcp.statusInactive');
        },
        statusDetails() {
            if (this.isLockCompleted) {
                const lock = this.mcpStatus.activeLock;
                return `✓ ${lock.operation}`;
            }
            if (this.isLocked) {
                const lock = this.mcpStatus.activeLock;
                return `${lock.operation}...`;
            }
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
                const hadLock = this.isLocked;
                this.mcpStatus = status;

                // Start fast polling when lock is detected
                if (this.isLocked && !this.fastPollInterval) {
                    this.startFastPolling();
                }
                // Stop fast polling when no lock activity
                if (!this.isLocked && this.fastPollInterval) {
                    this.stopFastPolling();
                }
            });
        },
        startFastPolling() {
            if (this.fastPollInterval) return;
            // Poll every 500ms during lock activity
            this.fastPollInterval = setInterval(() => {
                this.checkStatus();
            }, 500);
        },
        stopFastPolling() {
            if (this.fastPollInterval) {
                clearInterval(this.fastPollInterval);
                this.fastPollInterval = null;
            }
        },
        toggleDetails() {
            this.showDetails = !this.showDetails;
        }
    },
    mounted() {
        // Check status immediately
        this.checkStatus();

        // Poll every 2 seconds (faster to catch locks)
        this.pollInterval = setInterval(() => {
            this.checkStatus();
        }, 2000);
    },
    beforeDestroy() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
        }
        this.stopFastPolling();
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

    &-locked {
        .mcp-status-dot {
            background: #ef4444;
            box-shadow: 0 0 6px #ef4444;
            animation: pulse-red 0.5s infinite;
        }
        .mcp-status-text {
            color: #fca5a5;
        }
    }

    &-completed {
        .mcp-status-dot {
            background: #22c55e;
            box-shadow: 0 0 8px #22c55e;
            animation: pulse-complete 0.3s ease-out;
        }
        .mcp-status-text {
            color: #86efac;
        }
        .mcp-status-details {
            color: #86efac;
        }
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

.mcp-progress {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-left: 8px;
    min-width: 80px;
    max-width: 150px;

    &-bar {
        height: 4px;
        background: rgba(255, 255, 255, 0.2);
        border-radius: 2px;
        overflow: hidden;
    }

    &-fill {
        height: 100%;
        background: linear-gradient(90deg, #ef4444, #f97316);
        border-radius: 2px;
        transition: width 0.3s ease;
    }

    &-text {
        font-size: 0.9rem;
        color: rgba(255, 255, 255, 0.7);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
}

@keyframes pulse-red {
    0%, 100% {
        box-shadow: 0 0 6px #ef4444;
    }
    50% {
        box-shadow: 0 0 12px #ef4444;
    }
}

@keyframes pulse-complete {
    0% {
        transform: scale(1);
        box-shadow: 0 0 4px #22c55e;
    }
    50% {
        transform: scale(1.3);
        box-shadow: 0 0 12px #22c55e;
    }
    100% {
        transform: scale(1);
        box-shadow: 0 0 8px #22c55e;
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
