// Content Script
// Injected into http://localhost:54284/

console.log("Overwolf DevCools by Tsury Loaded");

// --- Shared Variables ---
let currentAppState = [];
let currentTargets = [];
let autoOpenRules = [];
let hiddenRules = [];
let hiddenAppRules = [];
let showWindowsOfHiddenApps = false;
let showUnmatchedWindows = false;
let openedTargetIds = [];
let isConnected = false;
let lastRenderedHTML = '';
let uninstallConfirmations = {}; // Track uninstall confirmation state
let targetMetadata = new Map(); // targetId -> { niceName, appName }
let currentTheme = 'dark';

// Cache version to avoid "Extension context invalidated" errors during polling
const extensionVersion = chrome.runtime.getManifest().version;

let manifestCache = new Map(); // appId -> manifestData
let fetchingManifests = new Set(); // appId
let pollInterval = null;

// Check if we are on the Dashboard or a DevTools window
const isDevTools = window.location.pathname.includes('/devtools/');

if (isDevTools) {
    // --- DevTools Enhancer Logic ---
    initDevToolsEnhancer();
} else {
    // --- Dashboard Logic ---
    initDashboard();
}

function initDevToolsEnhancer() {
    // 1. Inject default favicon (will be overwritten if app icon found)
    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = chrome.runtime.getURL('assets/icons/icon32.png');
    document.head.appendChild(link);

    // 2. Get Target ID from URL
    // URL format: .../inspector.html?ws=localhost:54284/devtools/page/<TARGET_ID>
    const params = new URLSearchParams(window.location.search);
    const wsParam = params.get('ws');
    
    if (wsParam) {
        const parts = wsParam.split('/');
        const targetId = parts[parts.length - 1];
        
        if (targetId) {
            // 3. Ask Background for App Icon
            chrome.runtime.sendMessage({ type: "GET_TARGET_INFO", targetId }, (response) => {
                if (response) {
                    if (response.icon) {
                        link.href = response.icon;
                    }
                    
                    let desiredTitle = null;
                    if (response.windowName && response.appName) {
                        desiredTitle = `${response.windowName} - ${response.appName} - DevTools`;
                    } else if (response.appName) {
                        desiredTitle = `${response.appName} - DevTools`;
                    }

                    if (desiredTitle) {
                        const enforceTitle = () => {
                            if (document.title !== desiredTitle) {
                                document.title = desiredTitle;
                            }
                        };

                        enforceTitle();

                        // Enforce title persistence using MutationObserver
                        const titleEl = document.querySelector('title');
                        if (titleEl) {
                            new MutationObserver(enforceTitle).observe(titleEl, { childList: true, characterData: true, subtree: true });
                        }
                    }

                    // 4. Inject Controls (Relaunch Button)
                    if (response.appId) {
                        injectDevToolsControls(response.appId);
                    }
                }
            });
        }
    }
}

function injectDevToolsControls(appId) {
    const container = document.createElement('div');
    container.id = 'ow-devcools-controls';
    // Positioned in the top-right area of the DevTools window
    // Using high z-index to ensure it sits on top of DevTools UI
    container.style.cssText = `
        position: fixed;
        top: 2px;
        right: 180px; /* Offset to avoid standard window controls or DevTools buttons */
        z-index: 10000;
        display: flex;
        gap: 8px;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    `;

    const relaunchBtn = document.createElement('button');
    relaunchBtn.title = "Relaunch App (Overwolf DevCools)";
    relaunchBtn.style.cssText = `
        background: #292a2d;
        border: 1px solid #5f6368;
        color: #9aa0a6;
        border-radius: 4px;
        padding: 0 10px;
        cursor: pointer;
        font-size: 11px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 6px;
        transition: all 0.2s;
        outline: none;
        height: 22px;
    `;
    
    // Hover effects
    relaunchBtn.onmouseenter = () => {
        relaunchBtn.style.background = '#35363a';
        relaunchBtn.style.color = '#e8eaed';
        relaunchBtn.style.borderColor = '#80868b';
    };
    relaunchBtn.onmouseleave = () => {
        relaunchBtn.style.background = '#292a2d';
        relaunchBtn.style.color = '#9aa0a6';
        relaunchBtn.style.borderColor = '#5f6368';
    };

    relaunchBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
        <span>Relaunch</span>
    `;

    relaunchBtn.onclick = () => {
        // Animation
        const icon = relaunchBtn.querySelector('svg');
        icon.style.transition = 'transform 0.5s ease';
        icon.style.transform = 'rotate(-180deg)';
        
        chrome.runtime.sendMessage({ type: "RELAUNCH_APP", appId });
        
        setTimeout(() => {
            icon.style.transform = 'none';
        }, 500);
    };

    container.appendChild(relaunchBtn);
    document.body.appendChild(container);
}

function initDashboard() {
    // 0. Inject Favicon
    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = chrome.runtime.getURL('assets/icons/icon32.png');
    document.head.appendChild(link);

    // 1. Hide the default content
    const defaultContent = document.body.innerHTML;
    // Preserve the original structure requirements immediately to prevent errors
    document.body.innerHTML = `
        <div id="items" style="display:none;"></div>
        <div id="caption" style="display:none;"></div>
        <div id="ow-enhancer-root">Loading Enhancer...</div>
    `;

    // Start Dashboard Logic
    startDashboardLogic();
}

// Initialize Theme
function initTheme() {
    chrome.storage.local.get(['theme'], (result) => {
        if (result.theme) {
            currentTheme = result.theme;
        } else {
            // Detect OS preference
            if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
                currentTheme = 'light';
            }
        }
        applyTheme();
    });
}

function applyTheme() {
    document.documentElement.setAttribute('data-theme', currentTheme);
    // Re-render to update button icon if needed
    if (!isDevTools) renderDashboard();
}

function toggleTheme() {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    chrome.storage.local.set({ theme: currentTheme });
    applyTheme();
}

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.theme) {
        currentTheme = changes.theme.newValue;
        applyTheme();
    }
});

initTheme();

function startDashboardLogic() {
    // Initial Poll
    poll();
    
    // Polling Loop
    pollInterval = setInterval(poll, 2000); // Default 2s, updated by settings

    // Listen for settings changes to update polling rate
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === "SETTINGS_UPDATED") {
            if (message.settings.pollingRate) {
                clearInterval(pollInterval);
                pollInterval = setInterval(poll, message.settings.pollingRate);
            }
            // Update other settings
            if (message.settings.showWindowsOfHiddenApps !== undefined) {
                showWindowsOfHiddenApps = message.settings.showWindowsOfHiddenApps;
            }
            if (message.settings.showUnmatchedWindows !== undefined) {
                showUnmatchedWindows = message.settings.showUnmatchedWindows;
            }
            renderDashboard();
        }
    });
}

function poll() {
    // 1. Get App State
    chrome.runtime.sendMessage({ type: "GET_STATE" }, (response) => {
        if (chrome.runtime.lastError) return;
        
        if (response && typeof response === 'object' && 'data' in response) {
            currentAppState = response.data || [];
            isConnected = response.connected;
        } else {
            currentAppState = response || [];
        }
        
        // 2. Get Opened Targets (to know what we are tracking)
        chrome.runtime.sendMessage({ type: "GET_OPENED_TARGETS" }, (targets) => {
            openedTargetIds = targets || [];
        });

        // 3. Get Rules
        chrome.runtime.sendMessage({ type: "GET_RULES" }, (rules) => {
            autoOpenRules = rules || [];
        });

        // 4. Get Hidden Rules
        chrome.storage.local.get(['hiddenRules', 'hiddenAppRules', 'settings'], (result) => {
            hiddenRules = result.hiddenRules || [];
            hiddenAppRules = result.hiddenAppRules || [];
            if (result.settings) {
                if (result.settings.showWindowsOfHiddenApps !== undefined) showWindowsOfHiddenApps = result.settings.showWindowsOfHiddenApps;
                if (result.settings.showUnmatchedWindows !== undefined) showUnmatchedWindows = result.settings.showUnmatchedWindows;
            }
        });

        // 5. Get All Targets (Windows)
        // We fetch this directly from the debugger port to get the list of all inspectable pages
        fetch('http://localhost:54284/json/list')
            .then(res => res.json())
            .then(targets => {
                // isConnected is determined by GET_STATE/APP_STATE (connection to Packages)
                currentTargets = targets.filter(t => t.type === 'page' && !t.url.startsWith('devtools://'));
                renderDashboard();
            })
            .catch(err => {
                isConnected = false;
                renderDashboard();
            });
    });
}

async function fetchManifest(appId, version) {
    fetchingManifests.add(appId);
    
    // Strategy: Fetch via Background Script (Protocol Handler via CDP)
    chrome.runtime.sendMessage({ type: "FETCH_MANIFEST", appId }, (response) => {
        if (response && response.success) {
            manifestCache.set(appId, { data: response.data });
        } else {
            // Store error with timestamp to allow retries
            manifestCache.set(appId, { error: true, timestamp: Date.now() });
        }
        fetchingManifests.delete(appId);
        renderDashboard();
    });
}

// 2. Create the UI
function renderDashboard() {
    const root = document.getElementById('ow-enhancer-root');
    if (!root) return;

    // Pre-process metadata
    processTargetMetadata();

    let html = `
        <div class="dashboard">
            <header>
                <div class="title-container">
                    <img src="${chrome.runtime.getURL('assets/icons/icon128.png')}" class="header-icon" alt="Logo">
                    <h1>Overwolf DevCools by Tsury <span class="version">v${extensionVersion}</span> <span class="beta-badge">BETA</span></h1>
                </div>
                <div class="header-controls">
                    <button id="github-btn" class="github-btn" title="Open on GitHub">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>
                    </button>
                    <div class="header-separator"></div>
                    <button id="settings-btn" class="settings-btn" title="Open Settings">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                    </button>
                    <button id="theme-toggle" class="theme-toggle-btn" title="Toggle Theme">
                        ${currentTheme === 'dark' 
                            ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>' 
                            : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>'}
                    </button>
                    <div class="status" id="connection-status"></div>
                </div>
            </header>
            
            <div class="packages-actions-bar">
                <button id="install-opk-btn" class="btn-action-large">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>
                    <span>Install OPK</span>
                </button>
                <button id="load-unpacked-btn" class="btn-action-large">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                    <span>Load Unpacked</span>
                </button>
                <button id="pack-btn" class="btn-action-large">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                    <span>Pack Extension</span>
                </button>
                <div class="separator-vertical"></div>
                <button id="update-packages-btn" class="btn-action-large btn-icon-only" title="Update packages now">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>
                </button>
            </div>

            <div class="main-content">
                <section class="apps-section">
                    <h2>Apps ${getAppsCountHtml()}</h2>
                    <div id="apps-list">
                        ${renderAppsList(currentAppState)}
                    </div>
                </section>
                
                <section class="targets-section">
                    <h2>Windows ${getTargetsCountHtml()}</h2>
                    <div id="targets-list">
                        ${renderTargetsList(currentTargets)}
                    </div>
                </section>
            </div>
        </div>
    `;
    
    if (html === lastRenderedHTML) {
        updateStatus();
        return;
    }

    lastRenderedHTML = html;
    root.innerHTML = html;
    
    attachListeners();
    updateStatus();
}

function processTargetMetadata() {
    targetMetadata.clear();
    if (!currentAppState || !currentTargets) return;

    currentAppState.forEach(app => {
        // 1. Check Manifest Cache
        let manifest = manifestCache.get(app.id);
        
        if (!manifest) {
            // Trigger fetch if not already fetching
            if (!fetchingManifests.has(app.id)) {
                fetchManifest(app.id, app.version);
            }
            return; // Cannot match without manifest
        }

        if (manifest.error) {
            // Retry after 10 seconds if there was an error
            if (manifest.timestamp && (Date.now() - manifest.timestamp > 10000)) {
                manifestCache.delete(app.id);
                // Fall through to fetch logic below
            } else {
                return;
            }
        }

        // 2. Filter targets for this app
        let availableTargets = currentTargets.filter(t => 
            t.url.includes(app.id) && 
            t.url.startsWith('overwolf-extension://')
        );

        // 3. Match using Manifest
        const manifestJson = manifest.data || {};
        // Handle standard manifest structure and the nested 'data' structure seen in logs
        const windows = manifestJson.windows || manifestJson.data?.windows || {};
        
        Object.entries(windows).forEach(([winName, winDef]) => {
            const file = winDef.file; 
            if (!file) return;

            // Normalize file path for matching
            // Manifest file paths are relative to extension root
            // Target URLs are absolute: overwolf-extension://<ID>/<FILE>
            
            const matchIndex = availableTargets.findIndex(t => {
                try {
                    const urlObj = new URL(t.url);
                    // Check if pathname ends with the file definition
                    // We use endsWith to handle potential leading slashes or subfolders
                    // e.g. manifest: "windows/index.html", url: "/windows/index.html"
                    const path = urlObj.pathname.startsWith('/') ? urlObj.pathname.substring(1) : urlObj.pathname;
                    return path === file;
                } catch (e) { return false; }
            });

            if (matchIndex !== -1) {
                const matchedTarget = availableTargets[matchIndex];
                
                targetMetadata.set(matchedTarget.id, {
                    niceName: winName,
                    appName: app.name,
                    appId: app.id,
                    appIcon: app.icon
                });

                // Remove from available targets
                availableTargets.splice(matchIndex, 1);
            }
        });
    });
}

function getAppsCountHtml() {
    if (!currentAppState) return '';
    const total = currentAppState.length;
    const hidden = currentAppState.filter(app => hiddenAppRules.some(r => (typeof r === 'string' ? r : r.id) === app.id)).length;
    
    if (total === 0) return '';
    
    const visible = total - hidden;
    let html = `<span class="count-badge">${visible}</span>`;
    if (hidden > 0) {
        html += ` <span class="hidden-count-badge">(+${hidden} hidden)</span>`;
    }
    return html;
}

function getTargetsCountHtml() {
    if (!currentTargets) return '';
    const total = currentTargets.length;
    const hidden = currentTargets.filter(t => {
        // Check specific window hidden rules
        const isHiddenByRule = hiddenRules.some(rule => 
            (rule.titlePattern ? t.title.includes(rule.titlePattern) : true) && 
            (rule.urlPattern ? t.url.includes(rule.urlPattern) : true)
        );
        if (isHiddenByRule) return true;

        const meta = targetMetadata.get(t.id);

        // Check if hidden by app association
        if (!showWindowsOfHiddenApps) {
            if (meta && hiddenAppRules.some(r => (typeof r === 'string' ? r : r.id) === meta.appId)) {
                return true;
            }
        }

        // Check if hidden because unmatched
        if (!showUnmatchedWindows) {
            if (!meta) {
                return true;
            }
        }

        return false;
    }).length;
    
    if (total === 0) return '';
    
    const visible = total - hidden;
    let html = `<span class="count-badge">${visible}</span>`;
    if (hidden > 0) {
        html += ` <span class="hidden-count-badge">(+${hidden} hidden)</span>`;
    }
    return html;
}

function updateStatus() {
    const el = document.getElementById('connection-status');
    if (el) {
        if (isConnected) {
            if (currentAppState && currentAppState.length > 0) {
                el.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
                    <span>Connected</span>
                `;
                el.className = 'status status-connected';
                el.title = "Connected to Packages";
            } else {
                el.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                    <span>No Apps</span>
                `;
                el.className = 'status status-warning';
                el.title = "Connected but no apps found";
            }
        } else {
            el.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                <span>Disconnected</span>
            `;
            el.className = 'status status-disconnected';
            el.title = "Open Packages";
        }
    }
}

function getColorForString(str) {
    const palette = [
        '#FF6B6B', // Red
        '#4ECDC4', // Teal
        '#45B7D1', // Blue
        '#96CEB4', // Green
        '#FFEEAD', // Yellow
        '#D4A5A5', // Pink
        '#9B59B6', // Purple
        '#3498DB', // Blue
        '#E67E22', // Orange
        '#2ECC71'  // Green
    ];
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % palette.length;
    return palette[index];
}

function renderAppsList(apps) {
    if (!isConnected) return '<div class="empty-state">Waiting for Packages window...<br><span style="font-size:12px; opacity:0.7; display:block; margin-top:5px">Please open the Overwolf Packages window to continue.</span></div>';
    if (!apps || apps.length === 0) return '<div class="empty-state">No apps found. Ensure the Packages window is open.</div>';
    
    const visibleApps = apps.filter(app => !hiddenAppRules.some(r => (typeof r === 'string' ? r : r.id) === app.id));

    if (visibleApps.length === 0 && apps.length > 0) {
        return '<div class="empty-state">All apps are hidden. Check extension settings to restore them.</div>';
    }

    return visibleApps.map(app => {
        // Parse buttons
        const launchBtn = app.buttons.find(b => b.text === 'Launch');
        const relaunchBtn = app.buttons.find(b => b.text === 'Relaunch');
        const uninstallBtn = app.buttons.find(b => b.text === 'Uninstall');
        const toggleBtn = app.buttons.find(b => b.type === 'toggle');
        
        const mainBtn = launchBtn || relaunchBtn;
        const isEnabled = toggleBtn ? toggleBtn.text === 'Disable' : false; // If text is Disable, it means it's currently Enabled
        const isConfirmingUninstall = uninstallConfirmations[app.id];

        return `
        <div class="app-card">
            <div class="app-icon-container">
                <img src="${app.icon}" alt="${app.name}" class="app-icon" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij48cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIGZpbGw9IiMzMzMiLz48dGV4dCB4PSIzMiIgeT0iMzIiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjEyIiBmaWxsPSIjODg4IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+T1c8L3RleHQ+PC9zdmc+'">
            </div>
            <div class="app-details">
                <div class="app-header">
                    <h3>${app.name}</h3>
                    ${app.path ? '<span class="badge badge-unpacked">UNPACKED</span>' : ''}
                </div>
                <div class="app-meta">
                    <span class="meta-item author"><i class="icon-user"></i> ${app.author}</span>
                    <span class="meta-separator">•</span>
                    <span class="meta-item version">v${app.version}</span>
                </div>
                <div class="app-row id-row">
                    <span class="mono-text" title="${app.id}">${app.id}</span>
                    <button class="copy-btn" data-copy="${app.id}" title="Copy UID">
                        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><title>Copy UID</title><path fill-rule="evenodd" clip-rule="evenodd" d="M6 14V2H18V14H6ZM8 4H16V12H8V4Z" fill="currentcolor"></path><path d="M4 6V16H14V18H2V6H4Z" fill="currentcolor"></path></svg>
                    </button>
                </div>
                ${app.path ? `<div class="app-row path-row"><button class="path-btn" data-path="${app.path}" title="Open in Explorer">${app.path}</button></div>` : ''}
                
                <div class="app-windows-list" style="${(!app.appWindows || app.appWindows.length === 0) ? 'visibility: hidden;' : ''}">
                    <span class="windows-label">Inspect:</span>
                    ${(app.appWindows || [])
                        .map(w => {
                            // Find if we have a matching target for this window using metadata
                            const matchId = Array.from(targetMetadata.entries())
                                .find(([tid, meta]) => meta.appId === app.id && meta.niceName === w)?.[0];
                            const match = matchId ? currentTargets.find(t => t.id === matchId) : null;
                            return { w, match };
                        })
                        .sort((a, b) => {
                            // Sort matched first, then disabled
                            if (a.match && !b.match) return -1;
                            if (!a.match && b.match) return 1;
                            return 0;
                        })
                        .map(({w, match}) => {
                        if (match) {
                            const color = getColorForString(w);
                            return `<button class="window-link-btn matched" 
                                style="color: ${color}; border-color: ${color}; background: ${color}1a"
                                data-appid="${app.id}" 
                                data-window="${w}"
                                data-targetid="${match.id}"
                                data-devtools="${match.devtoolsFrontendUrl}"
                                title="Open DevTools for ${w}">${w}</button>`;
                        } else {
                            return `<button class="window-link-btn disabled" 
                                disabled
                                data-appid="${app.id}" 
                                data-window="${w}"
                                title="DevTools unavailable">${w}</button>`;
                        }
                    }).join(', ')}
                </div>
            </div>
            <div class="app-actions">
                ${mainBtn ? `
                <button class="btn action-btn ${mainBtn.text === 'Launch' ? 'btn-launch' : 'btn-relaunch'}" 
                    data-appid="${app.id}" 
                    data-action="${mainBtn.text}" 
                    ${mainBtn.enabled ? '' : 'disabled'}
                    title="${mainBtn.text} App">
                    ${mainBtn.text}
                </button>` : ''}

                ${toggleBtn ? `
                <button class="btn action-btn ${isEnabled ? 'btn-disable-state' : 'btn-enable-state'}" 
                    data-appid="${app.id}" 
                    data-action="${isEnabled ? 'Disable' : 'Enable'}"
                    title="${isEnabled ? 'Disable App' : 'Enable App'}">
                    ${isEnabled ? 'Disable' : 'Enable'}
                </button>` : ''}

                <div class="target-controls-row">
                    ${uninstallBtn ? `
                    <button class="btn-icon-small uninstall-btn ${isConfirmingUninstall ? 'confirm-state' : ''}" 
                        data-appid="${app.id}" 
                        title="${isConfirmingUninstall ? 'Click again to confirm Uninstall' : 'Uninstall App'}">
                        ${isConfirmingUninstall ? 
                            `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><title>${isConfirmingUninstall ? 'Click again to confirm Uninstall' : 'Uninstall App'}</title><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>` : 
                            `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><title>${isConfirmingUninstall ? 'Click again to confirm Uninstall' : 'Uninstall App'}</title><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`
                        }
                    </button>` : ''}

                    <button class="btn-icon-small refresh-btn" 
                        data-appid="${app.id}"
                        title="Refresh App (Disable & Re-enable)">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><title>Refresh App (Disable & Re-enable)</title><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                    </button>

                    <button class="btn-icon-small hide-app-btn" 
                        data-id="${app.id}" 
                        data-name="${app.name}"
                        title="Hide this app (Manage in Extension Settings)">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><title>Hide this app (Manage in Extension Settings)</title><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                    </button>
                </div>
            </div>
        </div>
    `}).join('');
}

function decodeHtml(html) {
    const txt = document.createElement("textarea");
    txt.innerHTML = html;
    return txt.value;
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

function renderTargetsList(targets) {
    if (!isConnected) return '<div class="empty-state">Waiting for Packages window...<br><span style="font-size:12px; opacity:0.7; display:block; margin-top:5px">Please open the Overwolf Packages window to continue.</span></div>';
    if (!targets || targets.length === 0) return '<div class="empty-state">No active windows found.</div>';
    
    const visibleTargets = targets.filter(t => {
        // 1. Check specific window hidden rules
        const isHiddenByRule = hiddenRules.some(rule => isRuleMatch(rule, t.title, t.url));
        if (isHiddenByRule) return false;

        const meta = targetMetadata.get(t.id);

        // 2. Check if hidden by app association (if setting enabled)
        if (!showWindowsOfHiddenApps) {
            if (meta && hiddenAppRules.some(r => (typeof r === 'string' ? r : r.id) === meta.appId)) {
                return false;
            }
        }

        // 3. Check if hidden because unmatched (if setting enabled)
        if (!showUnmatchedWindows) {
            if (!meta) {
                return false;
            }
        }

        return true;
    });

    // Sort targets
    visibleTargets.sort((a, b) => {
        const metaA = targetMetadata.get(a.id);
        const metaB = targetMetadata.get(b.id);

        // 1. Put matched targets before unmatched targets
        if (metaA && !metaB) return -1;
        if (!metaA && metaB) return 1;
        if (!metaA && !metaB) return a.title.localeCompare(b.title); // Sort unmatched by title

        // 2. Group by App (using order in currentAppState)
        const appIndexA = currentAppState.findIndex(app => app.id === metaA.appId);
        const appIndexB = currentAppState.findIndex(app => app.id === metaB.appId);
        
        if (appIndexA !== appIndexB) {
            return appIndexA - appIndexB;
        }

        // 3. Sort by Window Order within App
        const app = currentAppState[appIndexA];
        if (app && app.appWindows) {
            const winIndexA = app.appWindows.indexOf(metaA.niceName);
            const winIndexB = app.appWindows.indexOf(metaB.niceName);
            return winIndexA - winIndexB;
        }

        return 0;
    });

    if (visibleTargets.length === 0 && targets.length > 0) {
        return '<div class="empty-state">All active windows are hidden. Check extension settings to restore them.</div>';
    }

    return visibleTargets.map(t => {
        // Normalize title for matching (decode HTML entities like &amp;)
        const normalizedTitle = decodeHtml(t.title);
        const ruleUrl = getRuleUrl(t.url);
        // Use raw title for rule lookup to match how rules are created and stored
        const rule = autoOpenRules.find(r => isRuleMatch(r, t.title, t.url)) || { autoOpen: false, autoClose: false, autoFocus: false };
        const isOpened = openedTargetIds.includes(t.id);
        
        // Use metadata if available
        const meta = targetMetadata.get(t.id);
        
        let headerContent;
        let urlDisplayHtml = t.url;

        if (meta) {
            const color = getColorForString(meta.niceName);
            const iconHtml = meta.appIcon ? `<img src="${meta.appIcon}" style="width: 18px; height: 18px; margin-right: 8px; border-radius: 4px; flex-shrink: 0;">` : '';
            
            let filename = '';
            let paramsHtml = '';
            let parsedSuccessfully = false;

            // Parse URL for matched windows
            try {
                const urlObj = new URL(t.url);
                filename = urlObj.pathname.substring(1); // remove leading /
                
                const params = Array.from(urlObj.searchParams.entries());
                if (params.length > 0) {
                    paramsHtml = params.map(([key, value]) => 
                        `<span class="param-badge"><span class="param-key">${key}</span>=<span class="param-val">${value}</span></span>`
                    ).join('');
                }
                parsedSuccessfully = true;
            } catch (e) {
                // Fallback
            }

            if (parsedSuccessfully) {
                headerContent = `
                    <div style="display: flex; align-items: center; min-width: 0; overflow: hidden;">
                        ${iconHtml}
                        <div style="display: flex; align-items: baseline; overflow: hidden;">
                            <span style="color: ${color}; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${meta.niceName}">${meta.niceName}</span>
                            <span style="color: #888; font-size: 11px; margin-left: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">(${filename})</span>
                        </div>
                    </div>
                `;
                urlDisplayHtml = paramsHtml;
            } else {
                headerContent = `
                    <div style="display: flex; align-items: center; min-width: 0; overflow: hidden;">
                        ${iconHtml}
                        <span style="color: ${color}; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${meta.niceName}">${meta.niceName}</span>
                    </div>
                `;
                urlDisplayHtml = t.url;
            }

        } else {
            headerContent = `<span title="${t.title}">${t.title}</span>`;
        }

        return `
        <div class="target-card">
            <div class="target-info">
                <h3 style="display: flex; align-items: center; justify-content: space-between;">${headerContent}</h3>
                <p class="target-url" title="${t.url}">${urlDisplayHtml}</p>
            </div>
            <div class="target-actions">
                <div style="display: flex; gap: 4px;">
                    <button class="btn inspect-btn ${isOpened ? 'btn-success' : ''}" 
                        data-id="${t.id}" 
                        data-title="${encodeURIComponent(t.title)}" 
                        data-url="${encodeURIComponent(t.url)}" 
                        data-devtools="${t.devtoolsFrontendUrl}">
                        ${isOpened ? 'Focus' : 'Inspect'}
                    </button>
                    ${isOpened ? `
                    <button class="btn-icon-small close-devtools-btn" 
                        data-id="${t.id}"
                        title="Close DevTools">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>` : ''}
                </div>
                
                <div class="target-controls-row">
                    <button class="btn-icon-small toggle-btn ${rule.autoOpen ? 'active' : ''} ${rule.autoFocus ? 'auto-focus' : ''}" 
                            data-title="${encodeURIComponent(t.title)}" 
                            data-url="${encodeURIComponent(ruleUrl)}"
                            data-flag="autoOpen"
                            data-value="${!rule.autoOpen}"
                            data-autofocus="${rule.autoFocus}"
                            title="${rule.autoFocus ? 'Auto-Open & Focus: Automatically open and focus DevTools' : 'Auto-Open: Automatically open DevTools when this window appears\n(CTRL+Click to Auto-Open & Focus)'}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><title>${rule.autoFocus ? 'Auto-Open & Focus' : 'Auto-Open'}</title><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                    </button>

                    <button class="btn-icon-small toggle-btn ${rule.autoClose ? 'active' : ''}" 
                            data-title="${encodeURIComponent(t.title)}" 
                            data-url="${encodeURIComponent(ruleUrl)}"
                            data-flag="autoClose"
                            data-value="${!rule.autoClose}"
                            title="Auto-Close: Automatically close DevTools when this window closes">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><title>Auto-Close: Automatically close DevTools when this window closes</title><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="9" x2="15" y2="15"></line><line x1="15" y1="9" x2="9" y2="15"></line></svg>
                    </button>

                    <button class="btn-icon-small hide-btn" 
                        data-title="${encodeURIComponent(t.title)}" 
                        data-url="${encodeURIComponent(ruleUrl)}"
                        data-nicename="${meta ? meta.niceName : ''}"
                        title="Hide this window (Manage in Extension Settings)">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><title>Hide this window (Manage in Extension Settings)</title><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                    </button>
                </div>
            </div>
        </div>
    `}).join('');
}

function attachListeners() {
    // Package Control Buttons
    const installOpkBtn = document.getElementById('install-opk-btn');
    if (installOpkBtn) {
        installOpkBtn.addEventListener('click', () => {
            chrome.runtime.sendMessage({ type: "INSTALL_OPK" });
        });
    }
    const loadUnpackedBtn = document.getElementById('load-unpacked-btn');
    if (loadUnpackedBtn) {
        loadUnpackedBtn.addEventListener('click', () => {
            chrome.runtime.sendMessage({ type: "LOAD_UNPACKED" });
        });
    }
    const packBtn = document.getElementById('pack-btn');
    if (packBtn) {
        packBtn.addEventListener('click', () => {
            chrome.runtime.sendMessage({ type: "PACK_EXTENSION" });
        });
    }
    const updatePackagesBtn = document.getElementById('update-packages-btn');
    if (updatePackagesBtn) {
        updatePackagesBtn.addEventListener('click', () => {
            chrome.runtime.sendMessage({ type: "UPDATE_PACKAGES" });
        });
    }

    // GitHub Button
    const githubBtn = document.getElementById('github-btn');
    if (githubBtn) {
        githubBtn.addEventListener('click', () => {
            chrome.runtime.sendMessage({ type: "OPEN_URL", url: "https://github.com/Tsury/ow-devcools" });
        });
    }

    // Settings Button
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            chrome.runtime.sendMessage({ type: "OPEN_POPUP" });
        });
    }

    // Theme Toggle
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) {
        themeBtn.addEventListener('click', toggleTheme);
    }

    // App Actions
    const actionBtns = document.querySelectorAll('.action-btn');
    actionBtns.forEach((btn, index) => {
        btn.addEventListener('click', (e) => {
            const btnEl = e.currentTarget;
            const appId = btnEl.dataset.appid;
            const action = btnEl.dataset.action;
            chrome.runtime.sendMessage({ type: "CONTROL_APP", appId, action });
        });
    });

    // Uninstall Button (with confirmation)
    const uninstallBtns = document.querySelectorAll('.uninstall-btn');
    uninstallBtns.forEach((btn, index) => {
        btn.addEventListener('click', (e) => {
            const btnEl = e.target.closest('.uninstall-btn');
            const appId = btnEl.dataset.appid;
            
            if (uninstallConfirmations[appId]) {
                // Confirmed
                chrome.runtime.sendMessage({ type: "CONTROL_APP", appId, action: "Uninstall" });
                delete uninstallConfirmations[appId];
                renderDashboard();
            } else {
                // First click
                uninstallConfirmations[appId] = true;
                renderDashboard();
                
                // Auto-revert after 5 seconds
                setTimeout(() => {
                    if (uninstallConfirmations[appId]) {
                        delete uninstallConfirmations[appId];
                        renderDashboard();
                    }
                }, 5000);
            }
        });
    });

    // Window Link Buttons (Inspect)
    const windowLinkBtns = document.querySelectorAll('.window-link-btn');
    windowLinkBtns.forEach((btn, index) => {
        btn.addEventListener('click', (e) => {
            const btnEl = e.target.closest('.window-link-btn');
            const devtoolsUrl = btnEl.dataset.devtools;
            
            if (devtoolsUrl) {
                // Open directly
                const targetId = btnEl.dataset.targetid;
                const winName = btnEl.dataset.window;
                chrome.runtime.sendMessage({ 
                    type: "OPEN_DEVTOOLS", 
                    targetId, 
                    title: winName, 
                    url: "about:blank", 
                    devtoolsFrontendUrl: devtoolsUrl 
                });
            } else {
                // Fallback to old method (click button in Packages)
                const appId = btnEl.dataset.appid;
                const winName = btnEl.dataset.window;
                chrome.runtime.sendMessage({ type: "CONTROL_APP", appId, action: "InspectWindow", extra: winName });
            }
        });
    });

    // Inspect Buttons
    const inspectBtns = document.querySelectorAll('.inspect-btn');
    inspectBtns.forEach((btn, index) => {
        btn.addEventListener('click', (e) => {
            const btnEl = e.currentTarget;
            const targetId = btnEl.dataset.id;
            const title = decodeURIComponent(btnEl.dataset.title);
            const url = decodeURIComponent(btnEl.dataset.url);
            const devtoolsFrontendUrl = btnEl.dataset.devtools;
            
            chrome.runtime.sendMessage({ 
                type: "OPEN_DEVTOOLS", 
                targetId, 
                title, 
                url, 
                devtoolsFrontendUrl 
            });
        });
    });

    // Close DevTools Buttons
    const closeDevToolsBtns = document.querySelectorAll('.close-devtools-btn');
    closeDevToolsBtns.forEach((btn) => {
        btn.addEventListener('click', (e) => {
            const btnEl = e.currentTarget;
            const targetId = btnEl.dataset.id;
            chrome.runtime.sendMessage({ type: "CLOSE_DEVTOOLS_TAB", targetId });
        });
    });

    // Refresh Buttons
    const refreshBtns = document.querySelectorAll('.refresh-btn');
    refreshBtns.forEach((btn, index) => {
        btn.addEventListener('click', (e) => {
            const btnEl = e.target.closest('.refresh-btn');
            const appId = btnEl.dataset.appid;
            chrome.runtime.sendMessage({ type: "REFRESH_APP", appId });
        });
    });

    // Hide Buttons (Targets)
    const hideBtns = document.querySelectorAll('.hide-btn');
    hideBtns.forEach((btn, index) => {
        btn.addEventListener('click', (e) => {
            const btnEl = e.target.closest('.hide-btn');
            const title = decodeURIComponent(btnEl.dataset.title);
            const url = decodeURIComponent(btnEl.dataset.url);
            const niceName = btnEl.dataset.nicename;
            
            // Check for duplicates
            const exists = hiddenRules.some(r => r.titlePattern === title && r.urlPattern === url);
            if (!exists) {
                const newRule = { titlePattern: title, urlPattern: url, niceName: niceName || undefined };
                hiddenRules.push(newRule);
                
                chrome.storage.local.set({ hiddenRules }, () => {
                    renderDashboard();
                });
            }
        });
    });

    // Hide Buttons (Apps)
    const hideAppBtns = document.querySelectorAll('.hide-app-btn');
    hideAppBtns.forEach((btn, index) => {
        btn.addEventListener('click', (e) => {
            const btnEl = e.target.closest('.hide-app-btn');
            const appId = btnEl.dataset.id;
            const appName = btnEl.dataset.name;
            
            if (!hiddenAppRules.some(r => (typeof r === 'string' ? r : r.id) === appId)) {
                hiddenAppRules.push({ id: appId, name: appName });
                chrome.storage.local.set({ hiddenAppRules }, () => {
                    renderDashboard();
                });
            }
        });
    });

    // Toggle Buttons (Auto-Open / Auto-Close)
    const toggleBtns = document.querySelectorAll('.toggle-btn');
    toggleBtns.forEach((btn, index) => {
        btn.addEventListener('click', (e) => {
            const btnEl = e.currentTarget;
            const title = decodeURIComponent(btnEl.dataset.title);
            const url = decodeURIComponent(btnEl.dataset.url);
            const flag = btnEl.dataset.flag;
            
            if (flag === 'autoOpen' && e.ctrlKey) {
                // Handle CTRL + Click for Auto-Open & Focus
                const currentAutoFocus = btnEl.dataset.autofocus === 'true';
                const newValue = !currentAutoFocus; // Toggle focus state

                chrome.runtime.sendMessage({ 
                    type: "SET_AUTO_FOCUS", 
                    titlePattern: title, 
                    urlPattern: url,
                    value: newValue
                });

                // Optimistic update
                // Reset all other autoFocus
                autoOpenRules.forEach(r => r.autoFocus = false);
                
                let rule = autoOpenRules.find(r => isRuleMatch(r, title, url));
                if (!rule) {
                    rule = { titlePattern: title, urlPattern: url, autoOpen: true, autoClose: false, autoFocus: newValue };
                    autoOpenRules.push(rule);
                } else {
                    rule.autoOpen = true; // Ensure open is true
                    rule.autoFocus = newValue;
                }
                renderDashboard();

            } else {
                // Normal Click
                const value = btnEl.dataset.value === 'true';
                
                chrome.runtime.sendMessage({ 
                    type: "TOGGLE_RULE_FLAG", 
                    titlePattern: title, 
                    urlPattern: url,
                    flag,
                    value
                });
                
                // Optimistic update
                let rule = autoOpenRules.find(r => isRuleMatch(r, title, url));
                if (!rule) {
                    rule = { titlePattern: title, urlPattern: url, autoOpen: false, autoClose: false, autoFocus: false };
                    autoOpenRules.push(rule);
                }
                rule[flag] = value;
                
                // If turning off autoOpen, also turn off autoFocus
                if (flag === 'autoOpen' && !value) {
                    rule.autoFocus = false;
                }
                
                renderDashboard();
            }
        });
    });

    // Global Key Listeners for CTRL visual feedback
    if (!window.ctrlListenersAttached) {
        window.ctrlListenersAttached = true;
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Control') {
                document.body.classList.add('ctrl-pressed');
            }
        });
        document.addEventListener('keyup', (e) => {
            if (e.key === 'Control') {
                document.body.classList.remove('ctrl-pressed');
            }
        });
        // Handle focus loss (e.g. alt-tab)
        window.addEventListener('blur', () => {
            document.body.classList.remove('ctrl-pressed');
        });
    }

    // Copy Buttons
    const copyBtns = document.querySelectorAll('.copy-btn');
    copyBtns.forEach((btn, index) => {
        btn.addEventListener('click', (e) => {
            const text = e.target.closest('.copy-btn').dataset.copy;
            navigator.clipboard.writeText(text).then(() => {
                const originalHTML = btn.innerHTML;
                btn.innerHTML = '<span style="font-size:10px">Copied!</span>';
                setTimeout(() => {
                    btn.innerHTML = originalHTML;
                }, 1500);
            });
        });
    });

    // Path Buttons
    const pathBtns = document.querySelectorAll('.path-btn');
    pathBtns.forEach((btn, index) => {
        btn.addEventListener('click', (e) => {
            const path = e.currentTarget.dataset.path;
            chrome.runtime.sendMessage({ type: "OPEN_FOLDER", path });
        });
    });
}

// Listen for updates from Background
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "APP_STATE") {
        currentAppState = message.data;
        isConnected = message.connected;
        renderDashboard();
    }
    if (message.type === "OPENED_TARGETS_UPDATE") {
        openedTargetIds = message.data;
        renderDashboard();
    }
});

// Listen for storage changes (e.g. from Popup)
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        if (changes.hiddenRules) {
            hiddenRules = changes.hiddenRules.newValue || [];
            renderDashboard();
        }
        if (changes.hiddenAppRules) {
            hiddenAppRules = changes.hiddenAppRules.newValue || [];
            renderDashboard();
        }
        if (changes.settings) {
            const newSettings = changes.settings.newValue || {};
            if (newSettings.showWindowsOfHiddenApps !== undefined) {
                showWindowsOfHiddenApps = newSettings.showWindowsOfHiddenApps;
            }
            if (newSettings.showUnmatchedWindows !== undefined) {
                showUnmatchedWindows = newSettings.showUnmatchedWindows;
            }
            renderDashboard();
        }
    }
});

