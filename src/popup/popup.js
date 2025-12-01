document.addEventListener('DOMContentLoaded', () => {
    const rateInput = document.getElementById('pollingRate');
    const showHiddenAppsWindowsCheckbox = document.getElementById('showWindowsOfHiddenApps');
    const showUnmatchedCheckbox = document.getElementById('showUnmatchedWindows');
    const closeBtn = document.getElementById('closeBtn');
    const status = document.getElementById('status');
    const hiddenList = document.getElementById('hidden-list');
    const hiddenAppsList = document.getElementById('hidden-apps-list');
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    
    // Modal Elements
    const downloadScriptBtn = document.getElementById('downloadScriptBtn');
    const scriptModal = document.getElementById('scriptModal');
    const closeModalSpan = document.querySelector('.close-modal');

    let hiddenRules = [];
    let hiddenAppRules = [];
    let currentTheme = 'dark';

    // Modal Logic
    downloadScriptBtn.addEventListener('click', () => {
        scriptModal.style.display = "block";
    });

    closeModalSpan.addEventListener('click', () => {
        scriptModal.style.display = "none";
    });

    window.addEventListener('click', (event) => {
        if (event.target == scriptModal) {
            scriptModal.style.display = "none";
        }
    });

    // Theme Logic
    function initTheme() {
        chrome.storage.local.get(['theme'], (result) => {
            if (result.theme) {
                currentTheme = result.theme;
            } else {
                if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
                    currentTheme = 'light';
                }
            }
            applyTheme();
        });
    }

    function applyTheme() {
        document.documentElement.setAttribute('data-theme', currentTheme);
        updateThemeIcon();
    }

    function toggleTheme() {
        currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
        chrome.storage.local.set({ theme: currentTheme });
        applyTheme();
    }

    function updateThemeIcon() {
        if (currentTheme === 'dark') {
            themeToggleBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
        } else {
            themeToggleBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
        }
    }

    themeToggleBtn.addEventListener('click', toggleTheme);
    initTheme();

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.theme) {
            currentTheme = changes.theme.newValue;
            applyTheme();
        }
    });

    // Load settings
    chrome.storage.local.get(['settings', 'hiddenRules', 'hiddenAppRules'], (result) => {
        if (result.settings) {
            if (result.settings.pollingRate) {
                rateInput.value = result.settings.pollingRate;
            }
            if (result.settings.showWindowsOfHiddenApps !== undefined) {
                showHiddenAppsWindowsCheckbox.checked = result.settings.showWindowsOfHiddenApps;
            }
            if (result.settings.showUnmatchedWindows !== undefined) {
                showUnmatchedCheckbox.checked = result.settings.showUnmatchedWindows;
            }
        }
        if (result.hiddenRules) {
            hiddenRules = result.hiddenRules;
            renderHiddenList();
        }
        if (result.hiddenAppRules) {
            hiddenAppRules = result.hiddenAppRules;
        }
        renderHiddenList();
        renderHiddenAppsList();
    });

    function renderHiddenList() {
        if (hiddenRules.length === 0) {
            hiddenList.innerHTML = '<div class="empty-msg">No hidden windows.</div>';
            return;
        }

        hiddenList.innerHTML = hiddenRules.map((rule, index) => `
            <div class="hidden-item">
                <div class="hidden-info">
                    <div class="hidden-title">${rule.niceName || rule.titlePattern || 'Any Title'}</div>
                    <div class="hidden-url">${rule.urlPattern || 'Any URL'}</div>
                </div>
                <button class="restore-btn" data-index="${index}" title="Restore this window">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                </button>
            </div>
        `).join('');

        // Attach listeners
        hiddenList.querySelectorAll('.restore-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.target.closest('.restore-btn').dataset.index);
                hiddenRules.splice(index, 1);
                chrome.storage.local.set({ hiddenRules }, () => {
                    renderHiddenList();
                    showStatus('Window restored', 'success');
                });
            });
        });
    }

    function renderHiddenAppsList() {
        if (hiddenAppRules.length === 0) {
            hiddenAppsList.innerHTML = '<div class="empty-msg">No hidden apps.</div>';
            return;
        }

        hiddenAppsList.innerHTML = hiddenAppRules.map((rule, index) => `
            <div class="hidden-item">
                <div class="hidden-info">
                    <div class="hidden-title">${(typeof rule === 'string' ? rule : rule.name) || rule.id || 'Unknown App'}</div>
                </div>
                <button class="restore-app-btn restore-btn" data-index="${index}" title="Restore this app">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                </button>
            </div>
        `).join('');

        // Attach listeners
        hiddenAppsList.querySelectorAll('.restore-app-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.target.closest('.restore-app-btn').dataset.index);
                hiddenAppRules.splice(index, 1);
                chrome.storage.local.set({ hiddenAppRules }, () => {
                    renderHiddenAppsList();
                    showStatus('App restored', 'success');
                });
            });
        });
    }

    function saveSettings() {
        const pollingRate = parseInt(rateInput.value, 10);
        const showWindowsOfHiddenApps = showHiddenAppsWindowsCheckbox.checked;
        const showUnmatchedWindows = showUnmatchedCheckbox.checked;
        
        if (pollingRate < 500) {
            showStatus('Rate must be at least 500ms', 'error');
            return;
        }

        chrome.storage.local.get(['settings'], (result) => {
            const currentSettings = result.settings || {};
            const newSettings = { ...currentSettings, pollingRate, showWindowsOfHiddenApps, showUnmatchedWindows };
            
            chrome.storage.local.set({ settings: newSettings }, () => {
                // Notify background script to update immediately
                chrome.runtime.sendMessage({ type: "SETTINGS_UPDATED", settings: newSettings });
                showStatus('Saved', 'success');
            });
        });
    }

    // Auto-save listeners
    rateInput.addEventListener('change', saveSettings);
    showHiddenAppsWindowsCheckbox.addEventListener('change', saveSettings);
    showUnmatchedCheckbox.addEventListener('change', saveSettings);

    closeBtn.addEventListener('click', () => {
        window.close();
    });

    function showStatus(msg, type) {
        status.textContent = msg;
        status.className = 'status ' + type;
        setTimeout(() => {
            status.textContent = '';
            status.className = 'status';
        }, 2000);
    }
});