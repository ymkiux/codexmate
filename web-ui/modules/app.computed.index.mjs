import { createDashboardComputed } from './app.computed.dashboard.mjs';
import { createSessionComputed } from './app.computed.session.mjs';
import { createConfigModeComputed } from './config-mode.computed.mjs';
import { createSkillsComputed } from './skills.computed.mjs';

export function createAppComputed() {
    return {
        ...createSessionComputed(),
        ...createDashboardComputed(),
        ...createSkillsComputed(),
        ...createConfigModeComputed()
    };
}
