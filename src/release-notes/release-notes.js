document.addEventListener('DOMContentLoaded', async () => {
    const contentDiv = document.getElementById('changelog-content');
    const versionBadge = document.getElementById('current-version');
    
    // Set current version from manifest
    const manifest = chrome.runtime.getManifest();
    versionBadge.textContent = `v${manifest.version}`;

    try {
        const response = await fetch(chrome.runtime.getURL('CHANGELOG.md'));
        if (!response.ok) throw new Error('Failed to load changelog');
        
        const text = await response.text();
        const releases = parseChangelog(text);
        renderReleases(releases, contentDiv);
    } catch (error) {
        console.error('Error loading changelog:', error);
        contentDiv.innerHTML = `<div class="loading">Failed to load release notes.<br>Please check GitHub for details.</div>`;
    }
});

function parseChangelog(markdown) {
    const lines = markdown.split('\n');
    const releases = [];
    let currentRelease = null;

    const versionRegex = /^## \[(.*?)\](?: - (.*))?/;
    const itemRegex = /^\* (?:(\w+): )?(.*)/;

    for (const line of lines) {
        const versionMatch = line.match(versionRegex);
        if (versionMatch) {
            if (currentRelease) {
                releases.push(currentRelease);
            }
            
            const version = versionMatch[1];
            // Skip [Unreleased] if it's empty or we want to hide it (optional)
            // But usually we want to show it if it has content.
            // For now, let's treat Unreleased as a version.
            
            currentRelease = {
                version: version,
                date: versionMatch[2] || 'Coming Soon',
                changes: []
            };
            continue;
        }

        if (currentRelease) {
            const itemMatch = line.match(itemRegex);
            if (itemMatch) {
                const type = itemMatch[1] || 'Other';
                const text = itemMatch[2];
                currentRelease.changes.push({ type, text });
            }
        }
    }

    if (currentRelease) {
        releases.push(currentRelease);
    }

    return releases;
}

function renderReleases(releases, container) {
    container.innerHTML = '';

    releases.forEach((release, index) => {
        // Skip empty releases
        if (release.changes.length === 0) return;

        const entry = document.createElement('div');
        entry.className = 'release-entry';

        const isLatest = index === 0;
        const latestTag = isLatest ? '<span class="latest-tag">Latest</span>' : '';

        let changesHtml = '';
        
        // Group changes by type? Or just list them?
        // Let's list them but style the types.
        
        release.changes.forEach(change => {
            const typeClass = `type-${change.type.toLowerCase()}`;
            // Fallback for unknown types
            const validTypes = ['feat', 'fix', 'style', 'docs', 'refactor', 'perf', 'test', 'chore'];
            const finalTypeClass = validTypes.includes(change.type.toLowerCase()) ? typeClass : 'type-other';

            changesHtml += `
                <div class="change-item">
                    <span class="change-type ${finalTypeClass}">${change.type}</span>
                    <span class="change-text">${formatLinks(change.text)}</span>
                </div>
            `;
        });

        entry.innerHTML = `
            <div class="release-header">
                <div class="release-version">
                    v${release.version}
                    ${latestTag}
                </div>
                <div class="release-date">${release.date}</div>
            </div>
            <div class="release-notes">
                ${changesHtml}
            </div>
        `;

        container.appendChild(entry);
    });
}

function formatLinks(text) {
    // Simple link formatter for [text](url) and (hash)
    // Remove the (hash) at the end if it exists (from git log)
    text = text.replace(/\s\([a-f0-9]{7}\)$/, '');
    
    // Convert markdown links
    return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
}
