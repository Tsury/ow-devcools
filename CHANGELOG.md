# Changelog

## [1.0.27] - 2026-01-13
* Fix: Support new Chrome DevTools URL and DOM structure (v1.0.26) (9825136)



## [1.0.26] - 2026-01-13
* Fix: Adopted new Chrome DevTools URL and DOM structure changes.
* Fix: Improved injection logic to support Shadow DOM traversal for toolbar buttons.

## [1.0.25] - 2025-12-21
* Test: Verifying changelog workflow with manual entry

## [1.0.24] - 2025-12-21
* ci: remove persistent unreleased section from changelog generation [no-changelog] (df184d4)

## [1.0.23] - 2025-12-21
* Ci: Fix changelog generation logic to correctly move unreleased items to the new version
* Feat: Toolbar button now focuses existing dashboard or opens a new one if not on the dashboard page
* Feat: Added Search Bar to filter apps and windows by name or URL
* Feat: Added Settings Dropdown to toggle "Built-in Packages" and "Tray Options" visibility
* Feat: Added "Task Manager" and "Overwolf Settings" shortcuts to the dashboard
* Feat: Add package management buttons (Install OPK, Load Unpacked, Pack) to dashboard
* Fix: Fixed window identification bugs and enhanced matching logic
* Fix: Resolve issue where Auto Open rules were forgotten due to dynamic URL parameters
* Fix: Improve rule matching to support legacy rules and fix Auto Open + Focus reliability
* Fix: Prevent fetching manifests for disabled apps to avoid CORS errors
* Docs: Added link to Chrome Web Store listing
* Style: Polished UI with better spacing, larger icons, and a cleaner layout

## [1.0.22] - 2025-12-21
* feat: update toolbar button behavior to focus existing dashboard (45365a1)


## [1.0.21] - 2025-12-17
* docs: fix broken chrome web store badge in readme [no-changelog] (5b37475)


## [1.0.20] - 2025-12-17
* fix: replace deprecated chrome upload action [publish] [no-changelog] (83d4d90)
* chore: cleanup code, fix auto-open bug, and prepare release [publish] (6ca4cb2)


## [1.0.18] - 2025-12-07
* Merge remote changes and resolve conflict in CHANGELOG.md (a73806e)
* Update CI workflow to intelligently insert new changelog entries after [Unreleased] section [no-changelog] (e30607d)
* Fix CHANGELOG.md structure: Move [Unreleased] to top [no-changelog] (9ffa8fc)


## [1.0.17] - 2025-12-07
* Merge branch 'main' of https://github.com/Tsury/ow-devcools (7408fb1)
* Update icons for Install OPK (File Plus) and Load Unpacked (Folder) [no-changelog] (1be06ed)

## [1.0.16] - 2025-12-07
* Merge remote changes and resolve conflict in CHANGELOG.md (ee2a836)
* Add package management buttons (Install OPK, Load Unpacked, Pack) to dashboard (a170e02)
* Add package management buttons (Install OPK, Load Unpacked, Pack) to dashboard (4dcce1f)

## [1.0.15] - 2025-12-07
* Merge branch 'main' of https://github.com/Tsury/ow-devcools (13145fb)
* Remove legacy rule support and enforce strict normalized URL matching (498bbe3)

## [1.0.14] - 2025-12-07
* Merge remote changes and resolve conflict in CHANGELOG.md (f533c41)
* Fix URL normalization for Overwolf extension URLs and remove debug logs (cc3309d)

## [1.0.13] - 2025-12-03
* Fix: Ensure DevTools tabs open in the same window as the dashboard [no-changelog] (2260081)

## [1.0.12] - 2025-12-03
* Style: Adjust position of DevTools controls [no-changelog] (9fc1127)

## [1.0.11] - 2025-12-02
* Fix: Correct changelog generation logic in CI (e7fa8c9)

## [1.0.10] - 2025-12-02
* Fix: Improve reliability of Auto Open + Focus logic (163430d)

## [1.0.9] - 2025-12-02
* CI: Add changelog generation to release workflow (5a48de6)
* Feat: Add Relaunch button to DevTools, update docs and fix focus issues (36e3c87)
