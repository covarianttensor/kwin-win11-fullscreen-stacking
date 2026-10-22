# Windows 11 Fullscreen Stacking for KDE Plasma 6 (KWin Script)

A lightweight KWin Script for **KDE Plasma 6** that makes fullscreen applications behave the way they do in **Windows 11**—especially on multi-monitor setups.

With this script enabled:
1. **Fullscreen apps cover the Plasma Taskbar (Panel):** When a fullscreen app is focused—or when it is sitting on a secondary monitor while you work elsewhere—it covers the taskbar on its monitor.
2. **Dragged and focused windows render *above* fullscreen apps:** When you drag a normal window from another monitor onto a fullscreen app (or focus a normal window on the same screen), the normal window smoothly renders **on top of** the fullscreen app, while the fullscreen app **continues to cover the taskbar underneath**.
3. **Clicking the fullscreen app restores it to the front:** Focusing the fullscreen app again immediately sends overlapping normal windows behind it.
4. **Pressing the Meta (Windows) key works naturally:** Opening the Application Launcher on the fullscreen monitor temporarily allows the launcher and taskbar to appear above the fullscreen app until you click back into your app.

---

*The following is an analysis written by an autonomous agent*

## The Problem This Script Solves

On Windows 11, fullscreen windows participate naturally in desktop Z-ordering:
- A fullscreen video, browser (`F11`), or game covers the taskbar on that monitor.
- If you drag a smaller window (e.g., Discord, a calculator, notes, or a file manager) from Monitor B onto the fullscreen app on Monitor A, **the window you are dragging stays on top of the fullscreen app**, and the fullscreen app stays on top of the taskbar.

On **KDE Plasma (KWin)**, trying to do this out of the box hits two frustrating issues:

### 1. Default KWin Behavior: Dragged Windows Disappear Underneath Fullscreen Apps
By default in KWin, if you have a fullscreen application on Monitor A and drag a normal window from Monitor B across the screen boundary onto Monitor A, **the dragged window vanishes underneath the fullscreen app**. Even after releasing the mouse button, the fullscreen app often remains locked in KWin's topmost `ActiveLayer`, hiding the active window you just dragged over it.

### 2. Why the Standard "Window Rule" Workaround Breaks Your Taskbar
If you search Reddit, the KDE Forums, or KDE Bugzilla for how to allow windows on top of fullscreen apps, the universally repeated advice is to create a KWin **Window Rule** forcing `Layer = Normal` for normal windows (or `Layer = On Screen Display` for specific apps).

However, in KWin's layer architecture:
- **`NormalLayer` (`Layer 2`) sits strictly *below* the Plasma Taskbar (`AboveLayer` / `Dock`, `Layer 3`).**
- Because KWin Window Rules are static and cannot filter by whether a window is currently focused or unfocused, forcing `Layer = Normal` demotes *all* fullscreen windows—including **actively focused** ones—below the Plasma Taskbar.
- As a result, **your taskbar permanently overlays on top of your fullscreen videos and games**.

### Behavior Comparison

| Scenario | Default KWin 6 | Static Window Rule (`Layer = Normal`) | **This KWin Script (Windows 11 Behavior)** |
| :--- | :---: | :---: | :---: |
| Focused fullscreen app covers the Taskbar | Yes | **No** (Taskbar overlays fullscreen app) | **Yes** |
| Unfocused fullscreen app on Monitor A covers Taskbar while working on Monitor B | Yes | **No** | **Yes** |
| Dragging a window from Monitor B onto a fullscreen app on Monitor A renders the dragged window on top | **No** (Window hides behind fullscreen app) | Yes | **Yes** |
| Taskbar stays hidden beneath the fullscreen app while a smaller window sits on top of the fullscreen app | **No** (Taskbar pops up over fullscreen app) | **No** (Taskbar is always on top) | **Yes** |
| Pressing `Meta` (Super) brings up the Application Launcher & Taskbar | Yes | Yes | **Yes** |

---

## Installation

### Option 1: Automatic Install Script (Recommended)
Clone this repository and run `./install.sh`, which installs the script into `~/.local/share/kwin/scripts/win11-fullscreen-stacking`, enables it in `kwinrc`, and reloads KWin immediately via D-Bus (no logout required):

```bash
git clone https://github.com/covarianttensor/kwin-win11-fullscreen-stacking.git
cd kwin-win11-fullscreen-stacking
./install.sh
```

To uninstall and restore default KWin behavior:
```bash
./uninstall.sh
```

### Option 2: Using `kpackagetool6`
```bash
kpackagetool6 --type=KWin/Script -i .
kwriteconfig6 --file kwinrc --group Plugins --key win11-fullscreen-stackingEnabled true
qdbus6 org.kde.KWin /KWin reconfigure
```

> **Important:** Make sure you remove any static KWin Window Rules that force `Layer = Normal` on Normal Windows (`System Settings → Window Management → Window Rules`), as static rules override KWin's dynamic layer calculation.

---

# Exhaustive Technical Deep-Dive: Why This Happens & How We Solved It

Despite this being one of the most common multi-monitor complaints from users migrating from Windows to KDE Plasma, no existing KWin script solved it. Below is a complete technical breakdown of the specifications, community misconceptions, developer discussions, and binary disassembly of `/usr/lib/libkwin.so.6` (KWin 6.8) that led to this solution.

---

## 1. Developer Stance & The EWMH Specification

Historically, KWin's window stacking engine was designed around the X11 **Extended Window Manager Hints (EWMH / NetWM)** specification ([Stacking Order section](https://specifications.freedesktop.org/wm-spec/latest/ar01s07.html#STACKINGORDER)), which defines a strict layered hierarchy:
1. `_NET_WM_TYPE_DESKTOP`
2. `_NET_WM_STATE_BELOW`
3. Normal windows (with no state or type hint)
4. `_NET_WM_TYPE_DOCK` (Panels / Taskbars) and `_NET_WM_STATE_ABOVE`
5. **Focused `_NET_WM_STATE_FULLSCREEN` windows**

When users report on KDE Bugzilla that "Keep Above" windows or windows dragged from another monitor are hidden underneath fullscreen applications, KWin developers have historically cited EWMH compliance:
- **KDE Bug [#296076](https://bugs.kde.org/show_bug.cgi?id=296076)** & **KDE Bug [#437139](https://bugs.kde.org/show_bug.cgi?id=437139):** Discussions around fullscreen windows occupying `ActiveLayer` and how multi-monitor focus affects panels, popups, and other windows.
- **KDE Invent [MR !1957](https://invent.kde.org/plasma/kwin/-/merge_requests/1957):** Upstream KWin refactoring around `Window::isActiveFullScreen()` and `isOnOutput()` to decide when a fullscreen window on one monitor should remain in `ActiveLayer` while another monitor has focus.

Because EWMH dictates that active fullscreen windows live in a layer above `_NET_WM_TYPE_DOCK` and `_NET_WM_STATE_ABOVE`, and that unfocusing a fullscreen window on the same screen drops it all the way back to the Normal layer (below `_NET_WM_TYPE_DOCK`), KWin's native state machine only has two states for a fullscreen window:
1. **`ActiveLayer` (`Layer 5`):** Covers the taskbar, **and** covers every normal/Keep-Above window on that screen.
2. **`NormalLayer` (`Layer 2`):** Allows normal windows on top of it, **but** drops below the taskbar (`Layer 3`), causing the Plasma Panel to pop up over the fullscreen app.

There is no native third state in KWin's state machine where a fullscreen window sits **above the taskbar** while a normal window sits **above the fullscreen window**.

---

## 2. Community Misunderstandings & Why Existing Workarounds Hit a Wall

Across recurring threads on Reddit and KDE forums—such as:
- [*"Is it possible to keep a window above a full screen window?"* (`r/kde`)](https://www.reddit.com/r/kde/comments/z0zptp/is_it_possible_to_keep_a_window_above_a_full/)
- [*"Please how to keep window above fullscreen?"* (`r/kde`)](https://www.reddit.com/r/kde/comments/1rgi7l4/please_how_to_keep_window_above_fullscreen/)
- [*"'Always on Top' windows ignored if an app is fullscreen"* (`r/kde`)](https://www.reddit.com/r/kde/comments/qq5ojw/always_on_top_windows_ignored_if_an_app_is/)
- [*"PiP Always on Top on KDE"* (Medium)](https://medium.com/@80h3m14n/pip-always-on-top-on-kde-e79061a881f4)

three major misconceptions prevented the community from building a proper fix:

### Misconception 1: *"Just use a global Window Rule to force `Layer = Normal`"*
Users discover that KWin Window Rules (`kwinrulesrc`) expose a `Layer` property. Setting `Window types: Normal Window` → `Layer: Force Normal` stops fullscreen apps from entering `ActiveLayer`. However:
- Window Rules in KWin are **stateless** with respect to focus: there is no matching predicate for *"is unfocused"* or *"another window is overlapping this monitor"*.
- Forcing `Layer = Normal` applies even when the fullscreen app is focused, placing it in `NormalLayer` (`2`) underneath the Plasma Panel in `AboveLayer` (`3`).

### Misconception 2: *"Just enable 'Keep Above Others' (`Alt+F3`) on the window you're dragging"*
In Windows, setting a window to "Always on Top" (`HWND_TOPMOST`) allows it to appear over borderless fullscreen windows. In KWin, "Keep Above" places a window in `AboveLayer` (`3`), whereas a fullscreen window on a secondary monitor (or during a cross-monitor drag) is placed in `ActiveLayer` (`5`). Because `5 > 3`, `ActiveLayer` unconditionally occludes `AboveLayer`.

### Misconception 3: *"A KWin Script cannot fix this because `window.layer` is read-only"*
If you check KWin's Scripting API documentation, `KWin::Window::layer` is exposed as a **read-only** QML/JS property (`Q_PROPERTY(KWin::Layer layer READ layer)`). There is no `window.layer = ...` setter in JavaScript. Script authors who looked at the API documentation concluded that KWin Scripts cannot manipulate window layers and gave up—assuming only static C++ Window Rules (`RuleBook`) could alter layers.

---

## 3. Reverse-Engineering `/usr/lib/libkwin.so.6` via Disassembly

By disassembling `/usr/lib/libkwin.so.6` (KWin 6.8.1 on x86-64), we uncovered **five internal implementation details** in KWin's C++ stacking engine that explain both why cross-monitor dragging is broken in KWin and how a KWin Script can achieve exact Windows 11 stacking without needing write access to `window.layer`.

---

### Finding #1: KWin's Internal 10-Layer Enum & `KWin::Window::belongsToLayer()` (`0x5037a0`)

Extracting the symbol table and string table from `libkwin.so.6` shows KWin's internal `KWin::Layer` enum values:

| Enum Value | Name | Typical Contents |
| :---: | :--- | :--- |
| `0` | `DesktopLayer` | Desktop wallpaper / desktop view (`NET::Desktop`) |
| `1` | `BelowLayer` | Windows with `keepBelow = true` or Wayland layer-shell `BOTTOM` |
| `2` | `NormalLayer` | Standard application windows (`NET::Normal`) |
| `3` | `AboveLayer` | **Plasma Panels (`NET::Dock` / Wayland layer-shell `TOP`) AND windows with `keepAbove = true`** |
| `4` | `NotificationLayer` | Desktop notifications (`NET::Notification`) |
| `5` | `ActiveLayer` | **Active fullscreen windows (`isActiveFullScreen() == true`)** |
| `6` | `PopupLayer` | Context menus, dropdowns, popups |
| `7` | `CriticalNotificationLayer` | Critical notifications (`NET::CriticalNotification`) |
| `8` | `OnScreenDisplayLayer` | Volume/brightness OSD (`NET::OnScreenDisplay`) |
| `9` | `OverlayLayer` | Lock screen overlays, Wayland layer-shell `OVERLAY` |

In `KWin::Window::belongsToLayer() const` (`0x5037a0`), after checking special window types (unmanaged windows, lock screen, desktop, dock, notifications, OSD), normal windows reach `0x503981`:

```objdump
  503981: 80 bb 5c 01 00 00 00  cmpb   $0x0,0x15c(%rbx)      # if (this->keepBelow())
  503988: b8 01 00 00 00        mov    $0x1,%eax             #     return BelowLayer (1);
  50398d: 75 46                 jne    5039d5
  50398f: 48 89 df              mov    %rbx,%rdi
  503992: ff 15 88 f0 53 00     call   *0x53f088(%rip)       # KWin::Window::isActiveFullScreen() const
  503998: 84 c0                 test   %al,%al               # if (this->isActiveFullScreen())
  50399a: b8 05 00 00 00        mov    $0x5,%eax             #     return ActiveLayer (5);
  50399f: 75 34                 jne    5039d5
  5039a1: 0f b6 83 5b 01 00 00  movzbl 0x15b(%rbx),%eax      # eax = (uint8_t)this->keepAbove() (0 or 1)
  5039a8: 83 c0 02              add    $0x2,%eax             # return keepAbove ? AboveLayer (3) : NormalLayer (2)
  5039ab: eb 28                 jmp    5039d5
```

Look closely at those instructions (`0x503981`–`0x5039ab`). They translate to this exact C++ priority order:

```cpp
if (keepBelow()) {
    return BelowLayer;          // 1
}
if (isActiveFullScreen()) {
    return ActiveLayer;         // 5
}
if (keepAbove()) {
    return AboveLayer;          // 3 (0x15b(%rbx) == 1 -> 1 + 2 = 3)
}
return NormalLayer;             // 2 (0x15b(%rbx) == 0 -> 0 + 2 = 2)
```

Notice two critical facts here:
1. If `isActiveFullScreen()` returns `false`, KWin immediately checks `keepAbove()` (`0x15b(%rbx)`).
2. If `keepAbove()` is `true` while `isActiveFullScreen()` is `false`, **a fullscreen window is placed into `AboveLayer` (`3`) instead of `NormalLayer` (`2`)**!

---

### Finding #2: How `KWin::Window::isActiveFullScreen()` (`0x503660`) and `KWin::Window::isOnOutput()` (`0x4f7060`) Work

Disassembling `KWin::Window::isActiveFullScreen() const` (`0x503660`) reveals the exact condition KWin uses to decide whether a fullscreen window belongs in `ActiveLayer` (`5`):

```objdump
0000000000503660 <KWin::Window::isActiveFullScreen() const@@Base>:
  ...
  5036ac: 48 89 df              mov    %rbx,%rdi
  5036af: ff d0                 call   *%rax                 # this->isFullScreen()
  5036b1: 84 c0                 test   %al,%al
  5036b3: 74 55                 je     50370a                # if (!isFullScreen()) return false;
  5036b5: 48 8b 05 44 b9 53 00  mov    0x53b944(%rip),%rax   # KWin::Workspace::_self
  5036bc: 48 8b 00              mov    (%rax),%rax
  5036bf: 48 8b 50 70           mov    0x70(%rax),%rdx       # rdx = workspace()->mostRecentlyActivatedWindow() (ac)
  5036c3: 48 85 d2              test   %rdx,%rdx
  5036c6: 74 40                 je     503708                # if (!ac) return false;
  5036c8: 48 39 d3              cmp    %rdx,%rbx
  5036cb: 74 20                 je     5036ed                # if (ac == this) return true;
  5036cd: 48 89 df              mov    %rbx,%rdi
  5036d0: 48 89 54 24 08        mov    %rdx,0x8(%rsp)
  5036d5: ff 15 85 dd 53 00     call   *0x53dd85(%rip)       # this->output()
  5036db: 48 8b 7c 24 08        mov    0x8(%rsp),%rdi        # rdi = ac
  5036e0: 48 89 c6              mov    %rax,%rsi             # rsi = this->output()
  5036e3: ff 15 37 f0 53 00     call   *0x53f037(%rip)       # ac->isOnOutput(this->output())
  5036e9: 84 c0                 test   %al,%al
  5036eb: 75 33                 jne    503720                # if (ac->isOnOutput(this->output())) check allMainWindows()
  5036ed: b8 01 00 00 00        mov    $0x1,%eax             # else return true;
```

In C++, `KWin::Window::isActiveFullScreen()` is:

```cpp
bool Window::isActiveFullScreen() const {
    if (!isFullScreen()) {
        return false;
    }
    const Window *ac = workspace()->mostRecentlyActivatedWindow();
    if (!ac) {
        return false;
    }
    if (ac == this) {
        return true;
    }
    if (!ac->isOnOutput(output())) {
        return true;
    }
    return ac->allMainWindows().contains(this);
}
```

And what does `ac->isOnOutput(this->output())` (`0x4f7060`) check? Does it check whether `ac`'s primary assigned monitor (`ac->output()`) equals `this->output()`? **No!** Disassembling `KWin::Window::isOnOutput(KWin::LogicalOutput*) const` (`0x4f7060`) shows that it rounds the window's `frameGeometry` (`0x18(%rbx)`..`0x30(%rbx)`) and performs a **2D rectangle intersection test** against `output->geometry()`:

```objdump
00000000004f7060 <KWin::Window::isOnOutput(KWin::LogicalOutput*) const@@Base>:
  ...
  4f7078: ff 15 7a fa 53 00     call   *0x53fa7a(%rip)       # KWin::LogicalOutput::geometry() const
  4f707e: c5 fb 10 43 30        vmovsd 0x30(%rbx),%xmm0      # frameGeometry.height
  ...
  4f70ee: 45 39 fc              cmp    %r15d,%r12d           # rect intersection check:
  4f70f1: 0f 9c c2              setl   %dl                   # output.left < window.right &&
  4f70f4: 39 fd                 cmp    %edi,%ebp             # window.left < output.right &&
  4f70f6: 40 0f 9f c7           setg   %dil                  # output.top  < window.bottom &&
  4f70fa: 21 fa                 and    %edi,%edx             # window.top  < output.bottom
```

This means that **as soon as a single pixel of the window you are dragging (`ac`) crosses the border onto the fullscreen window's monitor (`this->output()`), `ac->isOnOutput(this->output())` is ALREADY `true`, and `isActiveFullScreen()` ALREADY evaluates to `false`!**

---

### Finding #3: The Cross-Monitor Drag Bug — Why `m_layer` (`0x1fc`) Stays Stuck at `ActiveLayer` (`5`)

If `isActiveFullScreen()` already returns `false` the moment your dragged window touches the fullscreen monitor, **why does KWin keep the fullscreen window on top of your dragged window?**

Disassembling `KWin::Window::layer() const` (`0x4fc940`) and `KWin::Window::updateLayer()` (`0x4fca00`) reveals the culprit:

```objdump
00000000004fc940 <KWin::Window::layer() const@@Base>:
  4fc940: f3 0f 1e fa           endbr64
  4fc944: 8b 87 fc 01 00 00     mov    0x1fc(%rdi),%eax      # eax = this->m_layer
  4fc94a: 83 f8 ff              cmp    $0xffffffff,%eax      # if (m_layer != UnknownLayer (-1))
  4fc94d: 74 01                 je     4fc950
  4fc94f: c3                    ret                          #     return cached m_layer immediately!
```

`KWin::Window::layer()` **caches** the computed layer in member variable `m_layer` at offset `0x1fc(%rdi)`. It **never calls `belongsToLayer()`** unless `m_layer` is invalidated to `0xffffffff` (`UnknownLayer`) inside `KWin::Window::updateLayer()` (`0x4fca00`):

```objdump
00000000004fca00 <KWin::Window::updateLayer()@@Base>:
  ...
  4fcab4: c7 83 fc 01 00 00 ff  movl   $0xffffffff,0x1fc(%rbx) # m_layer = UnknownLayer (-1)
  4fcabb: ff ff ff
  ...
  4fcac7: ff 25 9b 01 54 00     jmp    *0x54019b(%rip)         # Workspace::blockStackingUpdates(false) -> recomputes stacking
```

Now look at where `KWin::Window::updateLayer()` is called when you click a window on Monitor B and drag it onto Monitor A:
1. When you click the window on Monitor B, `KWin::Workspace::setActiveWindow(KWin::Window*)` runs (`0x1a43c6`):
   ```objdump
     1a43c6: ff 15 94 d0 89 00     call   *0x89d094(%rip)       # fullscreenWin->output()
     1a43cc: 48 8b 7b 70           mov    0x70(%rbx),%rdi       # mostRecentlyActivatedWindow()
     1a43d0: 49 89 c6              mov    %rax,%r14
     1a43d3: ff 15 87 d0 89 00     call   *0x89d087(%rip)       # activeWin->output()
     1a43de: 49 39 c6              cmp    %rax,%r14             # if (fullscreenWin->output() == activeWin->output())
     1a43e1: 74 07                 je     1a43ea
     1a43e3: ...                   jmp    1a4384                # skip!
     1a43ea: 4c 89 e7              mov    %r12,%rdi
     1a43ed: ff 15 cd 55 89 00     call   *0x8955cd(%rip)       # fullscreenWin->updateLayer()
   ```
   At the moment you click the window on Monitor B, `activeWin->output()` is **Monitor B**, while `fullscreenWin->output()` is **Monitor A**. Because `Monitor A != Monitor B`, `setActiveWindow()` skips calling `fullscreenWin->updateLayer()`, and `fullscreenWin->m_layer` stays cached as `ActiveLayer` (`5`).
2. Next, you **drag** that already-active window from Monitor B onto Monitor A.
   - Because the dragged window is *already* the active window, `setActiveWindow()` is **not** called again.
   - Disassembling `KWin::Window::setOutput()` (`0x4f2910`) and `KWin::Window::setMoveResizeOutput()` (`0x50b760`) shows that **neither function calls `updateLayer()` on fullscreen windows on the target monitor** (whereas `KWin::Window::sendToOutput()` at `0x50e4f8`, used only by keyboard shortcuts, *does* loop through fullscreen windows and call `updateLayer()`!).
   - Consequently, `fullscreenWin->m_layer` (`0x1fc`) remains **permanently stale at `ActiveLayer` (`5`)** throughout the drag, hiding your dragged window underneath the fullscreen app!

---

### Finding #4: The `.rodata` Wayland Layer-Shell Table (`0x8d92e0`) & Shared `AboveLayer` (`3`)

Even if we force `fullscreenWin->updateLayer()` to run when a dragged window enters Monitor A, KWin's default `belongsToLayer()` would drop the unfocused fullscreen window from `ActiveLayer` (`5`) down to `NormalLayer` (`2`), causing the Plasma Taskbar to pop up over the fullscreen app.

Why doesn't the Plasma Taskbar cover windows in `AboveLayer` (`3`)?

In `KWin::Window::layer() const` (`0x4fc9d0`) and `KWin::Window::updateLayer()` (`0x4fcaf0`), Wayland layer-shell surfaces (`KWin::LayerSurfaceV1Interface`, used by the Plasma Panel / Taskbar) determine their KWin layer via a 4-integer lookup table in `.rodata` at address `0x8d92e0`:

```objdump
  4fcaf0: 48 8b bb 70 05 00 00  mov    0x570(%rbx),%rdi
  4fcaf7: ff 15 d3 17 54 00     call   *0x5417d3(%rip)       # LayerSurfaceV1Interface::layer() const
  4fcafd: 48 8d 15 dc c7 3d 00  lea    0x3dc7dc(%rip),%rdx   # lookup table at 0x8d92e0
  4fcb04: 89 c0                 mov    %eax,%eax
  4fcb06: 8b 04 82              mov    (%rdx,%rax,4),%eax    # KWin::Layer = table[layerSurface->layer()]
```

Dumping `.rodata` at `0x8d92e0` from `/usr/lib/libkwin.so.6`:

```text
Contents of section .rodata:
 8d92e0 00000000 01000000 03000000 09000000
```

| `zwlr_layer_shell_v1` Layer | `.rodata` Value at `0x8d92e0` | Mapped `KWin::Layer` |
| :---: | :---: | :--- |
| `0` (`BACKGROUND`) | `0x00000000` (`0`) | `DesktopLayer` (`0`) |
| `1` (`BOTTOM`) | `0x00000001` (`1`) | `BelowLayer` (`1`) |
| `2` (`TOP` — **Plasma Panel / Taskbar**) | `0x00000003` (`3`) | **`AboveLayer` (`3`)** |
| `3` (`OVERLAY`) | `0x00000009` (`9`) | `OverlayLayer` (`9`) |

And in `KWin::Window::belongsToLayer()` (`0x5038ed`), X11/Wayland `NET::Dock` (`0x2`) windows also jump to `0x503ab0`, which returns `0x3` (`AboveLayer`).

**Crucial insight:**
- The Plasma Taskbar lives in **`AboveLayer` (`3`)**.
- Normal windows with `keepAbove = true` **also** live in **`AboveLayer` (`3`)**.
- An unfocused fullscreen window (`isActiveFullScreen() == false`) with `keepAbove = true` **also** lives in **`AboveLayer` (`3`)**!

Within `AboveLayer` (`3`), `KWin::Workspace::constrainedStackingOrder()` (`0x349f50`) preserves the relative order of windows from `unconstrained_stacking_order`, which is controlled by `Workspace::raiseWindow()`.

---

### Finding #5: How the Script Combines `setKeepAbove()` (`0x4fd19d`) + `raiseWindow()`

Disassembling `KWin::Window::setKeepAbove(bool)` (`0x4fd19d`) shows:

```objdump
  4fd1a7: 40 88 b3 5b 01 00 00  mov    %sil,0x15b(%rbx)      # this->m_keepAbove = b
  ...
  4fd1ca: 48 89 df              mov    %rbx,%rdi
  4fd1cd: ff 15 ed c7 53 00     call   *0x53c7ed(%rip)       # KWin::Window::updateLayer()
```

Whenever `window.keepAbove` is mutated from a KWin Script, C++ immediately invokes `KWin::Window::updateLayer()`, which resets `m_layer` (`0x1fc`) to `0xffffffff` (`UnknownLayer`) and recalculates the stacking order!

By combining all five findings, [`contents/code/main.js`](contents/code/main.js) implements a clean state machine:

1. **Real-Time Drag & Focus Tracking:**
   The script hooks `workspace.windowActivated` as well as per-window `interactiveMoveResizeStepped`, `outputChanged`, `fullScreenChanged`, and `minimizedChanged`.
2. **When a Normal Window Overlaps an Unfocused Fullscreen Window's Monitor:**
   The instant `rectsIntersect(activeWindow.frameGeometry, fullscreenWindow.output.geometry)` becomes `true`:
   - In KWin C++, `activeWindow->isOnOutput(fullscreenWindow->output())` is now `true`, so `fullscreenWindow->isActiveFullScreen()` will return `false` as soon as `updateLayer()` is triggered.
   - The script sets `fullscreenWindow.keepAbove = true` (toggling `false -> true` if already set so `setKeepAbove()` isn't short-circuited), forcing C++ `Window::updateLayer()` to run and moving `fullscreenWindow` from `ActiveLayer` (`5`) into `AboveLayer` (`3`).
   - The script sets `activeWindow.keepAbove = true`, placing `activeWindow` into `AboveLayer` (`3`) as well.
   - The script calls:
     ```javascript
     workspace.raiseWindow(fs);
     // (raise any other promoted windows on that output)
     workspace.raiseWindow(active);
     ```
     This orders the three surfaces inside `AboveLayer` (`3`) from bottom to top as:
     $$\text{Plasma Taskbar (Layer 3)} < \text{Fullscreen App (Layer 3)} < \text{Active/Dragged Window (Layer 3)}$$
   - Because this state is guarded by `fs._win11OverlayActive`, subsequent `interactiveMoveResizeStepped` signals during the same drag perform a fast boolean check with zero redundant D-Bus/compositor work.
3. **When the Fullscreen Window is Focused Again (or Overlapping Windows Leave):**
   - When the user clicks back on the fullscreen window (`fs.active === true`), or drags the normal window off the fullscreen monitor, the script clears the managed `keepAbove` flags (`_win11FsKeepAbove`).
   - Normal windows return to `NormalLayer` (`2`) behind the fullscreen window, and the focused fullscreen window returns to `ActiveLayer` (`5`).
   - Any window where the user *manually* enabled "Keep Above" outside the script is untouched, because the script tracks its own promotions via the `_win11FsKeepAbove` property.

---

## License

GPL-2.0-or-later
