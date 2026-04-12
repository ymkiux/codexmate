export function createMainTabsComputed() {
    return {
        mainTabKicker() {
            if (this.mainTab === 'config') return 'Configuration';
            if (this.mainTab === 'sessions') return 'Sessions';
            if (this.mainTab === 'usage') return 'Usage';
            if (this.mainTab === 'orchestration') return 'Tasks';
            if (this.mainTab === 'market') return 'Skills';
            if (this.mainTab === 'docs') return 'Docs';
            return 'Settings';
        },
        mainTabTitle() {
            if (this.mainTab === 'config') return '本地配置控制台';
            if (this.mainTab === 'sessions') return '会话与导出';
            if (this.mainTab === 'usage') return '本地用量与趋势';
            if (this.mainTab === 'orchestration') return '任务编排';
            if (this.mainTab === 'market') return 'Skills 安装与同步';
            if (this.mainTab === 'docs') return 'CLI 安装与文档';
            return '系统与数据设置';
        },
        mainTabSubtitle() {
            if (this.mainTab === 'config') return '管理本地配置与模型。';
            if (this.mainTab === 'sessions') return '浏览与导出会话。';
            if (this.mainTab === 'usage') return '查看近 7 / 30 天用量。';
            if (this.mainTab === 'orchestration') return '规划、排队、执行与回看本地任务。';
            if (this.mainTab === 'market') return '管理本地 Skills。';
            if (this.mainTab === 'docs') return '查看 CLI 安装命令与排障。';
            return '管理下载、目录与回收站。';
        },
        taskOrchestrationSelectedRun() {
            return this.taskOrchestration && this.taskOrchestration.selectedRunDetail
                ? this.taskOrchestration.selectedRunDetail
                : null;
        },
        taskOrchestrationSelectedRunNodes() {
            const detail = this.taskOrchestrationSelectedRun;
            const run = detail && detail.run && typeof detail.run === 'object' ? detail.run : {};
            return Array.isArray(run.nodes) ? run.nodes : [];
        },
        taskOrchestrationQueueStats() {
            const queue = this.taskOrchestration && Array.isArray(this.taskOrchestration.queue)
                ? this.taskOrchestration.queue
                : [];
            return {
                queued: queue.filter((item) => String(item && item.status || '').trim().toLowerCase() === 'queued').length,
                running: queue.filter((item) => String(item && item.status || '').trim().toLowerCase() === 'running').length,
                failed: queue.filter((item) => String(item && item.status || '').trim().toLowerCase() === 'failed').length
            };
        }
    };
}
