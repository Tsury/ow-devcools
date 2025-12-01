const CdpScripts = {
    getSanityCheckScript: () => `
        (function() {
            console.log("%c[Overwolf DevCools] Connection Verified!", "color: #00ff00; font-weight: bold; font-size: 12px;");
            return "Sanity Check OK - " + new Date().toISOString();
        })()
    `,

    getScraperScript: () => `
        (function() {
            function getBase64FromImg(img) {
                if (!img) return '';
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth || 48;
                    canvas.height = img.naturalHeight || 48;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    return canvas.toDataURL();
                } catch(e) {
                    return '';
                }
            }

            const apps = [];
            const items = document.querySelectorAll('.package-item');
            
            for (const item of items) {
                const titleEl = item.querySelector('.item-title');
                const uidEl = item.querySelector('.item-uid a');
                
                if (titleEl && uidEl) {
                    const name = titleEl.innerText;
                    const id = uidEl.innerText;
                    
                    // New Metadata
                    const imgEl = item.querySelector('.item-thumbnail');
                    const icon = getBase64FromImg(imgEl);

                    const author = item.querySelector('.item-creator')?.innerText.replace('By', '').trim() || '';
                    const version = item.querySelector('.item-version')?.innerText.replace('Version', '').trim() || '';
                    const pathEl = item.querySelector('.path-on-disk a');
                    const path = pathEl ? pathEl.innerText : null;

                    const buttons = [];

                    // 1. Launch / Relaunch Button
                    const actionBtn = item.querySelector('.footer-actions button.btn-secondary-small');
                    if (actionBtn) {
                        buttons.push({ 
                            text: actionBtn.innerText, 
                            enabled: !actionBtn.disabled,
                            type: 'button'
                        });
                    }

                    // 2. Enable / Disable Toggle
                    const toggleInput = item.querySelector('.ow-toggle input');
                    if (toggleInput) {
                        const isEnabled = toggleInput.checked;
                        buttons.push({ 
                            text: isEnabled ? "Disable" : "Enable", 
                            enabled: true,
                            type: 'toggle'
                        });
                    }

                    // 3. Uninstall Button
                    const deleteBtn = item.querySelector('button.delete');
                    if (deleteBtn) {
                        buttons.push({
                            text: "Uninstall",
                            enabled: true,
                            type: 'delete'
                        });
                    }

                    // 4. App Windows (Inspect)
                    const appWindows = [];
                    const windowsContainer = item.querySelector('.item-windows');
                    if (windowsContainer) {
                        // The structure is Inspect:<button>name</button>...
                        // We want the buttons that contain the window names
                        const winBtns = windowsContainer.querySelectorAll('button:not(.external-window)');
                        winBtns.forEach(btn => {
                            const wName = btn.innerText.trim();
                            if (wName) appWindows.push(wName);
                        });
                    }

                    apps.push({ id, name, icon, author, version, path, buttons, appWindows });
                }
            }
            return apps;
        })()
    `,

    getManifestFetchScript: (appId) => `
        (async function() {
            try {
                const r = await fetch('overwolf-extension://${appId}/manifest.json');
                if (!r.ok) throw new Error('HTTP ' + r.status);
                const json = await r.json();
                return json;
            } catch(e) {
                return { error: e.toString() };
            }
        })()
    `,

    getControlScript: (appId, actionName, extraData) => `
        (function() {
            try {
                // Find the app item by ID
                const uidLinks = Array.from(document.querySelectorAll('.item-uid a'));
                const idLink = uidLinks.find(a => a.innerText === '${appId}');
                if (!idLink) {
                    return "App ID not found";
                }
                
                const item = idLink.closest('.package-item');
                if (!item) {
                    return "Package item container not found";
                }

                // Handle Enable/Disable (Toggle)
                if ("${actionName}" === "Enable" || "${actionName}" === "Disable") {
                    const toggleInput = item.querySelector('.ow-toggle input');
                    if (toggleInput) {
                        toggleInput.click();
                        // Force change event if click doesn't trigger it
                        toggleInput.dispatchEvent(new Event('change', { bubbles: true }));
                        return "Clicked Toggle Input";
                    }
                    return "Toggle input not found";
                }

                // Handle Inspect Window
                if ("${actionName}" === "InspectWindow") {
                    const winName = "${extraData}";
                    const windowsContainer = item.querySelector('.item-windows');
                    if (windowsContainer) {
                        const winBtns = Array.from(windowsContainer.querySelectorAll('button:not(.external-window)'));
                        const targetBtn = winBtns.find(b => b.innerText.trim() === winName);
                        if (targetBtn) {
                            targetBtn.click();
                            return "Clicked Inspect for " + winName;
                        }
                    }
                    return "Window button not found: " + winName;
                }

                // Handle Buttons (Launch/Relaunch)
                const actionBtns = Array.from(item.querySelectorAll('.footer-actions button.btn-secondary-small'));
                const targetBtn = actionBtns.find(btn => btn.innerText.trim() === "${actionName}");
                
                if (targetBtn) {
                    targetBtn.click();
                    return "Clicked ${actionName}";
                }

                // Handle Uninstall
                if ("${actionName}" === "Uninstall") {
                    const deleteBtn = item.querySelector('button.delete');
                    if (deleteBtn) {
                        deleteBtn.click();
                        return "Clicked Uninstall";
                    }
                    return "Uninstall button not found";
                }
                
                return "${actionName} button not found";
            } catch (e) {
                return e.toString();
            }
        })()
    `,

    getOpenFolderScript: (escapedPath) => `
        (function() {
            const a = document.createElement('a');
            a.href = 'folder://${escapedPath}';
            a.click();
        })()
    `
};
