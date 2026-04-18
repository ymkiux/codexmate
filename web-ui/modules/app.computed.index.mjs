import { createDashboardComputed } from './app.computed.dashboard.mjs';
import { createMainTabsComputed } from './app.computed.main-tabs.mjs';
import { createSessionComputed } from './app.computed.session.mjs';
import { createConfigModeComputed } from './config-mode.computed.mjs';
import { createSkillsComputed } from './skills.computed.mjs';
import { createPluginsComputed } from './plugins.computed.mjs';

export function createAppComputed() {
    return {
        ...createSessionComputed(),
        ...createDashboardComputed(),
        ...createMainTabsComputed(),
        ...createSkillsComputed(),
        ...createPluginsComputed(),
        ...createConfigModeComputed()
    };
}
