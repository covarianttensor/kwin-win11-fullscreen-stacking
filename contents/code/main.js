/*
 * Windows 11 Fullscreen Stacking for KWin (KDE Plasma 6)
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * Behavior:
 * 1. Focused fullscreen windows stay in ActiveLayer (covering the Plasma Taskbar).
 * 2. When a normal window is focused on or dragged onto a monitor with a fullscreen
 *    window, both the fullscreen window and the normal window are placed in AboveLayer
 *    with stacking order: Taskbar < Fullscreen Window < Normal Window(s).
 *    This fixes KWin's cross-monitor drag bug (where m_layer stays cached as ActiveLayer)
 *    and prevents the Taskbar from overlaying the fullscreen app.
 * 3. Focusing the fullscreen window again restores normal layers so it covers everything.
 */

function rectsIntersect(a, b) {
    return a.x < b.x + b.width &&
           a.x + a.width > b.x &&
           a.y < b.y + b.height &&
           a.y + a.height > b.y;
}

function isOnCurrentDesktop(w) {
    if (w.onAllDesktops || !w.desktops || w.desktops.length === 0) {
        return true;
    }
    const currentDesktop = workspace.currentDesktopForScreen
        ? workspace.currentDesktopForScreen(w.output)
        : workspace.currentDesktop;
    return w.desktops.indexOf(currentDesktop) !== -1;
}

function isRelevantFullscreen(w) {
    return w &&
           w.normalWindow &&
           w.fullScreen &&
           !w.minimized &&
           !w.deleted &&
           isOnCurrentDesktop(w);
}

function isRelevantNormal(w) {
    return w &&
           w.normalWindow &&
           !w.fullScreen &&
           !w.minimized &&
           !w.deleted &&
           isOnCurrentDesktop(w);
}

let inSync = false;

function clearManagedKeepAbove(w) {
    if (w && w._win11FsKeepAbove) {
        w._win11FsKeepAbove = false;
        w._win11OverlayActive = false;
        w.keepAbove = false;
    }
}

function syncAll() {
    if (inSync) {
        return;
    }
    inSync = true;
    try {
        const windows = workspace.windowList();
        const active = workspace.activeWindow;

        // Find active/unminimized fullscreen windows per output
        const fsWindows = [];
        for (let i = 0; i < windows.length; i++) {
            const w = windows[i];
            if (isRelevantFullscreen(w)) {
                fsWindows.push(w);
            } else if (w._win11FsKeepAbove && w.fullScreen) {
                clearManagedKeepAbove(w);
            }
        }

        // If no fullscreen windows exist at all, clean up any managed keepAbove flags
        if (fsWindows.length === 0) {
            for (let i = 0; i < windows.length; i++) {
                clearManagedKeepAbove(windows[i]);
            }
            return;
        }

        const activeIsNormal = isRelevantNormal(active);

        for (let f = 0; f < fsWindows.length; f++) {
            const fs = fsWindows[f];
            const out = fs.output;
            if (!out) {
                continue;
            }
            const outGeom = out.geometry;

            // Case 1: The fullscreen window itself is active -> restore everything on this screen
            if (fs.active || active === fs) {
                for (let i = 0; i < windows.length; i++) {
                    const w = windows[i];
                    if (w !== fs && w._win11FsKeepAbove && rectsIntersect(w.frameGeometry, outGeom)) {
                        clearManagedKeepAbove(w);
                    }
                }
                clearManagedKeepAbove(fs);
                continue;
            }

            // Case 2: Plasma shell (e.g. Start Menu / Kickoff via Meta key) is active on this screen
            // Let KWin drop the fullscreen window to NormalLayer temporarily so Start Menu + Taskbar show.
            if (active && !active.normalWindow && active.output === out) {
                clearManagedKeepAbove(fs);
                continue;
            }

            // Case 3: An active normal window overlaps this fullscreen window's monitor
            const activeOverlapsOut = activeIsNormal && rectsIntersect(active.frameGeometry, outGeom);

            if (activeOverlapsOut) {
                const needTransition = !fs._win11OverlayActive ||
                                       !active._win11FsKeepAbove ||
                                       active.stackingOrder < fs.stackingOrder;

                if (needTransition) {
                    fs._win11OverlayActive = true;
                    if (!fs.keepAbove) {
                        fs._win11FsKeepAbove = true;
                        fs.keepAbove = true;
                    } else if (fs._win11FsKeepAbove) {
                        // Force KWin C++ Window::updateLayer() to invalidate cached ActiveLayer (5)
                        fs.keepAbove = false;
                        fs.keepAbove = true;
                    }

                    if (!active.keepAbove) {
                        active._win11FsKeepAbove = true;
                        active.keepAbove = true;
                    }

                    // Ensure stacking order in AboveLayer (3):
                    // Taskbar (Dock) < Fullscreen App (fs) < Promoted Normal Windows < Active Window
                    workspace.raiseWindow(fs);
                    for (let i = 0; i < windows.length; i++) {
                        const w = windows[i];
                        if (w !== fs && w !== active && w._win11FsKeepAbove && rectsIntersect(w.frameGeometry, outGeom)) {
                            workspace.raiseWindow(w);
                        }
                    }
                    workspace.raiseWindow(active);
                }
            }
        }

        // Clean up any managed normal window that no longer intersects ANY fullscreen output
        for (let i = 0; i < windows.length; i++) {
            const w = windows[i];
            if (!w._win11FsKeepAbove || w.fullScreen) {
                continue;
            }
            if (!isRelevantNormal(w)) {
                clearManagedKeepAbove(w);
                continue;
            }
            let intersectsAnyFs = false;
            for (let f = 0; f < fsWindows.length; f++) {
                const fs = fsWindows[f];
                if (fs.output && rectsIntersect(w.frameGeometry, fs.output.geometry)) {
                    intersectsAnyFs = true;
                    break;
                }
            }
            if (!intersectsAnyFs) {
                clearManagedKeepAbove(w);
            }
        }

        // For any fullscreen window in overlay mode, check if any promoted normal window still overlaps its output
        for (let f = 0; f < fsWindows.length; f++) {
            const fs = fsWindows[f];
            if (!fs._win11FsKeepAbove) {
                continue;
            }
            const outGeom = fs.output.geometry;
            let hasPromotedWindow = false;
            for (let i = 0; i < windows.length; i++) {
                const w = windows[i];
                if (w !== fs && w._win11FsKeepAbove && rectsIntersect(w.frameGeometry, outGeom)) {
                    hasPromotedWindow = true;
                    break;
                }
            }
            if (!hasPromotedWindow) {
                clearManagedKeepAbove(fs);
            }
        }
    } finally {
        inSync = false;
    }
}

function attachWindow(w) {
    if (!w || w._win11FsAttached) {
        return;
    }
    w._win11FsAttached = true;

    w.fullScreenChanged.connect(syncAll);
    w.outputChanged.connect(syncAll);
    w.minimizedChanged.connect(syncAll);
    w.interactiveMoveResizeStarted.connect(syncAll);
    w.interactiveMoveResizeStepped.connect(syncAll);
    w.interactiveMoveResizeFinished.connect(syncAll);
    w.closed.connect(syncAll);
}

workspace.windowActivated.connect(syncAll);
workspace.windowAdded.connect(function(w) {
    attachWindow(w);
    syncAll();
});
workspace.windowRemoved.connect(syncAll);
if (workspace.currentDesktopChanged) {
    workspace.currentDesktopChanged.connect(syncAll);
}

const initialWindows = workspace.windowList();
for (let i = 0; i < initialWindows.length; i++) {
    attachWindow(initialWindows[i]);
}
syncAll();
