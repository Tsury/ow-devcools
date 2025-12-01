// Background Service Worker
// Handles CDP connections and Tab management

importScripts('cdp-scripts.js');

let packagesSocket = null;
let packagesTargetId = null;
let appState = [];
let openedTargets = new Map(); // targetId -> { tabId, title, url }
let autoOpenedHistory = new Set(); // targetId
let pendingManifestRequests = new Map(); // reqId -> resolve
let autoOpenRules = []; // Global rules array
let hiddenRules = [];
let hiddenAppRules = [];

// Track tab closures to update state
chrome.tabs.onRemoved.addListener((tabId) => {
    for (const [targetId, info] of openedTargets.entries()) {
        if (info.tabId === tabId) {
            openedTargets.delete(targetId);
            broadcastOpenedTargets();
            focusMainTab();
            break;
        }
    }
});

// Listen for storage changes (e.g. from Popup/Content)
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        if (changes.autoOpenRules) {
            autoOpenRules = changes.autoOpenRules.newValue || [];
        }
        if (changes.hiddenRules) {
            hiddenRules = changes.hiddenRules.newValue || [];
        }
        if (changes.hiddenAppRules) {
            hiddenAppRules = changes.hiddenAppRules.newValue || [];
        }
        if (changes.settings) {
            const newSettings = changes.settings.newValue || {};
            if (newSettings.pollingRate) {
                pollingRate = newSettings.pollingRate;
                startPolling();
            }
        }
    }
});

// Load rules and settings on startup
let pollingIntervalId = null;
let pollingRate = 2000;

// Load rules and settings on startup
chrome.storage.local.get(['autoOpenRules', 'hiddenRules', 'hiddenAppRules', 'settings'], (result) => {
    if (result.autoOpenRules) autoOpenRules = result.autoOpenRules;
    if (result.hiddenRules) hiddenRules = result.hiddenRules;
    if (result.hiddenAppRules) hiddenAppRules = result.hiddenAppRules;
    
    if (result.settings && result.settings.pollingRate) {
        pollingRate = result.settings.pollingRate;
    }
    startPolling();
});

function startPolling() {
    if (pollingIntervalId) clearInterval(pollingIntervalId);
    
    // Initial run
    findAndConnectToPackages();
    scrapeApps();

    pollingIntervalId = setInterval(() => {
        findAndConnectToPackages();
        scrapeApps();
    }, pollingRate);
}

// Poll for the Packages window and connect if found
async function findAndConnectToPackages() {
    try {
        const response = await fetch('http://localhost:54284/json/list');
        const targets = await response.json();
        
        // 1. Handle Packages Window Connection
        const packagesTarget = targets.find(t => t.url.includes('overwolf://packages') || t.title === 'Packages');

        if (packagesTarget) {
            if (packagesTargetId !== packagesTarget.id) {
                connectToPackages(packagesTarget.webSocketDebuggerUrl);
                packagesTargetId = packagesTarget.id;
            }
        } else {
            if (packagesTargetId) {
                packagesSocket = null;
                packagesTargetId = null;
                appState = []; // Clear state
                broadcastState();
            }
        }

        // 2. Handle Auto-Open Rules & Auto-Close
        checkAutoOpenRules(targets);

    } catch (err) {
        if (packagesTargetId || packagesSocket) {
            packagesSocket = null;
            packagesTargetId = null;
            appState = [];
            broadcastState();
        }
    }
}

function checkAutoOpenRules(targets) {
    const currentTargetIds = new Set(targets.map(t => t.id));

    // Cleanup history for closed targets
    for (const id of autoOpenedHistory) {
        if (!currentTargetIds.has(id)) {
            autoOpenedHistory.delete(id);
        }
    }

    // Auto-Close: Check for disappeared targets
    // Only close if the rule is still active
    for (const [targetId, info] of openedTargets.entries()) {
        if (!currentTargetIds.has(targetId)) {
            // Check if rule still exists for this target
            const matchingRule = autoOpenRules.find(rule => {
                const titleMatch = rule.titlePattern ? info.title === rule.titlePattern : true;
                const urlMatch = rule.urlPattern ? info.url === rule.urlPattern : true;
                return titleMatch && urlMatch;
            });

            if (matchingRule && matchingRule.autoClose) {
                chrome.tabs.remove(info.tabId, () => {
                    if (chrome.runtime.lastError) {
                        // Tab might have been closed by user already
                    }
                });
                focusMainTab();
            } else {
                // Target disappeared but Auto-Close NOT active, keeping tab
            }
            openedTargets.delete(targetId);
            broadcastOpenedTargets();
        }
    }

    // Auto-Open
    targets.forEach(target => {
        // Skip if already opened
        if (openedTargets.has(target.id)) return;

        // Skip if previously auto-opened in this session (user might have closed it)
        if (autoOpenedHistory.has(target.id)) return;

        // 1. Check if hidden by specific rule
        // Use raw title for matching to ensure consistency with how rules are created
        const isHiddenByRule = hiddenRules.some(rule => 
            (rule.titlePattern ? target.title === rule.titlePattern : true) && 
            (rule.urlPattern ? target.url === rule.urlPattern : true)
        );
        if (isHiddenByRule) return;

        // 2. Check if hidden by App ID (extract from URL)
        // URL format: overwolf-extension://<APP_ID>/...
        const appMatch = target.url.match(/overwolf-extension:\/\/([^\/]+)\//);
        if (appMatch && appMatch[1]) {
            const appId = appMatch[1];
            if (hiddenAppRules.some(r => (typeof r === 'string' ? r : r.id) === appId)) return;
        }

        // Check against rules
        const matchingRule = autoOpenRules.find(rule => {
            const titleMatch = rule.titlePattern ? target.title === rule.titlePattern : true;
            const urlMatch = rule.urlPattern ? target.url === rule.urlPattern : true;
            return titleMatch && urlMatch;
        });

        if (matchingRule && matchingRule.autoOpen) {
            // Mark as handled immediately to prevent double opening
            autoOpenedHistory.add(target.id);

            let fullUrl = target.devtoolsFrontendUrl;
            if (fullUrl && !fullUrl.startsWith('http')) {
                fullUrl = 'http://localhost:54284' + (fullUrl.startsWith('/') ? '' : '/') + fullUrl;
            }

            const shouldFocus = matchingRule.autoFocus || false;

            chrome.tabs.create({ url: fullUrl, active: shouldFocus }, (tab) => {
                openedTargets.set(target.id, { tabId: tab.id, title: target.title, url: target.url });
                broadcastOpenedTargets();
            });
        }
    });
}

function decodeHtml(html) {
    if (!html) return '';
    return html
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&#039;/g, "'");
}

function connectToPackages(wsUrl) {
    if (packagesSocket) {
        packagesSocket.close();
    }

    packagesSocket = new WebSocket(wsUrl);

    packagesSocket.onopen = () => {
        // Send Sanity Check
        const sanityScript = CdpScripts.getSanityCheckScript();
        packagesSocket.send(JSON.stringify({
            id: 9001,
            method: "Runtime.evaluate",
            params: { expression: sanityScript, returnByValue: true }
        }));

        scrapeApps();
    };

    packagesSocket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        // Scraping result
        if (data.id === 1001) { 
            if (data.result && data.result.result && data.result.result.value) {
                appState = data.result.result.value;
                broadcastState();
            }
        }
        
        // Control App result
        if (data.id === 2001) {
            if (data.error) console.error("CDP Error:", data.error);
            if (data.result && data.result.exceptionDetails) console.error("Script Exception:", data.result.exceptionDetails);

            // Force immediate re-scrape to update UI
            setTimeout(scrapeApps, 100);
        }

        // Sanity Check result
        if (data.id === 9001) {
            // Silent
        }

        // Manifest Fetch result
        if (pendingManifestRequests.has(data.id)) {
            const resolve = pendingManifestRequests.get(data.id);
            pendingManifestRequests.delete(data.id);
            if (data.result && data.result.result && data.result.result.value) {
                resolve(data.result.result.value);
            } else {
                resolve({ error: "Failed to retrieve value" });
            }
        }
    };

    packagesSocket.onclose = () => {
        packagesSocket = null;
        packagesTargetId = null;
        appState = [];
        broadcastState();
    };
}

function scrapeApps() {
    if (!packagesSocket || packagesSocket.readyState !== WebSocket.OPEN) return;

    const scraperScript = CdpScripts.getScraperScript();

    const msg = {
        id: 1001,
        method: "Runtime.evaluate",
        params: {
            expression: scraperScript,
            returnByValue: true
        }
    };
    packagesSocket.send(JSON.stringify(msg));
}

function broadcastState() {
    chrome.tabs.query({url: "http://localhost:54284/*"}, (tabs) => {
        for (const tab of tabs) {
            chrome.tabs.sendMessage(tab.id, {
                type: "APP_STATE", 
                data: appState,
                connected: !!packagesSocket
            }, () => {
                // Ignore errors if the content script is not ready
                if (chrome.runtime.lastError) {
                    // Content script not ready
                }
            });
        }
    });
}

function broadcastOpenedTargets() {
    const targets = Array.from(openedTargets.keys());
    chrome.tabs.query({url: "http://localhost:54284/*"}, (tabs) => {
        for (const tab of tabs) {
            chrome.tabs.sendMessage(tab.id, {
                type: "OPENED_TARGETS_UPDATE", 
                data: targets
            }, () => {
                // Ignore errors if the content script is not ready
                if (chrome.runtime.lastError) {
                    // Content script not ready
                }
            });
        }
    });
}

function openDevToolsTab(targetId, title, url, devtoolsFrontendUrl) {
    // Ensure the URL is absolute
    let fullUrl = devtoolsFrontendUrl;
    if (fullUrl && !fullUrl.startsWith('http')) {
        fullUrl = 'http://localhost:54284' + (fullUrl.startsWith('/') ? '' : '/') + fullUrl;
    }

    // Check if a tab with this URL already exists
    chrome.tabs.query({ url: fullUrl }, (tabs) => {
        if (tabs.length > 0) {
            // Tab exists, focus it
            const tab = tabs[0];
            chrome.tabs.update(tab.id, { active: true });
            chrome.windows.update(tab.windowId, { focused: true });
            
            // Update our internal state just in case
            openedTargets.set(targetId, { tabId: tab.id, title, url });
            broadcastOpenedTargets();
        } else {
            // Tab doesn't exist, create it
            chrome.tabs.create({ url: fullUrl, active: true }, (tab) => {
                openedTargets.set(targetId, { tabId: tab.id, title, url });
                broadcastOpenedTargets();
            });
        }
    });
}

// Handle messages from Content Script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "GET_STATE") {
        sendResponse({ data: appState, connected: !!packagesSocket });
    }
    if (request.type === "GET_OPENED_TARGETS") {
        sendResponse(Array.from(openedTargets.keys()));
    }
    if (request.type === "OPEN_POPUP") {
        // Try to open the popup
        // Note: This requires Chrome 99+ and a user gesture chain.
        try {
            if (chrome.action && chrome.action.openPopup) {
                chrome.action.openPopup().catch(err => {
                    console.error("Failed to open popup via action.openPopup:", err);
                    // Fallback to window creation
                    chrome.windows.create({
                        url: chrome.runtime.getURL("src/popup/popup.html"),
                        type: "popup",
                        width: 400,
                        height: 700
                    });
                });
            } else {
                // Fallback for older browsers or if API is missing
                 chrome.windows.create({
                    url: chrome.runtime.getURL("src/popup/popup.html"),
                    type: "popup",
                    width: 400,
                    height: 700
                });
            }
        } catch (e) {
            console.error("Failed to open popup (sync error):", e);
             // Fallback if openPopup throws
             chrome.windows.create({
                url: chrome.runtime.getURL("src/popup/popup.html"),
                type: "popup",
                width: 400,
                height: 700
            });
        }
    }
    if (request.type === "CLOSE_DEVTOOLS_TAB") {
        const { targetId } = request;
        if (openedTargets.has(targetId)) {
            const info = openedTargets.get(targetId);
            chrome.tabs.remove(info.tabId, () => {
                if (chrome.runtime.lastError) {
                    // Tab might be already closed
                }
                openedTargets.delete(targetId);
                broadcastOpenedTargets();
            });
        }
    }
    if (request.type === "OPEN_DEVTOOLS") {
        const { targetId, url, title, devtoolsFrontendUrl } = request;
        
        if (openedTargets.has(targetId)) {
            const info = openedTargets.get(targetId);
            chrome.tabs.get(info.tabId, (tab) => {
                if (chrome.runtime.lastError || !tab) {
                    // Tab closed externally
                    openDevToolsTab(targetId, title, url, devtoolsFrontendUrl);
                } else {
                    chrome.tabs.update(info.tabId, { active: true });
                    chrome.windows.update(tab.windowId, { focused: true });
                }
            });
        } else {
            openDevToolsTab(targetId, title, url, devtoolsFrontendUrl);
        }
    }
    if (request.type === "RELAUNCH_APP") {
        controlApp(request.appId, "Relaunch");
    }
    if (request.type === "CONTROL_APP") {
        controlApp(request.appId, request.action, request.extra);
    }
    if (request.type === "REFRESH_APP") {
        const app = appState.find(a => a.id === request.appId);
        if (app) {
            const toggleBtn = app.buttons.find(b => b.type === 'toggle');
            if (toggleBtn) {
                if (toggleBtn.text === 'Disable') {
                    // App is currently Enabled. Cycle it.
                    controlApp(request.appId, "Disable");
                    setTimeout(() => {
                        controlApp(request.appId, "Enable");
                    }, 100);
                } else {
                    // App is currently Disabled. Just Enable it.
                    controlApp(request.appId, "Enable");
                }
            }
        }
    }
    if (request.type === "OPEN_FOLDER") {
        openFolder(request.path);
    }
    if (request.type === "OPEN_URL") {
        chrome.tabs.create({ url: request.url });
    }
    if (request.type === "TOGGLE_RULE_FLAG") {
        const { titlePattern, urlPattern, flag, value } = request;
        let ruleIndex = autoOpenRules.findIndex(r => r.titlePattern === titlePattern && r.urlPattern === urlPattern);
        
        if (ruleIndex === -1) {
            // Create new rule
            const newRule = { titlePattern, urlPattern, autoOpen: false, autoClose: false };
            newRule[flag] = value;
            autoOpenRules.push(newRule);
        } else {
            autoOpenRules[ruleIndex][flag] = value;
        }
        chrome.storage.local.set({autoOpenRules});
    }
    if (request.type === "SET_AUTO_FOCUS") {
        const { titlePattern, urlPattern, value } = request;
        
        // If enabling focus, disable it for everyone else first
        if (value) {
            autoOpenRules.forEach(r => r.autoFocus = false);
        }

        let rule = autoOpenRules.find(r => r.titlePattern === titlePattern && r.urlPattern === urlPattern);
        if (!rule) {
            rule = { titlePattern, urlPattern, autoOpen: true, autoClose: false, autoFocus: value };
            autoOpenRules.push(rule);
        } else {
            rule.autoOpen = true; // Ensure it's open
            rule.autoFocus = value;
        }
        chrome.storage.local.set({autoOpenRules});
    }
    if (request.type === "GET_RULES") {
        sendResponse(autoOpenRules);
    }
    if (request.type === "GET_TARGET_INFO") {
        const { targetId } = request;
        
        // We need to fetch the targets list to find the URL of this targetId
        fetch('http://localhost:54284/json/list')
            .then(r => r.json())
            .then(async targets => {
                const target = targets.find(t => t.id === targetId);
                if (target) {
                    // Extract App ID
                    const appMatch = target.url.match(/overwolf-extension:\/\/([^\/]+)\//);
                    if (appMatch && appMatch[1]) {
                        const appId = appMatch[1];
                        const app = appState.find(a => a.id === appId);
                        
                        const result = {
                            icon: app ? app.icon : null,
                            appName: app ? app.name : appId,
                            windowName: null
                        };

                        // Try to get window name from manifest
                        try {
                            const manifestData = await fetchManifestViaCDP(appId);
                            if (manifestData && !manifestData.error) {
                                const windows = manifestData.windows || manifestData.data?.windows || {};
                                const urlObj = new URL(target.url);
                                const path = urlObj.pathname.startsWith('/') ? urlObj.pathname.substring(1) : urlObj.pathname;
                                
                                for (const [name, def] of Object.entries(windows)) {
                                    if (def.file === path) {
                                        result.windowName = name;
                                        break;
                                    }
                                }
                            }
                        } catch (e) {
                            console.error("Error resolving window name:", e);
                        }

                        sendResponse(result);
                        return;
                    }
                }
                sendResponse({ icon: null });
            })
            .catch(e => {
                console.error("Error fetching target info:", e);
                sendResponse({ icon: null });
            });
            
        return true; // Async response
    }
    if (request.type === "FETCH_MANIFEST") {
        const { appId } = request;
        fetchManifestViaCDP(appId).then(data => {
             if (data.error) sendResponse({ success: false, error: data.error });
             else sendResponse({ success: true, data: data });
        });
        return true; // Keep channel open for async response
    }
});

function fetchManifestViaCDP(appId) {
    return new Promise(resolve => {
        if (!packagesSocket) {
            resolve({ error: "Socket not connected" });
            return;
        }

        const reqId = 5000 + Math.floor(Math.random() * 10000);
        pendingManifestRequests.set(reqId, resolve);

        // Enhanced script with logging inside the Packages window context
        const script = CdpScripts.getManifestFetchScript(appId);

        packagesSocket.send(JSON.stringify({
            id: reqId,
            method: "Runtime.evaluate",
            params: { 
                expression: script, 
                awaitPromise: true, 
                returnByValue: true 
            }
        }));
        
        // Timeout safety
        setTimeout(() => {
            if (pendingManifestRequests.has(reqId)) {
                pendingManifestRequests.delete(reqId);
                resolve({ error: "Timeout" });
            }
        }, 5000);
    });
}

function controlApp(appId, actionName, extraData) {
    if (!packagesSocket) {
        console.error("Cannot control app: Socket not connected");
        return;
    }
    
    const script = CdpScripts.getControlScript(appId, actionName, extraData);
    
    packagesSocket.send(JSON.stringify({
        id: 2001,
        method: "Runtime.evaluate",
        params: { expression: script, returnByValue: true }
    }));
}

function openFolder(path) {
    if (!packagesSocket) return;
    
    // Escape backslashes for the JS string context
    const escapedPath = path.replace(/\\/g, '\\\\');
    
    const script = CdpScripts.getOpenFolderScript(escapedPath);
    
    packagesSocket.send(JSON.stringify({
        id: 3001,
        method: "Runtime.evaluate",
        params: { expression: script }
    }));
}

function focusMainTab() {
    chrome.tabs.query({url: "http://localhost:54284/*"}, (tabs) => {
        if (tabs.length > 0) {
            const tab = tabs[0];
            chrome.tabs.update(tab.id, { active: true });
            chrome.windows.update(tab.windowId, { focused: true });
        }
    });
}
