export function isSessionQueryEnabled(source) {
    const normalized = normalizeSessionSource(source, '');
    return normalized === 'codex' || normalized === 'claude' || normalized === 'all';
}

export function normalizeSessionSource(source, fallback = 'all') {
    const normalized = typeof source === 'string'
        ? source.trim().toLowerCase()
        : '';
    if (normalized === 'codex' || normalized === 'claude' || normalized === 'all') {
        return normalized;
    }
    return fallback;
}

export function normalizeSessionPathFilter(pathFilter) {
    return typeof pathFilter === 'string' ? pathFilter.trim() : '';
}

export function buildSessionFilterCacheState(source, pathFilter) {
    return {
        source: normalizeSessionSource(source, 'all'),
        pathFilter: normalizeSessionPathFilter(pathFilter)
    };
}

export function buildSessionListParams(options = {}) {
    const {
        source = 'all',
        pathFilter = '',
        query = '',
        roleFilter = 'all',
        timeRangePreset = 'all',
        limit = 200
    } = options;
    const queryValue = isSessionQueryEnabled(source) ? query : '';
    return {
        source,
        pathFilter,
        query: queryValue,
        queryMode: 'and',
        queryScope: 'content',
        contentScanLimit: 50,
        roleFilter,
        timeRangePreset,
        limit,
        forceRefresh: true
    };
}

export function normalizeSessionMessageRole(role) {
    const value = typeof role === 'string' ? role.trim().toLowerCase() : '';
    if (value === 'user' || value === 'assistant' || value === 'system') {
        return value;
    }
    return 'assistant';
}

function toRoleMeta(role) {
    if (role === 'user') {
        return { role: 'user', roleLabel: 'User', roleShort: 'U' };
    }
    if (role === 'assistant') {
        return { role: 'assistant', roleLabel: 'Assistant', roleShort: 'A' };
    }
    if (role === 'system') {
        return { role: 'system', roleLabel: 'System', roleShort: 'S' };
    }
    return { role: 'mixed', roleLabel: 'Mixed', roleShort: 'M' };
}

function clampTimelinePercent(percent) {
    return Math.max(6, Math.min(94, percent));
}

export function formatSessionTimelineTimestamp(timestamp) {
    const value = typeof timestamp === 'string' ? timestamp.trim() : '';
    if (!value) return '';

    const matched = value.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (matched) {
        const second = matched[6] || '00';
        return `${matched[2]}-${matched[3]} ${matched[4]}:${matched[5]}:${second}`;
    }

    return value;
}

export function buildSessionTimelineNodes(messages = [], options = {}) {
    const list = Array.isArray(messages) ? messages : [];
    const getKey = typeof options.getKey === 'function'
        ? options.getKey
        : ((_message, index) => `msg-${index}`);
    const total = list.length;
    const rawMaxMarkers = Number(options.maxMarkers);
    const maxMarkers = Number.isFinite(rawMaxMarkers)
        ? Math.max(1, Math.min(80, Math.floor(rawMaxMarkers)))
        : 30;

    const buildSingleNode = (message, index) => {
        const role = normalizeSessionMessageRole(message && (message.normalizedRole || message.role));
        const roleMeta = toRoleMeta(role);
        const key = String(getKey(message, index) || `msg-${index}`);
        const displayTime = formatSessionTimelineTimestamp(message && message.timestamp ? message.timestamp : '');
        const title = displayTime
            ? `#${index + 1} · ${roleMeta.roleLabel} · ${displayTime}`
            : `#${index + 1} · ${roleMeta.roleLabel}`;
        const percent = total <= 1 ? 0 : (index / (total - 1)) * 100;
        return {
            key,
            role: roleMeta.role,
            roleLabel: roleMeta.roleLabel,
            roleShort: roleMeta.roleShort,
            displayTime,
            title,
            percent,
            safePercent: clampTimelinePercent(percent)
        };
    };

    if (total <= maxMarkers) {
        return list.map((message, index) => buildSingleNode(message, index));
    }

    const nodes = [];
    const bucketWidth = total / maxMarkers;
    for (let bucket = 0; bucket < maxMarkers; bucket += 1) {
        let start = Math.floor(bucket * bucketWidth);
        if (nodes.length && start <= nodes[nodes.length - 1].endIndex) {
            start = nodes[nodes.length - 1].endIndex + 1;
        }
        if (start >= total) {
            break;
        }
        let end = Math.floor((bucket + 1) * bucketWidth) - 1;
        end = Math.max(start, Math.min(total - 1, end));
        const targetIndex = Math.min(total - 1, start + Math.floor((end - start) / 2));
        const targetMessage = list[targetIndex] || null;
        const key = String(getKey(targetMessage, targetIndex) || `msg-${targetIndex}`);
        const percent = total <= 1 ? 0 : (targetIndex / (total - 1)) * 100;
        const messagesInGroup = end - start + 1;
        const roleSet = new Set();
        for (let i = start; i <= end; i += 1) {
            roleSet.add(normalizeSessionMessageRole(list[i] && (list[i].normalizedRole || list[i].role)));
        }
        const roleValue = roleSet.size === 1 ? Array.from(roleSet)[0] : 'mixed';
        const roleMeta = toRoleMeta(roleValue);
        const firstTime = formatSessionTimelineTimestamp(list[start] && list[start].timestamp ? list[start].timestamp : '');
        const lastTime = formatSessionTimelineTimestamp(list[end] && list[end].timestamp ? list[end].timestamp : '');
        let displayTime = '';
        if (firstTime && lastTime) {
            displayTime = firstTime === lastTime ? firstTime : `${firstTime} ~ ${lastTime}`;
        } else {
            displayTime = firstTime || lastTime;
        }
        const titleBase = `#${start + 1}-${end + 1} · ${messagesInGroup} msgs · ${roleMeta.roleLabel}`;
        const title = displayTime ? `${titleBase} · ${displayTime}` : titleBase;
        nodes.push({
            key,
            role: roleMeta.role,
            roleLabel: roleMeta.roleLabel,
            roleShort: roleMeta.roleShort,
            displayTime,
            title,
            percent,
            safePercent: clampTimelinePercent(percent),
            startIndex: start,
            endIndex: end,
            messageCount: messagesInGroup
        });
    }
    return nodes;
}
