// Background Service Worker
// Handles CDP connections and Tab management

importScripts('cdp-scripts.js');

let packagesSocket = null;
let packagesTargetId = null;
let appState = [];
let packagesSettings = {};
let openedTargets = new Map(); // targetId -> { tabId, title, url }
let lingeringTabs = []; // { tabId, title, url } - tabs that were opened but target died (and not auto-closed)
let autoOpenedHistory = new Set(); // targetId
let pendingManifestRequests = new Map(); // reqId -> resolve
let autoOpenRules = []; // Global rules array
let hiddenRules = [];
let hiddenAppRules = [];
let targetIdentityCache = new Map(); // targetId -> windowName
let identifyingTargets = new Set(); // targetId

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
    // Cleanup lingering tabs
    lingeringTabs = lingeringTabs.filter(t => t.tabId !== tabId);
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
let focusLockUntil = 0;

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

        // 3. Identify Overwolf Windows
        identifyOverwolfWindows(targets);

    } catch (err) {
        if (packagesTargetId || packagesSocket) {
            packagesSocket = null;
            packagesTargetId = null;
            appState = [];
            broadcastState();
        }
    }
}

function createDevToolsTab(url, active, callback) {
    // Find the main dashboard tab to get its window ID
    chrome.tabs.query({url: "http://localhost:54284/*"}, (tabs) => {
        let createProperties = { url: url, active: active };
        
        if (tabs.length > 0) {
            // Open in the same window as the dashboard
            createProperties.windowId = tabs[0].windowId;
        }

        chrome.tabs.create(createProperties, (tab) => {
            if (active) {
                chrome.windows.update(tab.windowId, { focused: true });
            }
            if (callback) callback(tab);
        });
    });
}

function getRuleUrl(url) {
    try {
        const urlObj = new URL(url);
        urlObj.search = '';
        urlObj.hash = '';
        return urlObj.href;
    } catch (e) {
        return url.split('?')[0].split('#')[0];
    }
}

function isRuleMatch(rule, title, url) {
    let titleMatch = true;
    if (rule.titlePattern) {
        if (title === rule.titlePattern) {
            titleMatch = true;
        } else {
            const isTitleUrl = title.includes('://');
            const isRuleTitleUrl = rule.titlePattern.includes('://');
            if (isTitleUrl && isRuleTitleUrl) {
                titleMatch = getRuleUrl(title) === getRuleUrl(rule.titlePattern);
            } else {
                titleMatch = false;
            }
        }
    }
    
    const targetUrl = getRuleUrl(url);
    const urlMatch = rule.urlPattern ? (targetUrl === rule.urlPattern) : true;
    
    return titleMatch && urlMatch;
}

function checkAutoOpenRules(targets) {
    const currentTargetIds = new Set(targets.map(t => t.id));

    // Cleanup history for closed targets
    for (const id of autoOpenedHistory) {
        if (!currentTargetIds.has(id)) {
            autoOpenedHistory.delete(id);
        }
    }

    const actions = {
        close: [], // { tabId, targetId, info }
        open: []   // { target, rule }
    };

    // 1. Identify Closes (Targets gone)
    for (const [targetId, info] of openedTargets.entries()) {
        if (!currentTargetIds.has(targetId)) {
            const infoUrl = getRuleUrl(info.url);
            // Check if rule still exists for this target
            const matchingRule = autoOpenRules.find(rule => isRuleMatch(rule, info.title, info.url));

            if (matchingRule && matchingRule.autoClose) {
                actions.close.push({ tabId: info.tabId, targetId, info });
            } else {
                // Target disappeared but Auto-Close NOT active, keeping tab
                // Move to lingeringTabs so we can close it later if the app restarts
                lingeringTabs.push({ tabId: info.tabId, title: info.title, url: info.url });
                // We still need to remove it from openedTargets, which happens in the execution phase
                // But for the logic here, we just mark it for removal from openedTargets map
                // Actually, let's handle the map cleanup in the execution phase
            }
        }
    }

    // 2. Identify Opens (New targets)
    targets.forEach(target => {
        // Skip if already opened
        if (openedTargets.has(target.id)) return;

        // Skip if previously auto-opened in this session (user might have closed it)
        if (autoOpenedHistory.has(target.id)) return;

        const targetUrl = getRuleUrl(target.url);

        // Check if hidden by specific rule
        const isHiddenByRule = hiddenRules.some(rule => isRuleMatch(rule, target.title, target.url));
        if (isHiddenByRule) return;

        // Check if hidden by App ID
        const appMatch = target.url.match(/overwolf-extension:\/\/([^\/]+)\//);
        if (appMatch && appMatch[1]) {
            const appId = appMatch[1];
            if (hiddenAppRules.some(r => (typeof r === 'string' ? r : r.id) === appId)) return;
        }

        // Check against rules
        const matchingRule = autoOpenRules.find(rule => isRuleMatch(rule, target.title, target.url));

        if (matchingRule && matchingRule.autoOpen) {
            actions.open.push({ target, rule: matchingRule });
        }
    });

    // 3. Set Focus Lock if needed
    // If we are going to open a tab with autoFocus, we lock the main tab focus
    // to prevent the "Close" actions (or onRemoved events) from stealing focus back.
    const willAutoFocus = actions.open.some(a => a.rule.autoFocus);
    if (willAutoFocus) {
        focusLockUntil = Date.now() + 3000; // 3 seconds lock
    }

    // 4. Execute Closes
    // We process these first.
    actions.close.forEach(a => {
        chrome.tabs.remove(a.tabId, () => {
            if (chrome.runtime.lastError) { /* Tab might be already closed */ }
        });
        openedTargets.delete(a.targetId);
        // Explicit focusMainTab is now guarded by focusLockUntil inside the function
        focusMainTab();
    });

    // Also cleanup openedTargets for those that moved to lingeringTabs
    // (We iterated openedTargets above, so we need to do this carefully)
    for (const [targetId, info] of openedTargets.entries()) {
        if (!currentTargetIds.has(targetId)) {
            // If it wasn't in actions.close, it means it moved to lingeringTabs
            // We need to remove it from openedTargets
            if (!actions.close.some(a => a.targetId === targetId)) {
                openedTargets.delete(targetId);
            }
        }
    }

    if (actions.close.length > 0 || openedTargets.size !== actions.close.length) {
        broadcastOpenedTargets();
    }

    // 5. Execute Opens
    actions.open.forEach(a => {
        const { target, rule } = a;
        
        // Mark as handled immediately to prevent double opening
        autoOpenedHistory.add(target.id);

        const doOpen = () => {
            // Check for lingering tabs that match this rule and close them
            const tabsToClose = [];
            lingeringTabs = lingeringTabs.filter(tabInfo => {
                const titleMatch = rule.titlePattern ? tabInfo.title === rule.titlePattern : true;
                const urlMatch = rule.urlPattern ? tabInfo.url === rule.urlPattern : true;
                
                if (titleMatch && urlMatch) {
                    tabsToClose.push(tabInfo.tabId);
                    return false; // Remove from lingeringTabs
                }
                return true; // Keep in lingeringTabs
            });

            tabsToClose.forEach(tid => chrome.tabs.remove(tid, () => { if(chrome.runtime.lastError){} }));

            let fullUrl = target.devtoolsFrontendUrl;
            if (fullUrl && !fullUrl.startsWith('http')) {
                fullUrl = 'http://localhost:54284' + (fullUrl.startsWith('/') ? '' : '/') + fullUrl;
            }

            // Check if a tab with this URL already exists (to prevent duplicates on reload)
            chrome.tabs.query({ url: fullUrl }, (existingTabs) => {
                if (existingTabs.length > 0) {
                    const existingTab = existingTabs[0];
                    openedTargets.set(target.id, { tabId: existingTab.id, title: target.title, url: target.url });
                    broadcastOpenedTargets();
                    return;
                }

                const shouldFocus = rule.autoFocus || false;

                createDevToolsTab(fullUrl, shouldFocus, (tab) => {
                    openedTargets.set(target.id, { tabId: tab.id, title: target.title, url: target.url });
                    broadcastOpenedTargets();
                });
            });
        };

        // If we closed something in this cycle, give a small breathing room before opening
        // This helps with the "Relaunch" scenario where the old window is closing and new one opening
        if (actions.close.length > 0) {
            setTimeout(doOpen, 200);
        } else {
            doOpen();
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
                const result = data.result.result.value;
                if (result.apps) {
                    appState = result.apps;
                    packagesSettings = result.settings || {};
                } else {
                    // Fallback for old script version or direct array return
                    appState = result;
                }
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
                connected: !!packagesSocket,
                settings: packagesSettings,
                identities: Array.from(targetIdentityCache.entries()),
                identifying: Array.from(identifyingTargets)
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
            createDevToolsTab(fullUrl, true, (tab) => {
                openedTargets.set(targetId, { tabId: tab.id, title, url });
                broadcastOpenedTargets();
            });
        }
    });
}

// Handle messages from Content Script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "GET_STATE") {
        sendResponse({ 
            data: appState, 
            connected: !!packagesSocket, 
            settings: packagesSettings,
            identities: Array.from(targetIdentityCache.entries()),
            identifying: Array.from(identifyingTargets)
        });
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
    if (request.type === "INSTALL_OPK") {
        clickPackageButton('.file-upload.opk button');
    }
    if (request.type === "LOAD_UNPACKED") {
        clickPackageButton('.file-upload.load button');
    }
    if (request.type === "PACK_EXTENSION") {
        clickPackageButton('.file-upload.pack button');
    }
    if (request.type === "UPDATE_PACKAGES") {
        clickPackageButton('button[data-tooltip="Update packages now"]');
    }
    if (request.type === "OPEN_TASK_MANAGER") {
        clickPackageButton('.task-manager');
    }
    if (request.type === "OPEN_OW_SETTINGS") {
        clickPackageButton('.settings');
    }
    if (request.type === "TOGGLE_BUILT_IN_PACKAGES") {
        clickPackageButton('#built-in-packages');
        setTimeout(scrapeApps, 200);
    }
    if (request.type === "TOGGLE_TRAY_DEV_OPTIONS") {
        clickPackageButton('#dev-items-in-tray-menu');
        setTimeout(scrapeApps, 200);
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
        let ruleIndex = autoOpenRules.findIndex(r => isRuleMatch(r, titlePattern, urlPattern));
        
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

        let rule = autoOpenRules.find(r => isRuleMatch(r, titlePattern, urlPattern));
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
                            appId: appId,
                            windowName: null
                        };

                        // 1. Try to get window name from Identity Cache (Best)
                        if (targetIdentityCache.has(targetId)) {
                            result.windowName = targetIdentityCache.get(targetId);
                        }

                        // 2. Fallback: Try to get window name from manifest (Heuristic)
                        if (!result.windowName) {
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
        if (!packagesSocket || packagesSocket.readyState !== WebSocket.OPEN) {
            resolve({ error: "Socket not connected or not open" });
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

function clickPackageButton(selector) {
    if (!packagesSocket || packagesSocket.readyState !== WebSocket.OPEN) return;
    
    const script = CdpScripts.getClickScript(selector);
    
    packagesSocket.send(JSON.stringify({
        id: Math.floor(Math.random() * 100000),
        method: "Runtime.evaluate",
        params: {
            expression: script,
            returnByValue: true
        }
    }));
}

function controlApp(appId, actionName, extraData) {
    if (!packagesSocket || packagesSocket.readyState !== WebSocket.OPEN) {
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
    if (!packagesSocket || packagesSocket.readyState !== WebSocket.OPEN) return;
    
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
    // If we are in a "Focus Lock" period (e.g. just opened a DevTools window),
    // do not steal focus back to the main tab.
    if (Date.now() < focusLockUntil) return;

    chrome.tabs.query({url: "http://localhost:54284/*"}, (tabs) => {
        if (tabs.length > 0) {
            const tab = tabs[0];
            chrome.tabs.update(tab.id, { active: true });
            chrome.windows.update(tab.windowId, { focused: true });
        }
    });
}

function identifyOverwolfWindows(targets) {
    // Cleanup cache for closed targets
    const currentTargetIds = new Set(targets.map(t => t.id));
    for (const id of targetIdentityCache.keys()) {
        if (!currentTargetIds.has(id)) {
            targetIdentityCache.delete(id);
        }
    }

    targets.forEach(target => {
        // Only interested in Overwolf Extension pages
        if (target.type !== 'page' || !target.url.startsWith('overwolf-extension://')) return;
        
        // Skip if already identified or currently identifying
        if (targetIdentityCache.has(target.id)) {
            return;
        }
        if (identifyingTargets.has(target.id)) {
            return;
        }

        identifyingTargets.add(target.id);
        broadcastState(); // Notify frontend of identifying state
        
        // Connect and identify
        const ws = new WebSocket(target.webSocketDebuggerUrl);
        
        ws.onopen = () => {
            const script = CdpScripts.getIdentityScript();
            ws.send(JSON.stringify({
                id: 1,
                method: "Runtime.evaluate",
                params: { 
                    expression: script, 
                    awaitPromise: true, 
                    returnByValue: true 
                }
            }));
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.id === 1 && data.result && data.result.result) {
                    const name = data.result.result.value;
                    // Cache the result (even if empty) to prevent endless loop
                    targetIdentityCache.set(target.id, name || "");
                    broadcastState(); // Notify frontend
                }
            } catch (e) {
                // Ignore
            }
            ws.close();
            identifyingTargets.delete(target.id);
            broadcastState(); // Notify frontend
        };

        ws.onerror = (e) => {
            identifyingTargets.delete(target.id);
            broadcastState(); // Notify frontend
        };
        
        // Timeout safety
        setTimeout(() => {
            if (ws.readyState !== WebSocket.CLOSED) {
                ws.close();
                identifyingTargets.delete(target.id);
                broadcastState(); // Notify frontend
            }
        }, 2500); // Increased slightly to allow script timeout to fire first
    });
}

// Show Release Notes on Update
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'update') {
        chrome.storage.local.set({ showChangelog: true });
    }
});

// --- Action Button Logic ---

const DASHBOARD_URL_PREFIX = 'http://localhost:54284';

chrome.action.onClicked.addListener((tab) => {
    const dashboardUrl = 'http://localhost:54284/';
    
    chrome.tabs.query({ url: dashboardUrl + '*' }, (tabs) => {
        const dashboardTab = tabs.find(t => !t.url.includes('/devtools/'));
        
        if (dashboardTab) {
            chrome.tabs.update(dashboardTab.id, { active: true });
            chrome.windows.update(dashboardTab.windowId, { focused: true });
        } else {
            chrome.tabs.create({ url: dashboardUrl });
        }
    });
});

function updateActionPopup(tabId, url) {
    if (url && url.startsWith(DASHBOARD_URL_PREFIX) && !url.includes('/devtools/')) {
        chrome.action.setPopup({ tabId: tabId, popup: 'src/popup/popup.html' });
    } else {
        chrome.action.setPopup({ tabId: tabId, popup: '' });
    }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tab.url) {
        updateActionPopup(tabId, tab.url);
    }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
    chrome.tabs.get(activeInfo.tabId, (tab) => {
        if (chrome.runtime.lastError) return;
        updateActionPopup(activeInfo.tabId, tab.url);
    });
});
