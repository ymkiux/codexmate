(function () {
    "use strict";

    if (!crypto.randomUUID) {
        crypto.randomUUID = function() {
            return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
                (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
            );
        };
    }

    var config = window.WEB_CC_CONFIG || {};
    var wsUrl = config.wsUrl || ((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
    var urlParams = new URLSearchParams(window.location.search);
    var sessionId = urlParams.get('session');
    var ws = null;
    var wsReady = false;
    var pendingMessages = [];
    var channelIdMap = {};
    var reverseMap = {};

    function toServerId(id) {
        return channelIdMap[id] || id;
    }

    function toWebviewId(id) {
        return reverseMap[id] || id;
    }

    function connect() {
        ws = new WebSocket(wsUrl);
        ws.onopen = function () {
            wsReady = true;
            while (pendingMessages.length > 0) {
                ws.send(pendingMessages.shift());
            }
        };
        ws.onmessage = function (event) {
            try {
                var data = JSON.parse(event.data);
                if (data.type === "channel_remap") {
                    channelIdMap = {};
                    reverseMap = {};
                    channelIdMap[data.webviewChannelId] = data.serverChannelId;
                    reverseMap[data.serverChannelId] = data.webviewChannelId;
                    return;
                }
                if (data.message && data.message.channelId) {
                    data.message.channelId = toWebviewId(data.message.channelId);
                }
                window.dispatchEvent(new MessageEvent("message", { data: data }));
            } catch (_) {}
        };
        ws.onclose = function () {
            wsReady = false;
            setTimeout(connect, 2000);
        };
        ws.onerror = function () {};
    }

    function sendMessage(msg) {
        if (config.projectPath && !msg.cwd) {
            msg.cwd = config.projectPath;
        }
        if (msg.type === 'launch_claude') {
            if (sessionId && !msg.resume) {
                msg.resume = sessionId;
            }
            msg.permissionMode = config.permissionMode || 'bypassPermissions';
        }
        if (msg.channelId) {
            msg.channelId = toServerId(msg.channelId);
        }
        var data = JSON.stringify(msg);
        if (wsReady && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(data);
        } else {
            pendingMessages.push(data);
        }
    }

    var VSCODE_STATE_KEY = "web-cc-vscode-state";
    window.acquireVsCodeApi = function () {
        return {
            postMessage: function (msg) {
                sendMessage(msg);
            },
            getState: function () {
                try {
                    var raw = localStorage.getItem(VSCODE_STATE_KEY);
                    return raw ? JSON.parse(raw) : undefined;
                } catch (_) {
                    return undefined;
                }
            },
            setState: function (state) {
                try {
                    localStorage.setItem(VSCODE_STATE_KEY, JSON.stringify(state));
                } catch (_) {}
                return state;
            },
        };
    };

    window.IS_SIDEBAR = false;
    window.IS_FULL_EDITOR = true;
    window.IS_SESSION_LIST_ONLY = false;
    connect();
})();

