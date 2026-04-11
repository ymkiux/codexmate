import { shouldForceCompactLayoutMode } from '../logic.mjs';

export function createSessionTimelineMethods() {
    const getSessionPreviewHeaderElement = (context, scrollEl = context.sessionPreviewScrollEl || context.$refs.sessionPreviewScroll) => {
        const container = context.sessionPreviewContainerEl || context.$refs.sessionPreviewContainer;
        return context.sessionPreviewHeaderEl
            || (scrollEl && typeof scrollEl.querySelector === 'function'
                ? scrollEl.querySelector('.session-preview-header')
                : null)
            || (container && typeof container.querySelector === 'function'
                ? container.querySelector('.session-preview-header')
                : null)
            || null;
    };

    const getSessionPreviewHeaderOffset = (context, scrollEl = context.sessionPreviewScrollEl || context.$refs.sessionPreviewScroll) => {
        const header = getSessionPreviewHeaderElement(context, scrollEl);
        const headerHeight = header && typeof header.getBoundingClientRect === 'function'
            ? Math.ceil(header.getBoundingClientRect().height)
            : 0;
        return headerHeight > 0 ? (headerHeight + 12) : 72;
    };

    return {
        hasRenderableSessionTimeline() {
            return !!(
                this.sessionTimelineEnabled
                && this.mainTab === 'sessions'
                && this.getMainTabForNav() === 'sessions'
                && this.sessionPreviewRenderEnabled
                && Array.isArray(this.sessionTimelineNodes)
                && this.sessionTimelineNodes.length
            );
        },
        setSessionPreviewContainerRef(el) {
            this.sessionPreviewContainerEl = el || null;
            this.updateSessionTimelineOffset();
        },
        disconnectSessionPreviewHeaderResizeObserver() {
            if (!this.sessionPreviewHeaderResizeObserver) return;
            this.sessionPreviewHeaderResizeObserver.disconnect();
            this.sessionPreviewHeaderResizeObserver = null;
        },
        observeSessionPreviewHeaderResize() {
            this.disconnectSessionPreviewHeaderResizeObserver();
        },
        setSessionPreviewHeaderRef(el) {
            this.disconnectSessionPreviewHeaderResizeObserver();
            this.sessionPreviewHeaderEl = el || null;
            this.observeSessionPreviewHeaderResize();
            this.updateSessionTimelineOffset();
        },
        setSessionPreviewScrollRef(el) {
            this.sessionPreviewScrollEl = el || null;
            this.invalidateSessionTimelineMeasurementCache();
            const shouldSync = !!(
                this.sessionPreviewScrollEl
                && this.mainTab === 'sessions'
                && this.getMainTabForNav() === 'sessions'
                && this.sessionPreviewRenderEnabled
                && this.sessionTimelineNodes.length
            );
            if (!shouldSync) {
                this.cancelSessionTimelineSync();
                this.updateSessionTimelineOffset();
                return;
            }
            const boundScrollEl = this.sessionPreviewScrollEl;
            this.$nextTick(() => {
                if (this.sessionPreviewScrollEl !== boundScrollEl) return;
                if (this.mainTab !== 'sessions' || !this.sessionPreviewRenderEnabled) return;
                if (!this.sessionTimelineNodes.length) return;
                this.scheduleSessionTimelineSync();
            });
            this.updateSessionTimelineOffset();
        },
        clearSessionTimelineRefs() {
            this.sessionMessageRefMap = Object.create(null);
            this.sessionMessageRefBinderMap = Object.create(null);
            this.sessionTimelineLastAnchorY = 0;
            this.sessionTimelineLastDirection = 0;
            this.invalidateSessionTimelineMeasurementCache(true);
        },
        ensureSessionTimelineMeasurementCache() {
            if (this.__sessionTimelineMeasurementCache) {
                return this.__sessionTimelineMeasurementCache;
            }
            this.__sessionTimelineMeasurementCache = {
                offsetByKey: Object.create(null),
                dirty: true
            };
            return this.__sessionTimelineMeasurementCache;
        },
        invalidateSessionTimelineMeasurementCache(resetOffset = false) {
            const cache = this.ensureSessionTimelineMeasurementCache();
            if (resetOffset) {
                cache.offsetByKey = Object.create(null);
            }
            cache.dirty = true;
        },
        refreshSessionTimelineMeasurementCache(nodes = null) {
            const cache = this.ensureSessionTimelineMeasurementCache();
            const nodeList = Array.isArray(nodes) ? nodes : (Array.isArray(this.sessionTimelineNodes) ? this.sessionTimelineNodes : []);
            if (!nodeList.length) {
                cache.offsetByKey = Object.create(null);
                cache.dirty = false;
                return cache.offsetByKey;
            }
            const scrollEl = this.sessionPreviewScrollEl || this.$refs.sessionPreviewScroll;
            const scrollRect = scrollEl && typeof scrollEl.getBoundingClientRect === 'function'
                ? scrollEl.getBoundingClientRect()
                : null;
            const scrollTop = scrollEl ? Number(scrollEl.scrollTop || 0) : 0;
            const nextOffsetByKey = Object.create(null);
            for (const node of nodeList) {
                if (!node || !node.key) continue;
                const messageEl = this.sessionMessageRefMap[node.key];
                if (!messageEl) continue;
                let top = Number.NaN;
                if (
                    scrollRect
                    && typeof messageEl.getBoundingClientRect === 'function'
                ) {
                    const messageRect = messageEl.getBoundingClientRect();
                    top = scrollTop + (messageRect.top - scrollRect.top);
                } else {
                    top = Number(messageEl.offsetTop || 0);
                }
                if (!Number.isFinite(top)) continue;
                nextOffsetByKey[node.key] = top;
            }
            cache.offsetByKey = nextOffsetByKey;
            cache.dirty = false;
            return cache.offsetByKey;
        },
        getCachedSessionTimelineMeasuredNodes(nodes) {
            const nodeList = Array.isArray(nodes) ? nodes : [];
            if (!nodeList.length) {
                return [];
            }
            const cache = this.ensureSessionTimelineMeasurementCache();
            if (cache.dirty) {
                this.refreshSessionTimelineMeasurementCache(nodeList);
            }
            const offsetByKey = cache.offsetByKey || Object.create(null);
            const measuredNodes = [];
            for (const node of nodeList) {
                if (!node || !node.key) continue;
                const top = Number(offsetByKey[node.key]);
                if (!Number.isFinite(top)) continue;
                measuredNodes.push({
                    key: node.key,
                    top
                });
            }
            if (measuredNodes.length >= nodeList.length) {
                return measuredNodes;
            }
            const refreshedOffsetByKey = this.refreshSessionTimelineMeasurementCache(nodeList);
            const refreshedNodes = [];
            for (const node of nodeList) {
                if (!node || !node.key) continue;
                const top = Number(refreshedOffsetByKey[node.key]);
                if (!Number.isFinite(top)) continue;
                refreshedNodes.push({
                    key: node.key,
                    top
                });
            }
            return refreshedNodes;
        },
        getSessionMessageRefBinder(messageKey) {
            if (!this.isSessionTimelineNodeKey(messageKey)) return null;
            const current = this.sessionMessageRefBinderMap[messageKey];
            if (!current || current.ticket !== this.sessionTabRenderTicket) {
                const ticket = this.sessionTabRenderTicket;
                this.sessionMessageRefBinderMap[messageKey] = {
                    ticket,
                    bind: (el) => {
                        this.bindSessionMessageRef(messageKey, el, ticket);
                    }
                };
            }
            return this.sessionMessageRefBinderMap[messageKey].bind;
        },
        updateSessionTimelineOffset() {
            const container = this.sessionPreviewContainerEl || this.$refs.sessionPreviewContainer;
            if (!container || !container.style) return;
            if (!this.hasRenderableSessionTimeline()) {
                if (this.__sessionPreviewHeaderOffsetPx != null) {
                    container.style.removeProperty('--session-preview-header-offset');
                    this.__sessionPreviewHeaderOffsetPx = null;
                }
                return;
            }
            const offset = getSessionPreviewHeaderOffset(this);
            if (this.__sessionPreviewHeaderOffsetPx === offset) {
                return;
            }
            this.__sessionPreviewHeaderOffsetPx = offset;
            container.style.setProperty('--session-preview-header-offset', `${offset}px`);
        },
        bindSessionMessageRef(messageKey, el, ticket = this.sessionTabRenderTicket) {
            if (!this.sessionTimelineEnabled) return;
            if (!messageKey) return;
            if (ticket !== this.sessionTabRenderTicket) return;
            if (el) {
                if (!this.isSessionTimelineNodeKey(messageKey)) return;
                if (this.sessionMessageRefMap[messageKey] === el) return;
                this.sessionMessageRefMap[messageKey] = el;
                this.invalidateSessionTimelineMeasurementCache();
            } else {
                if (!this.sessionMessageRefMap[messageKey]) return;
                delete this.sessionMessageRefMap[messageKey];
                this.invalidateSessionTimelineMeasurementCache();
            }
        },
        isSessionTimelineNodeKey(messageKey) {
            if (!messageKey) return false;
            return !!(this.sessionTimelineNodeKeyMap && this.sessionTimelineNodeKeyMap[messageKey]);
        },
        pruneSessionMessageRefs() {
            const nodeKeyMap = this.sessionTimelineNodeKeyMap || Object.create(null);
            let removed = false;
            for (const key of Object.keys(this.sessionMessageRefMap)) {
                if (nodeKeyMap[key]) continue;
                delete this.sessionMessageRefMap[key];
                removed = true;
            }
            for (const key of Object.keys(this.sessionMessageRefBinderMap)) {
                if (nodeKeyMap[key]) continue;
                delete this.sessionMessageRefBinderMap[key];
            }
            if (removed) {
                this.invalidateSessionTimelineMeasurementCache();
            }
        },
        cancelSessionTimelineSync() {
            if (!this.sessionTimelineRafId) return;
            if (typeof cancelAnimationFrame === 'function') {
                cancelAnimationFrame(this.sessionTimelineRafId);
            }
            this.sessionTimelineRafId = 0;
        },
        scheduleSessionTimelineSync() {
            this.updateSessionTimelineOffset();
            if (this.sessionTimelineRafId) return;
            if (typeof requestAnimationFrame === 'function') {
                this.sessionTimelineRafId = requestAnimationFrame(() => {
                    this.sessionTimelineRafId = 0;
                    this.syncSessionTimelineActiveFromScroll();
                });
                return;
            }
            this.syncSessionTimelineActiveFromScroll();
        },
        onSessionPreviewScroll() {
            if (
                !this.sessionTimelineEnabled
                || this.mainTab !== 'sessions'
                || this.getMainTabForNav() !== 'sessions'
                || !this.sessionPreviewRenderEnabled
            ) return;
            if (!this.sessionTimelineNodes.length) return;
            const scrollEl = this.sessionPreviewScrollEl || this.$refs.sessionPreviewScroll;
            if (!scrollEl) return;
            const now = Date.now();
            const currentTop = Number(scrollEl.scrollTop || 0);
            const delta = Math.abs(currentTop - Number(this.sessionTimelineLastScrollTop || 0));
            const elapsed = now - Number(this.sessionTimelineLastSyncAt || 0);
            if (delta < 48 && elapsed < 120) {
                return;
            }
            this.sessionTimelineLastScrollTop = currentTop;
            this.sessionTimelineLastSyncAt = now;
            this.scheduleSessionTimelineSync();
        },
        onWindowResize() {
            this.updateCompactLayoutMode();
            if (
                !this.sessionTimelineEnabled
                || this.mainTab !== 'sessions'
                || this.getMainTabForNav() !== 'sessions'
                || !this.sessionPreviewRenderEnabled
            ) {
                return;
            }
            if (!this.sessionTimelineNodes.length) return;
            this.updateSessionTimelineOffset();
            this.invalidateSessionTimelineMeasurementCache();
            this.scheduleSessionTimelineSync();
        },
        shouldForceCompactLayout() {
            if (typeof window === 'undefined' || typeof navigator === 'undefined') {
                return false;
            }
            const doc = typeof document !== 'undefined' ? document : null;
            const viewportWidth = Math.max(
                0,
                Number(window.innerWidth || 0),
                Number(doc && doc.documentElement ? doc.documentElement.clientWidth : 0)
            );
            const screenWidth = Number(window.screen && window.screen.width ? window.screen.width : 0);
            const screenHeight = Number(window.screen && window.screen.height ? window.screen.height : 0);
            const shortEdge = screenWidth > 0 && screenHeight > 0
                ? Math.min(screenWidth, screenHeight)
                : 0;
            const touchPoints = Number(navigator.maxTouchPoints || 0);
            const userAgent = String(navigator.userAgent || '');
            const isMobileUa = /(Android|iPhone|iPad|iPod|Mobile)/i.test(userAgent);
            let coarsePointer = false;
            let noHover = false;
            try {
                coarsePointer = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
            } catch (_) {}
            try {
                noHover = !!(window.matchMedia && window.matchMedia('(hover: none)').matches);
            } catch (_) {}
            return shouldForceCompactLayoutMode({
                viewportWidth,
                screenWidth,
                screenHeight,
                shortEdge,
                maxTouchPoints: touchPoints,
                userAgent,
                isMobileUa,
                coarsePointer,
                noHover
            });
        },
        applyCompactLayoutClass(enabled) {
            if (typeof document === 'undefined' || !document.body) {
                return;
            }
            document.body.classList.toggle('force-compact', !!enabled);
        },
        updateCompactLayoutMode() {
            const enabled = this.shouldForceCompactLayout();
            this.forceCompactLayout = enabled;
            this.applyCompactLayoutClass(enabled);
        },
        syncSessionTimelineActiveFromScroll() {
            if (
                !this.sessionTimelineEnabled
                || this.mainTab !== 'sessions'
                || this.getMainTabForNav() !== 'sessions'
                || !this.sessionPreviewRenderEnabled
            ) {
                if (this.sessionTimelineActiveKey) {
                    this.sessionTimelineActiveKey = '';
                }
                return;
            }
            const nodes = Array.isArray(this.sessionTimelineNodes) ? this.sessionTimelineNodes : [];
            if (!nodes.length) {
                if (this.sessionTimelineActiveKey) {
                    this.sessionTimelineActiveKey = '';
                }
                return;
            }
            this.pruneSessionMessageRefs();
            const scrollEl = this.sessionPreviewScrollEl || this.$refs.sessionPreviewScroll;
            if (!scrollEl) {
                if (!this.isSessionTimelineNodeKey(this.sessionTimelineActiveKey)) {
                    const fallbackKey = nodes[0].key;
                    if (this.sessionTimelineActiveKey !== fallbackKey) {
                        this.sessionTimelineActiveKey = fallbackKey;
                    }
                }
                return;
            }
            const stickyOffset = getSessionPreviewHeaderOffset(this, scrollEl);
            const rawAnchorY = Number(scrollEl.scrollTop || 0) + stickyOffset;
            const previousAnchorY = Number(this.sessionTimelineLastAnchorY || 0);
            let direction = rawAnchorY - previousAnchorY;
            if (Math.abs(direction) < 1) {
                direction = Number(this.sessionTimelineLastDirection || 0);
            } else {
                this.sessionTimelineLastDirection = direction > 0 ? 1 : -1;
            }
            this.sessionTimelineLastAnchorY = rawAnchorY;
            const hysteresisPx = 18;
            const hysteresis = direction > 0 ? -hysteresisPx : (direction < 0 ? hysteresisPx : 0);
            const anchorY = rawAnchorY + hysteresis;
            const measuredNodes = this.getCachedSessionTimelineMeasuredNodes(nodes);
            if (!measuredNodes.length) {
                if (!this.isSessionTimelineNodeKey(this.sessionTimelineActiveKey)) {
                    this.sessionTimelineActiveKey = nodes[0].key;
                }
                return;
            }
            let low = 0;
            let high = measuredNodes.length - 1;
            let candidateIndex = 0;
            while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                if (measuredNodes[mid].top <= anchorY) {
                    candidateIndex = mid;
                    low = mid + 1;
                } else {
                    high = mid - 1;
                }
            }
            let currentIndex = -1;
            if (this.sessionTimelineActiveKey) {
                for (let i = 0; i < measuredNodes.length; i += 1) {
                    if (measuredNodes[i].key === this.sessionTimelineActiveKey) {
                        currentIndex = i;
                        break;
                    }
                }
            }
            if (currentIndex >= 0) {
                if (direction > 0 && candidateIndex < currentIndex) {
                    candidateIndex = currentIndex;
                } else if (direction < 0 && candidateIndex > currentIndex) {
                    candidateIndex = currentIndex;
                }
            }
            const activeKey = measuredNodes[candidateIndex].key;
            if (this.sessionTimelineActiveKey !== activeKey) {
                this.sessionTimelineActiveKey = activeKey;
            }
        },
        jumpToSessionTimelineNode(messageKey) {
            if (!this.sessionTimelineEnabled || this.mainTab !== 'sessions' || !this.sessionPreviewRenderEnabled) return;
            if (!messageKey) return;
            if (!this.isSessionTimelineNodeKey(messageKey)) return;
            const scrollEl = this.sessionPreviewScrollEl || this.$refs.sessionPreviewScroll;
            if (!scrollEl) return;
            const messageEl = this.sessionMessageRefMap[messageKey];
            if (!messageEl) return;
            const stickyOffset = getSessionPreviewHeaderOffset(this, scrollEl);
            const scrollRect = scrollEl.getBoundingClientRect();
            const messageRect = messageEl.getBoundingClientRect();
            const targetScrollTop = scrollEl.scrollTop + (messageRect.top - scrollRect.top) - stickyOffset;
            this.sessionTimelineActiveKey = messageKey;
            if (typeof scrollEl.scrollTo === 'function') {
                scrollEl.scrollTo({
                    top: Math.max(0, targetScrollTop),
                    behavior: 'smooth'
                });
            } else {
                messageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    };
}
