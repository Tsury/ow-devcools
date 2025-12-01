# Overwolf DevCools

<p align="center">
  <img src="assets/screenshots/screenshot.png" alt="Overwolf DevCools Screenshot">
  <br>
  <strong>Supercharged Overwolf DevTools, straight in your Chrome browser.</strong>
</p>

DevCools replaces the standard Overwolf Packages window with a modern, feature-rich dashboard running directly in Chrome. It connects to your local Overwolf developer environment to give you better control and visibility over your apps.

## Installation

### Chrome Web Store
*   **Status:** Awaiting approval.

### Manual Installation
1.  Download the latest `.crx` file from the [Releases](https://github.com/Tsury/ow-devcools/releases) page.
2.  Open Chrome and navigate to `chrome://extensions`.
3.  Enable **Developer mode** (toggle in the top right corner).
4.  Drag and drop the downloaded `.crx` file onto the extensions page.

## Features

*   **Auto Open:** Automatically open DevTools when a specific window appears.
*   **Auto Open & Focus:** Hold `CTRL` when enabling Auto-Open to also automatically focus the DevTools window.
*   **Auto Close:** Automatically close the DevTools tab when the app window closes.
*   **Smart Tabs:** DevTools tabs now show the actual App Icon and Window Name instead of generic titles, making them easy to find.
*   **App Refresh:** Quickly restart an app (Disable -> Enable cycle) with one click.
*   **Visual Organization:** Apps and windows are color-coded for quick recognition.
*   **Clutter Control:** Hide specific apps or windows you don't need to see.
*   **Unpacked Indicator:** Clearly see which apps are loaded from disk (Unpacked) vs installed from the store.
*   **Themes:** Built-in Dark and Light modes.
*   **Non-Intrusive:** Runs entirely in Chrome, not injected into your games.

## Packages Hider (Optional)

Since DevCools requires the original Overwolf Packages window to be open, we provide an optional AutoHotkey script to hide it from your taskbar and screen, keeping your workspace clean and preventing it from being injected into your games.

*   **Hides the "Packages" window** automatically.
*   **Toggle Visibility:** Press `Win + Alt + H` to show/hide the window manually.
*   **Tray Icon:** Shows the current status and allows toggling via menu.

You can find the script in `extras/PackagesHider.ahk` with a compiled version in `extras/PackagesHider.exe` (use at your own risk or compile yourself).

## Notes

*   **Requirement:** The Overwolf Packages window must be kept open for this extension to work.
*   **Work in Progress:** Not all features from the original Packages window have been ported yet. If you need something specific, please open a request!
*   **Privacy:** Everything runs locally on your machine. No data is transmitted outside.
*   **Disclaimer:** This project is an independent, non-profit community tool and is **not** affiliated with, endorsed by, or connected to Overwolf in any way. It does not use any Overwolf branding assets or trademarks. It is a purely local utility designed to enhance the developer experience with zero malicious intent.

## Development

This project is 100% vibe coded by **Gemini 3 Pro**.

Pull Requests and Feature Requests are welcome!
