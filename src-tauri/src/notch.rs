use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
#[cfg(not(target_os = "macos"))]
use tauri::{LogicalPosition, LogicalSize, Position, Size};
use tauri::{
    window::Color, AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

pub const NOTCH_LABEL: &str = "notch";

// Default Windows top canvas dimensions (kept identical for Windows)
#[cfg(not(target_os = "macos"))]
pub const TOP_CANVAS_WIDTH: f64 = 420.0;
#[cfg(not(target_os = "macos"))]
pub const TOP_CANVAS_HEIGHT: f64 = 204.0;

// macOS top canvas dimensions (extra room for hardware notch safe-area + unclipped shadow)
#[cfg(target_os = "macos")]
pub const MAC_TOP_CANVAS_WIDTH: f64 = 468.0;
#[cfg(target_os = "macos")]
pub const MAC_TOP_CANVAS_HEIGHT: f64 = 264.0;

// Side (left / right) canvas dimensions (room for unclipped horizontal shadow)
pub const SIDE_CANVAS_WIDTH: f64 = 428.0;
pub const SIDE_CANVAS_HEIGHT: f64 = 228.0;

// Logical hitboxes inside the top-centered fixed canvas
const TOP_COLLAPSED_HIT_W: f64 = 158.0;
const TOP_COLLAPSED_HIT_H: f64 = 42.0;
const TOP_EXPANDED_HIT_W: f64 = 382.0;
const TOP_EXPANDED_HIT_H: f64 = 172.0;

// Logical hitboxes for Left / Right side notch
const SIDE_COLLAPSED_HIT_W: f64 = 38.0;
const SIDE_COLLAPSED_HIT_H: f64 = 112.0;
const SIDE_EXPANDED_HIT_W: f64 = 384.0;
const SIDE_EXPANDED_HIT_H: f64 = 174.0;

// Must match `additionalBrowserArgs` in tauri.conf.json for the main window
const SHARED_BROWSER_ARGS: &str = "--autoplay-policy=no-user-gesture-required";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NotchPosition {
    Top,
    Left,
    Right,
}

impl Default for NotchPosition {
    fn default() -> Self {
        Self::Top
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotchLayoutPayload {
    pub position: NotchPosition,
    pub is_macos: bool,
    pub has_hardware_notch: bool,
    pub notch_width: f64,
    pub notch_height: f64,
}

impl Default for NotchLayoutPayload {
    fn default() -> Self {
        Self {
            position: NotchPosition::Top,
            is_macos: cfg!(target_os = "macos"),
            has_hardware_notch: false,
            notch_width: 0.0,
            notch_height: 0.0,
        }
    }
}

pub struct NotchState {
    layout: Mutex<NotchLayoutPayload>,
}

impl NotchState {
    pub fn new() -> Self {
        Self {
            layout: Mutex::new(NotchLayoutPayload::default()),
        }
    }

    pub fn snapshot(&self) -> NotchLayoutPayload {
        self.layout
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default()
    }

    pub fn update(&self, layout: NotchLayoutPayload) {
        if let Ok(mut guard) = self.layout.lock() {
            *guard = layout;
        }
    }
}

fn canvas_size_for(position: NotchPosition) -> (f64, f64) {
    match position {
        NotchPosition::Top => {
            #[cfg(target_os = "macos")]
            {
                (MAC_TOP_CANVAS_WIDTH, MAC_TOP_CANVAS_HEIGHT)
            }
            #[cfg(not(target_os = "macos"))]
            {
                (TOP_CANVAS_WIDTH, TOP_CANVAS_HEIGHT)
            }
        }
        NotchPosition::Left | NotchPosition::Right => (SIDE_CANVAS_WIDTH, SIDE_CANVAS_HEIGHT),
    }
}

#[cfg(target_os = "macos")]
mod macos_notch {
    use super::{canvas_size_for, NotchLayoutPayload, NotchPosition};
    use objc2::rc::Retained;
    use objc2::{msg_send, sel, MainThreadMarker};
    use objc2_app_kit::{NSColor, NSScreen, NSWindow, NSWindowCollectionBehavior};
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_foundation::NSEdgeInsets;
    use std::sync::mpsc;
    use std::time::Duration;
    use tauri::WebviewWindow;

    // Above NSMainMenuWindowLevel (24) and NSStatusWindowLevel (25) so the Notch overlays
    // the macOS menu bar & physical hardware notch seamlessly.
    const MAC_NOTCH_WINDOW_LEVEL: isize = 27;

    fn pick_screen(ns_win: &NSWindow, mtm: MainThreadMarker) -> Option<Retained<NSScreen>> {
        // Prefer the screen hosting the window, falling back to mainScreen or primary screen (index 0)
        ns_win
            .screen()
            .or_else(|| NSScreen::mainScreen(mtm))
            .or_else(|| {
                let screens = NSScreen::screens(mtm);
                if screens.count() > 0 {
                    Some(screens.objectAtIndex(0))
                } else {
                    None
                }
            })
    }

    fn detect_screen_notch(screen: &NSScreen) -> (bool, f64, f64) {
        let frame = screen.frame();
        let visible = screen.visibleFrame();
        let top_bar_height = (frame.origin.y + frame.size.height)
            - (visible.origin.y + visible.size.height);

        // macOS 12+ provides safeAreaInsets & auxiliaryTopLeftArea / auxiliaryTopRightArea
        let has_safe_area: bool = unsafe { msg_send![screen, respondsToSelector: sel!(safeAreaInsets)] };
        if has_safe_area {
            let insets: NSEdgeInsets = unsafe { msg_send![screen, safeAreaInsets] };
            if insets.top > 0.0 {
                let mut cutout_w = 186.0;
                let has_aux_left: bool =
                    unsafe { msg_send![screen, respondsToSelector: sel!(auxiliaryTopLeftArea)] };
                let has_aux_right: bool =
                    unsafe { msg_send![screen, respondsToSelector: sel!(auxiliaryTopRightArea)] };
                if has_aux_left && has_aux_right {
                    let left: CGRect = unsafe { msg_send![screen, auxiliaryTopLeftArea] };
                    let right: CGRect = unsafe { msg_send![screen, auxiliaryTopRightArea] };
                    let computed = frame.size.width - left.size.width - right.size.width;
                    if (110.0..=320.0).contains(&computed) {
                        cutout_w = computed;
                    }
                }
                return (true, cutout_w.round(), insets.top.round());
            }
        }

        // External display or non-notch Mac: still sit flush at y=0 over the menu bar
        let bar_h = if (20.0..=50.0).contains(&top_bar_height) {
            top_bar_height.round()
        } else {
            28.0
        };
        (false, 0.0, bar_h)
    }

    fn apply_layout_on_main(
        window: &WebviewWindow,
        position: NotchPosition,
        mtm: MainThreadMarker,
    ) -> NotchLayoutPayload {
        let (canvas_w, canvas_h) = canvas_size_for(position);
        let mut layout = NotchLayoutPayload {
            position,
            is_macos: true,
            has_hardware_notch: false,
            notch_width: 0.0,
            notch_height: 32.0,
        };

        if let Ok(ptr) = window.ns_window() {
            let ns_win: &NSWindow = unsafe { &*(ptr as *const NSWindow) };

            // Keep the Notch above the macOS menu bar & across all Spaces / fullscreen apps
            ns_win.setLevel(MAC_NOTCH_WINDOW_LEVEL);
            ns_win.setCollectionBehavior(
                NSWindowCollectionBehavior::CanJoinAllSpaces
                    | NSWindowCollectionBehavior::Stationary
                    | NSWindowCollectionBehavior::FullScreenAuxiliary
                    | NSWindowCollectionBehavior::IgnoresCycle,
            );
            ns_win.setOpaque(false);
            ns_win.setBackgroundColor(Some(&NSColor::clearColor()));
            ns_win.setHasShadow(false);
            ns_win.invalidateShadow();
            ns_win.setMovable(false);
            // Never hide the Notch when the user hides the main app with Cmd+H
            ns_win.setCanHide(false);
            ns_win.setHidesOnDeactivate(false);
            // Deliver hover/move events inside the Notch WKWebView even when another window is key
            ns_win.setAcceptsMouseMovedEvents(true);

            if let Some(screen) = pick_screen(ns_win, mtm) {
                let frame = screen.frame();
                let (has_hw, cutout_w, notch_h) = detect_screen_notch(&screen);
                layout.has_hardware_notch = has_hw;
                layout.notch_width = cutout_w;
                layout.notch_height = notch_h;

                // AppKit coordinates have origin at bottom-left; Y increases upward.
                let (origin_x, origin_y) = match position {
                    NotchPosition::Top => (
                        frame.origin.x + (frame.size.width - canvas_w) / 2.0,
                        frame.origin.y + frame.size.height - canvas_h,
                    ),
                    NotchPosition::Left => (
                        frame.origin.x,
                        frame.origin.y + (frame.size.height - canvas_h) / 2.0,
                    ),
                    NotchPosition::Right => (
                        frame.origin.x + frame.size.width - canvas_w,
                        frame.origin.y + (frame.size.height - canvas_h) / 2.0,
                    ),
                };

                let target_rect = CGRect::new(
                    CGPoint::new(origin_x, origin_y),
                    CGSize::new(canvas_w, canvas_h),
                );
                ns_win.setFrame_display(target_rect, true);
                if window.is_visible().unwrap_or(false) {
                    ns_win.orderFrontRegardless();
                }
            }
        }

        layout
    }

    pub fn apply_layout(window: &WebviewWindow, position: NotchPosition) -> NotchLayoutPayload {
        // Avoid deadlocking when already on the macOS main thread (e.g. setup / sync commands)
        if let Some(mtm) = MainThreadMarker::new() {
            return apply_layout_on_main(window, position, mtm);
        }

        let (tx, rx) = mpsc::channel();
        let win_clone = window.clone();

        let _ = window.run_on_main_thread(move || {
            let layout = if let Some(mtm) = MainThreadMarker::new() {
                apply_layout_on_main(&win_clone, position, mtm)
            } else {
                NotchLayoutPayload {
                    position,
                    is_macos: true,
                    has_hardware_notch: false,
                    notch_width: 0.0,
                    notch_height: 32.0,
                }
            };
            let _ = tx.send(layout);
        });

        rx.recv_timeout(Duration::from_millis(400))
            .unwrap_or(NotchLayoutPayload {
                position,
                is_macos: true,
                has_hardware_notch: false,
                notch_width: 0.0,
                notch_height: 32.0,
            })
    }
}

#[cfg(not(target_os = "macos"))]
fn position_notch_canvas_non_macos(
    window: &WebviewWindow,
    position: NotchPosition,
) -> NotchLayoutPayload {
    let (canvas_w, canvas_h) = canvas_size_for(position);

    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());

    if let Some(monitor) = monitor {
        let scale = monitor.scale_factor();
        let mon_pos = monitor.position();
        let mon_size = monitor.size();

        let mon_x = mon_pos.x as f64 / scale;
        let mon_y = mon_pos.y as f64 / scale;
        let mon_w = mon_size.width as f64 / scale;
        let mon_h = mon_size.height as f64 / scale;

        let (x, y) = match position {
            NotchPosition::Top => (mon_x + (mon_w - canvas_w) / 2.0, mon_y),
            NotchPosition::Left => (mon_x, mon_y + (mon_h - canvas_h) / 2.0),
            NotchPosition::Right => (mon_x + mon_w - canvas_w, mon_y + (mon_h - canvas_h) / 2.0),
        };

        let _ = window.set_size(Size::Logical(LogicalSize {
            width: canvas_w,
            height: canvas_h,
        }));
        let _ = window.set_position(Position::Logical(LogicalPosition { x, y }));
    }

    NotchLayoutPayload {
        position,
        is_macos: false,
        has_hardware_notch: false,
        notch_width: 0.0,
        notch_height: 0.0,
    }
}

pub fn apply_notch_layout(app: &AppHandle, window: &WebviewWindow, position: NotchPosition) -> NotchLayoutPayload {
    #[cfg(target_os = "macos")]
    let layout = macos_notch::apply_layout(window, position);

    #[cfg(not(target_os = "macos"))]
    let layout = position_notch_canvas_non_macos(window, position);

    app.state::<NotchState>().update(layout.clone());
    let _ = app.emit_to(NOTCH_LABEL, "notch-layout", &layout);
    layout
}

fn compute_hitboxes(layout: &NotchLayoutPayload) -> ((f64, f64, f64, f64), (f64, f64, f64, f64)) {
    let (canvas_w, canvas_h) = canvas_size_for(layout.position);
    match layout.position {
        NotchPosition::Top => {
            if layout.is_macos && layout.has_hardware_notch {
                let collapsed_w = (layout.notch_width + 62.0).min(canvas_w - 8.0);
                let collapsed_h = (layout.notch_height + 6.0).max(38.0);
                let expanded_w = 394.0_f64.min(canvas_w - 8.0);
                let expanded_h = (layout.notch_height + 168.0).min(canvas_h - 8.0);
                (
                    (
                        (canvas_w - collapsed_w) / 2.0,
                        (canvas_w + collapsed_w) / 2.0,
                        -6.0,
                        collapsed_h,
                    ),
                    (
                        (canvas_w - expanded_w) / 2.0,
                        (canvas_w + expanded_w) / 2.0,
                        -6.0,
                        expanded_h,
                    ),
                )
            } else {
                (
                    (
                        (canvas_w - TOP_COLLAPSED_HIT_W) / 2.0,
                        (canvas_w + TOP_COLLAPSED_HIT_W) / 2.0,
                        -4.0,
                        TOP_COLLAPSED_HIT_H,
                    ),
                    (
                        (canvas_w - TOP_EXPANDED_HIT_W) / 2.0,
                        (canvas_w + TOP_EXPANDED_HIT_W) / 2.0,
                        -4.0,
                        TOP_EXPANDED_HIT_H,
                    ),
                )
            }
        }
        NotchPosition::Left => (
            (
                -4.0,
                SIDE_COLLAPSED_HIT_W,
                (canvas_h - SIDE_COLLAPSED_HIT_H) / 2.0,
                (canvas_h + SIDE_COLLAPSED_HIT_H) / 2.0,
            ),
            (
                -4.0,
                SIDE_EXPANDED_HIT_W,
                (canvas_h - SIDE_EXPANDED_HIT_H) / 2.0,
                (canvas_h + SIDE_EXPANDED_HIT_H) / 2.0,
            ),
        ),
        NotchPosition::Right => (
            (
                canvas_w - SIDE_COLLAPSED_HIT_W,
                canvas_w + 4.0,
                (canvas_h - SIDE_COLLAPSED_HIT_H) / 2.0,
                (canvas_h + SIDE_COLLAPSED_HIT_H) / 2.0,
            ),
            (
                canvas_w - SIDE_EXPANDED_HIT_W,
                canvas_w + 4.0,
                (canvas_h - SIDE_EXPANDED_HIT_H) / 2.0,
                (canvas_h + SIDE_EXPANDED_HIT_H) / 2.0,
            ),
        ),
    }
}

fn spawn_cursor_tracker(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut expanded = false;
        let mut outside_ticks: u8 = 0;
        let mut last_position = app.state::<NotchState>().snapshot().position;

        loop {
            let Some(window) = app.get_webview_window(NOTCH_LABEL) else {
                tokio::time::sleep(Duration::from_millis(250)).await;
                continue;
            };

            let layout = app.state::<NotchState>().snapshot();
            if layout.position != last_position {
                last_position = layout.position;
                if expanded {
                    expanded = false;
                    outside_ticks = 0;
                    let _ = window.set_ignore_cursor_events(true);
                    let _ = window.emit("notch-hover", false);
                }
            }

            if !window.is_visible().unwrap_or(false) {
                if expanded {
                    expanded = false;
                    outside_ticks = 0;
                    let _ = window.set_ignore_cursor_events(true);
                    let _ = window.emit("notch-hover", false);
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
                continue;
            }

            if let (Ok(cursor), Ok(win_pos), Ok(scale)) = (
                window.cursor_position(),
                window.outer_position(),
                window.scale_factor(),
            ) {
                let rel_x = (cursor.x - win_pos.x as f64) / scale;
                let rel_y = (cursor.y - win_pos.y as f64) / scale;

                let ((cx1, cx2, cy1, cy2), (ex1, ex2, ey1, ey2)) = compute_hitboxes(&layout);

                let in_collapsed = rel_x >= cx1 && rel_x <= cx2 && rel_y >= cy1 && rel_y <= cy2;
                let in_expanded = rel_x >= ex1 && rel_x <= ex2 && rel_y >= ey1 && rel_y <= ey2;

                if !expanded && in_collapsed {
                    expanded = true;
                    outside_ticks = 0;
                    let _ = window.set_ignore_cursor_events(false);
                    // On Windows, pre-focus the Notch HWND on intentional hover so WebView2
                    // never swallows the first click to activate the window.
                    // On macOS, avoid stealing focus from the user's active application.
                    #[cfg(not(target_os = "macos"))]
                    let _ = window.set_focus();
                    let _ = window.emit("notch-hover", true);
                } else if expanded {
                    if in_expanded {
                        outside_ticks = 0;
                    } else {
                        outside_ticks = outside_ticks.saturating_add(1);
                        // ~110ms grace period before deflating cleanly
                        if outside_ticks >= 2 {
                            expanded = false;
                            outside_ticks = 0;
                            let _ = window.emit("notch-hover", false);
                            let _ = window.set_ignore_cursor_events(true);
                        }
                    }
                }
            }

            tokio::time::sleep(Duration::from_millis(55)).await;
        }
    });
}

pub fn create_notch_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(existing) = app.get_webview_window(NOTCH_LABEL) {
        return Ok(existing);
    }

    let position = app.state::<NotchState>().snapshot().position;
    let (canvas_w, canvas_h) = canvas_size_for(position);

    let window = WebviewWindowBuilder::new(
        app,
        NOTCH_LABEL,
        WebviewUrl::App("index.html?window=notch".into()),
    )
    .title("SpotiDesk Notch")
    .inner_size(canvas_w, canvas_h)
    .decorations(false)
    .transparent(true)
    .background_color(Color(0, 0, 0, 0))
    .shadow(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .accept_first_mouse(true)
    .additional_browser_args(SHARED_BROWSER_ARGS)
    .visible(true)
    .build()?;

    apply_notch_layout(app, &window, position);
    // Start click-through so the transparent area never blocks desktop clicks
    let _ = window.set_ignore_cursor_events(true);
    spawn_cursor_tracker(app.clone());
    Ok(window)
}

pub fn toggle_notch_window(app: &AppHandle) -> bool {
    if let Some(window) = app.get_webview_window(NOTCH_LABEL) {
        let is_visible = window.is_visible().unwrap_or(false);
        if is_visible {
            let _ = window.hide();
            return false;
        } else {
            let position = app.state::<NotchState>().snapshot().position;
            let _ = window.set_ignore_cursor_events(true);
            let _ = window.show();
            apply_notch_layout(app, &window, position);
            return true;
        }
    }

    match create_notch_window(app) {
        Ok(_) => true,
        Err(err) => {
            eprintln!("[SpotiDesk] No se pudo crear la ventana Notch: {err}");
            false
        }
    }
}

#[tauri::command]
pub fn toggle_notch(app: AppHandle) -> bool {
    toggle_notch_window(&app)
}

#[tauri::command]
pub fn get_notch_visible(app: AppHandle) -> bool {
    app.get_webview_window(NOTCH_LABEL)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

#[tauri::command]
pub fn get_notch_layout(state: State<'_, NotchState>) -> NotchLayoutPayload {
    state.snapshot()
}

#[tauri::command]
pub fn set_notch_position(app: AppHandle, position: NotchPosition) -> NotchLayoutPayload {
    if let Some(window) = app.get_webview_window(NOTCH_LABEL) {
        // Collapse cleanly before relocating
        let _ = window.emit("notch-hover", false);
        let _ = window.set_ignore_cursor_events(true);
        apply_notch_layout(&app, &window, position)
    } else {
        let mut current = app.state::<NotchState>().snapshot();
        current.position = position;
        app.state::<NotchState>().update(current.clone());
        current
    }
}

#[tauri::command]
pub fn send_notch_state(app: AppHandle, payload: serde_json::Value) {
    #[cfg(target_os = "macos")]
    crate::shortcuts::update_macos_now_playing(&app, &payload);
    let _ = app.emit_to(NOTCH_LABEL, "notch-state", payload);
}

#[tauri::command]
pub fn send_notch_action(app: AppHandle, action: String) {
    if action == "open-main" {
        crate::tray::show_main_window(&app);
        return;
    }
    if action == "request-state" {
        let layout = app.state::<NotchState>().snapshot();
        let _ = app.emit_to(NOTCH_LABEL, "notch-layout", &layout);
    }
    let _ = app.emit_to("main", "notch-action", action);
}
