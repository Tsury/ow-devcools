#Requires AutoHotkey v2.0
#SingleInstance Force

; ============================
; CONFIG (fixed mode only)
; ============================

; Window title to control (matched using SetTitleMatchMode below)
TARGET_WINDOW_TITLE := "Browser"

; Friendly name for tray text (if blank, falls back to TARGET_WINDOW_TITLE)
TARGET_FRIENDLY_NAME := "Packages"

; Branding
APP_NAME   := "Overwolf DevCools Packages Hider"
APP_AUTHOR := "Tsury"

; Title matching: 2 = "contains"
SetTitleMatchMode 2
DetectHiddenWindows true   ; we want to find windows even when hidden

; ============================
; STATE
; ============================

; Start in "hidden" mode: script will hide the window as soon as it sees it
gDesiredHidden := true
gStatusLabel   := ""   ; will hold current status menu item text

; Tray tooltip
A_IconTip := APP_NAME " by " APP_AUTHOR

; ============================
; TRAY MENU
; ============================

A_TrayMenu.Delete()

friendly    := TARGET_FRIENDLY_NAME != "" ? TARGET_FRIENDLY_NAME : TARGET_WINDOW_TITLE
toggleLabel := "Toggle hide/show " friendly " (Win+Alt+H)"
exitLabel   := "Exit"

; Toggle
A_TrayMenu.Add(toggleLabel, ToggleHiddenState)

; Status line (disabled, gets renamed dynamically)
statusLabel := "Status: Not running"
A_TrayMenu.Add(statusLabel, (*) => 0)
A_TrayMenu.Disable(statusLabel)
gStatusLabel := statusLabel

; Exit
A_TrayMenu.Add(exitLabel, ShowAndExit)

; Branding
A_TrayMenu.Add()  ; separator
appLabel    := APP_NAME
authorLabel := "By " APP_AUTHOR
A_TrayMenu.Add(appLabel,    (*) => 0)
A_TrayMenu.Add(authorLabel, (*) => 0)
A_TrayMenu.Disable(appLabel)
A_TrayMenu.Disable(authorLabel)

A_TrayMenu.Default := toggleLabel

; ============================
; HOTKEYS
; ============================

; Win+Alt+H – toggle desired state and apply
Hotkey("#!h", ToggleHiddenState)

OnExit(EnsureShownOnExit)

; ============================
; STARTUP BEHAVIOR
; ============================

; Try to hide immediately if the window already exists,
; then enforce state every 500ms for new instances.
MonitorFixedWindow()
SetTimer(MonitorFixedWindow, 500)

return  ; end of auto-execute section


; ============================
; FUNCTIONS
; ============================

UpdateStatusMenu(isHidden, hasWindow) {
    global gStatusLabel

    if !gStatusLabel
        return

    newText := hasWindow
        ? (isHidden ? "Status: Hidden" : "Status: Visible")
        : "Status: Not running"

    if (newText = gStatusLabel)
        return

    A_TrayMenu.Rename(gStatusLabel, newText)
    A_TrayMenu.Disable(newText)
    gStatusLabel := newText
}

ToggleHiddenState(*) {
    global gDesiredHidden, TARGET_WINDOW_TITLE

    gDesiredHidden := !gDesiredHidden

    ; Apply immediately once
    MonitorFixedWindow()

    ; If we just made it visible, bring it to front once
    if !gDesiredHidden {
        hwnd := WinExist(TARGET_WINDOW_TITLE)
        if hwnd {
            try WinActivate("ahk_id " hwnd)
        }
    }
}

MonitorFixedWindow(*) {
    global TARGET_WINDOW_TITLE, gDesiredHidden

    if !TARGET_WINDOW_TITLE
        return

    hwnd := WinExist(TARGET_WINDOW_TITLE)
    hasWindow := hwnd != 0

    UpdateStatusMenu(gDesiredHidden, hasWindow)

    if !hasWindow
        return  ; window not running / not found

    try {
        if gDesiredHidden {
            WinHide("ahk_id " hwnd)
        } else {
            WinShow("ahk_id " hwnd)
        }
    } catch {
        ; ignore errors – next tick will retry
    }
}

ShowAndExit(*) {
    EnsureShownOnExit("", 0)
    ExitApp
}

EnsureShownOnExit(ExitReason, ExitCode) {
    global TARGET_WINDOW_TITLE, gDesiredHidden

    if !gDesiredHidden
        return  ; already shown, nothing to do

    hwnd := WinExist(TARGET_WINDOW_TITLE)
    if !hwnd
        return

    try WinShow("ahk_id " hwnd)
    catch {
        ; worst case: window stays hidden
    }
}
