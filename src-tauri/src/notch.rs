use std::time::Duration;
use tauri::{
    window::Color, AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, Size,
    WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

pub const NOTCH_LABEL: &str = "notch";

// Fixed transparent canvas anchored permanently to the top-center monitor bezel.
// Never resizing the native HWND eliminates Win32 resize flashes and position glitches.
pub const NOTCH_CANVAS_WIDTH: f64 = 420.0;
pub const NOTCH_CANVAS_HEIGHT: f64 = 204.0;

// Logical hitboxes inside the top-centered fixed canvas
const COLLAPSED_HIT_W: f64 = 206.0;
const COLLAPSED_HIT_H: f64 = 44.0;
const EXPANDED_HIT_W: f64 = 382.0;
const EXPANDED_HIT_H: f64 = 172.0;

// Must match `additionalBrowserArgs` in tauri.conf.json for the main window
const SHARED_BROWSER_ARGS: &str = "--autoplay-policy=no-user-gesture-required";

fn position_notch_canvas(window: &WebviewWindow) {
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

        let x = mon_x + (mon_w - NOTCH_CANVAS_WIDTH) / 2.0;
        let y = mon_y;

        let _ = window.set_size(Size::Logical(LogicalSize {
            width: NOTCH_CANVAS_WIDTH,
            height: NOTCH_CANVAS_HEIGHT,
        }));
        let _ = window.set_position(Position::Logical(LogicalPosition { x, y }));
    }
}

fn spawn_cursor_tracker(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut expanded = false;
        let mut outside_ticks: u8 = 0;

        loop {
            let Some(window) = app.get_webview_window(NOTCH_LABEL) else {
                tokio::time::sleep(Duration::from_millis(250)).await;
                continue;
            };

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

                let in_collapsed = rel_x >= (NOTCH_CANVAS_WIDTH - COLLAPSED_HIT_W) / 2.0
                    && rel_x <= (NOTCH_CANVAS_WIDTH + COLLAPSED_HIT_W) / 2.0
                    && rel_y >= -4.0
                    && rel_y <= COLLAPSED_HIT_H;

                let in_expanded = rel_x >= (NOTCH_CANVAS_WIDTH - EXPANDED_HIT_W) / 2.0
                    && rel_x <= (NOTCH_CANVAS_WIDTH + EXPANDED_HIT_W) / 2.0
                    && rel_y >= -4.0
                    && rel_y <= EXPANDED_HIT_H;

                if !expanded && in_collapsed {
                    expanded = true;
                    outside_ticks = 0;
                    let _ = window.set_ignore_cursor_events(false);
                    // Pre-focus the Notch HWND on intentional hover so Windows WebView2
                    // never swallows the first click to activate the window.
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

    let window = WebviewWindowBuilder::new(
        app,
        NOTCH_LABEL,
        WebviewUrl::App("index.html?window=notch".into()),
    )
    .title("SpotiDesk Notch")
    .inner_size(NOTCH_CANVAS_WIDTH, NOTCH_CANVAS_HEIGHT)
    .decorations(false)
    .transparent(true)
    .background_color(Color(0, 0, 0, 0))
    .shadow(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .additional_browser_args(SHARED_BROWSER_ARGS)
    .visible(true)
    .build()?;

    position_notch_canvas(&window);
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
            position_notch_canvas(&window);
            let _ = window.set_ignore_cursor_events(true);
            let _ = window.show();
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
pub fn send_notch_state(app: AppHandle, payload: serde_json::Value) {
    let _ = app.emit_to(NOTCH_LABEL, "notch-state", payload);
}

#[tauri::command]
pub fn send_notch_action(app: AppHandle, action: String) {
    if action == "open-main" {
        crate::tray::show_main_window(&app);
        return;
    }
    let _ = app.emit_to("main", "notch-action", action);
}
