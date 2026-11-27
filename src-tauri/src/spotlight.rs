use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const SPOTLIGHT_LABEL: &str = "spotlight";
const SPOTLIGHT_WIDTH: f64 = 592.0;
const SPOTLIGHT_HEIGHT: f64 = 472.0;

#[cfg(target_os = "macos")]
mod macos_spotlight {
    use super::{SPOTLIGHT_HEIGHT, SPOTLIGHT_WIDTH};
    use objc2::rc::Retained;
    use objc2::{class, msg_send, MainThreadMarker};
    use objc2_app_kit::{NSColor, NSScreen, NSWindow, NSWindowCollectionBehavior};
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use tauri::WebviewWindow;

    // Floating panel level above normal apps & fullscreen Spaces, below screen-saver
    const SPOTLIGHT_WINDOW_LEVEL: isize = 25;

    fn pick_active_screen(mtm: MainThreadMarker) -> Option<Retained<NSScreen>> {
        // Pick the screen currently containing the mouse cursor (just like macOS Spotlight / Raycast)
        let mouse: CGPoint = unsafe { msg_send![class!(NSEvent), mouseLocation] };
        let screens = NSScreen::screens(mtm);
        for i in 0..screens.count() {
            let screen = screens.objectAtIndex(i);
            let frame = screen.frame();
            let in_x = mouse.x >= frame.origin.x && mouse.x <= frame.origin.x + frame.size.width;
            let in_y = mouse.y >= frame.origin.y && mouse.y <= frame.origin.y + frame.size.height;
            if in_x && in_y {
                return Some(screen);
            }
        }
        NSScreen::mainScreen(mtm).or_else(|| {
            if screens.count() > 0 {
                Some(screens.objectAtIndex(0))
            } else {
                None
            }
        })
    }

    pub fn configure(window: &WebviewWindow) {
        let win = window.clone();
        let _ = window.run_on_main_thread(move || {
            if let Ok(ptr) = win.ns_window() {
                let ns_win: &NSWindow = unsafe { &*(ptr as *const NSWindow) };
                ns_win.setLevel(SPOTLIGHT_WINDOW_LEVEL);
                // CanJoinAllSpaces and MoveToActiveSpace are mutually exclusive in AppKit
                // (combining both raises NSInvalidArgumentException on macOS).
                ns_win.setCollectionBehavior(
                    NSWindowCollectionBehavior::CanJoinAllSpaces
                        | NSWindowCollectionBehavior::FullScreenAuxiliary
                        | NSWindowCollectionBehavior::IgnoresCycle,
                );
                ns_win.setOpaque(false);
                ns_win.setBackgroundColor(Some(&NSColor::clearColor()));
                ns_win.setHasShadow(false);
                ns_win.invalidateShadow();
                ns_win.setCanHide(false);
                ns_win.setHidesOnDeactivate(false);
            }
        });
    }

    pub fn show_centered_floating(window: &WebviewWindow) {
        let win = window.clone();
        let _ = window.run_on_main_thread(move || {
            let Some(mtm) = MainThreadMarker::new() else {
                return;
            };
            if let Ok(ptr) = win.ns_window() {
                let ns_win: &NSWindow = unsafe { &*(ptr as *const NSWindow) };
                if let Some(screen) = pick_active_screen(mtm) {
                    let visible = screen.visibleFrame();
                    let x = visible.origin.x + (visible.size.width - SPOTLIGHT_WIDTH) / 2.0;
                    // macOS origin is bottom-left: place Spotlight ~16% down from top edge
                    let top_edge = visible.origin.y + visible.size.height;
                    let y = (top_edge - visible.size.height * 0.16 - SPOTLIGHT_HEIGHT)
                        .max(visible.origin.y + 24.0);
                    let frame = CGRect::new(
                        CGPoint::new(x.round(), y.round()),
                        CGSize::new(SPOTLIGHT_WIDTH, SPOTLIGHT_HEIGHT),
                    );
                    ns_win.setFrame_display(frame, true);
                }
                // Activate ONLY this floating panel without pulling the main SpotiDesk window forward
                unsafe {
                    let current_app: *mut objc2::runtime::AnyObject =
                        msg_send![class!(NSRunningApplication), currentApplication];
                    if !current_app.is_null() {
                        // NSApplicationActivateIgnoringOtherApps = 1 << 1 (omits ActivateAllWindows)
                        let _: bool = msg_send![current_app, activateWithOptions: 2usize];
                    }
                    let _: () = msg_send![ns_win, makeKeyAndOrderFront: std::ptr::null::<objc2::runtime::AnyObject>()];
                }
            }
        });
    }
}

#[cfg(not(target_os = "macos"))]
mod macos_spotlight {
    use super::{SPOTLIGHT_HEIGHT, SPOTLIGHT_WIDTH};
    use tauri::{LogicalPosition, LogicalSize, WebviewWindow};

    pub fn configure(_window: &WebviewWindow) {}

    pub fn show_centered_floating(window: &WebviewWindow) {
        let _ = window.set_size(LogicalSize::new(SPOTLIGHT_WIDTH, SPOTLIGHT_HEIGHT));
        if let Ok(Some(monitor)) = window.current_monitor().or_else(|_| window.primary_monitor()) {
            let scale = monitor.scale_factor();
            let size = monitor.size();
            let pos = monitor.position();
            let w_logical = size.width as f64 / scale;
            let h_logical = size.height as f64 / scale;
            let x = (pos.x as f64 / scale) + (w_logical - SPOTLIGHT_WIDTH) / 2.0;
            let y = (pos.y as f64 / scale) + (h_logical * 0.16);
            let _ = window.set_position(LogicalPosition::new(x.round(), y.round()));
        }
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn create_spotlight_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(existing) = app.get_webview_window(SPOTLIGHT_LABEL) {
        return Ok(existing);
    }

    let win = WebviewWindowBuilder::new(
        app,
        SPOTLIGHT_LABEL,
        WebviewUrl::App("index.html?window=spotlight".into()),
    )
    .title("SpotiDesk Spotlight")
    .inner_size(SPOTLIGHT_WIDTH, SPOTLIGHT_HEIGHT)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .visible(false)
    .build()?;

    macos_spotlight::configure(&win);
    Ok(win)
}

pub fn toggle_spotlight(app: &AppHandle) {
    let win = match app.get_webview_window(SPOTLIGHT_LABEL) {
        Some(w) => w,
        None => match create_spotlight_window(app) {
            Ok(w) => w,
            Err(err) => {
                eprintln!("[SpotiDesk] No se pudo crear ventana Spotlight: {err}");
                return;
            }
        },
    };

    let currently_visible = win.is_visible().unwrap_or(false);
    if currently_visible {
        let _ = win.hide();
        return;
    }

    // Request fresh state from main window right as Spotlight opens
    let _ = app.emit_to("main", "spotlight-request-state", ());
    let _ = app.emit_to(SPOTLIGHT_LABEL, "spotlight-opened", ());
    macos_spotlight::show_centered_floating(&win);
}

#[tauri::command]
pub fn hide_spotlight(app: AppHandle) {
    if let Some(win) = app.get_webview_window(SPOTLIGHT_LABEL) {
        let _ = win.hide();
    }
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    if let Some(spotlight) = app.get_webview_window(SPOTLIGHT_LABEL) {
        let _ = spotlight.hide();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
}

#[tauri::command]
pub fn request_spotlight_state(app: AppHandle) {
    let _ = app.emit_to("main", "spotlight-request-state", ());
}

#[tauri::command]
pub fn send_spotlight_state(app: AppHandle, payload: Value) {
    let _ = app.emit_to(SPOTLIGHT_LABEL, "spotlight-state", payload);
}

#[tauri::command]
pub fn send_spotlight_action(app: AppHandle, payload: Value) {
    let _ = app.emit_to("main", "spotlight-action", payload);
}
