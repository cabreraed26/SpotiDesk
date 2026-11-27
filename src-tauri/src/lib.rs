mod auth;
mod notch;
mod shortcuts;
mod spotlight;
mod tray;

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, PhysicalSize, State, Theme, WebviewWindow, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

const GITHUB_RELEASES_API: &str =
    "https://api.github.com/repos/cabreraed26/SpotiDesk/releases/latest";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub release_url: String,
    pub notes: Option<String>,
}

fn parse_semver_tuple(v: &str) -> (u64, u64, u64) {
    let clean = v.trim().trim_start_matches(['v', 'V']);
    let mut parts = clean.split('.').map(|p| {
        p.chars()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .parse::<u64>()
            .unwrap_or(0)
    });
    (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    )
}

#[tauri::command]
async fn check_for_updates(app: AppHandle) -> Result<UpdateCheckResult, String> {
    let current_version = app.package_info().version.to_string();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .user_agent(format!("SpotiDesk/{current_version}"))
        .build()
        .map_err(|e| format!("No se pudo iniciar cliente HTTP: {e}"))?;

    let resp = client
        .get(GITHUB_RELEASES_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|_| "No se pudo conectar con GitHub para buscar actualizaciones.".to_string())?;

    if resp.status().as_u16() == 404 {
        return Ok(UpdateCheckResult {
            current_version: current_version.clone(),
            latest_version: current_version,
            has_update: false,
            release_url: "https://github.com/cabreraed26/SpotiDesk/releases".to_string(),
            notes: None,
        });
    }

    if !resp.status().is_success() {
        return Err(format!(
            "GitHub respondió con estado {}.",
            resp.status().as_u16()
        ));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|_| "Respuesta inválida al consultar actualizaciones.".to_string())?;

    let tag = body
        .get("tag_name")
        .and_then(|v| v.as_str())
        .unwrap_or(&current_version);
    let latest_version = tag.trim().trim_start_matches(['v', 'V']).to_string();
    let release_url = body
        .get("html_url")
        .and_then(|v| v.as_str())
        .unwrap_or("https://github.com/cabreraed26/SpotiDesk/releases")
        .to_string();
    let notes = body
        .get("body")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let has_update = parse_semver_tuple(&latest_version) > parse_semver_tuple(&current_version);

    Ok(UpdateCheckResult {
        current_version,
        latest_version,
        has_update,
        release_url,
        notes,
    })
}

#[tauri::command]
async fn translate_lyrics(lines: Vec<String>, target_lang: String) -> Result<Vec<String>, String> {
    if lines.is_empty() {
        return Ok(vec![]);
    }
    let tl = if target_lang.trim().is_empty() {
        "es".to_string()
    } else {
        target_lang.trim().to_string()
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .user_agent("SpotiDesk/0.2.0")
        .build()
        .map_err(|e| format!("Error iniciando cliente de traducción: {e}"))?;

    // Translate in compact chunks separated by newlines so line indices stay aligned 1-to-1
    let mut results = vec![String::new(); lines.len()];
    let mut idx = 0;

    while idx < lines.len() {
        let mut batch_indices = Vec::new();
        let mut batch_text = String::new();

        while idx < lines.len() {
            let line = lines[idx].trim();
            if line.is_empty() || line == "···" {
                idx += 1;
                continue;
            }
            if !batch_text.is_empty() && batch_text.len() + line.len() + 1 > 1300 {
                break;
            }
            if !batch_text.is_empty() {
                batch_text.push('\n');
            }
            batch_text.push_str(line);
            batch_indices.push(idx);
            idx += 1;
        }

        if batch_indices.is_empty() {
            continue;
        }

        let resp = client
            .get("https://translate.googleapis.com/translate_a/single")
            .query(&[
                ("client", "gtx"),
                ("sl", "auto"),
                ("tl", tl.as_str()),
                ("dt", "t"),
                ("q", batch_text.as_str()),
            ])
            .send()
            .await
            .map_err(|_| "No se pudo conectar con el servicio de traducción.".to_string())?;

        if !resp.status().is_success() {
            return Err(format!("Error de traducción ({}).", resp.status().as_u16()));
        }

        let json: serde_json::Value = resp
            .json()
            .await
            .map_err(|_| "Respuesta de traducción inválida.".to_string())?;

        let mut combined = String::new();
        if let Some(segments) = json.get(0).and_then(|v| v.as_array()) {
            for seg in segments {
                if let Some(part) = seg.get(0).and_then(|v| v.as_str()) {
                    combined.push_str(part);
                }
            }
        }

        let translated_lines: Vec<&str> = combined.split('\n').collect();
        for (offset, orig_idx) in batch_indices.iter().enumerate() {
            if let Some(tr) = translated_lines.get(offset) {
                let cleaned = tr.trim();
                // Only store if translation actually differs from original text
                if !cleaned.eq_ignore_ascii_case(lines[*orig_idx].trim()) {
                    results[*orig_idx] = cleaned.to_string();
                }
            }
        }
    }

    Ok(results)
}

#[cfg(target_os = "windows")]
fn apply_main_window_corners(window: &WebviewWindow) {
    #[link(name = "dwmapi")]
    unsafe extern "system" {
        fn DwmSetWindowAttribute(
            hwnd: isize,
            dw_attribute: u32,
            pv_attribute: *const std::ffi::c_void,
            cb_attribute: u32,
        ) -> i32;
    }

    const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
    const DWMWCP_ROUND: u32 = 2;
    const DWMWA_SYSTEMBACKDROP_TYPE: u32 = 38;
    const DWMSBT_MAINWINDOW: u32 = 2; // Windows 11 Mica

    if let Ok(hwnd) = window.hwnd() {
        let preference = DWMWCP_ROUND;
        let backdrop = DWMSBT_MAINWINDOW;
        unsafe {
            let _ = DwmSetWindowAttribute(
                hwnd.0 as isize,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                &preference as *const u32 as *const std::ffi::c_void,
                std::mem::size_of::<u32>() as u32,
            );
            let _ = DwmSetWindowAttribute(
                hwnd.0 as isize,
                DWMWA_SYSTEMBACKDROP_TYPE,
                &backdrop as *const u32 as *const std::ffi::c_void,
                std::mem::size_of::<u32>() as u32,
            );
        }
    }
}

#[cfg(target_os = "macos")]
fn apply_main_window_corners(window: &WebviewWindow) {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSWindow, NSWindowTitleVisibility};

    let apply = move |win: &WebviewWindow| {
        if let Ok(ptr) = win.ns_window() {
            let ns_win: &NSWindow = unsafe { &*(ptr as *const NSWindow) };
            ns_win.setTitleVisibility(NSWindowTitleVisibility::Hidden);
            ns_win.setTitlebarAppearsTransparent(true);
            ns_win.setMovable(true);
            ns_win.setMovableByWindowBackground(false);
        }
    };

    if MainThreadMarker::new().is_some() {
        apply(window);
    } else {
        let win_clone = window.clone();
        let _ = window.run_on_main_thread(move || {
            apply(&win_clone);
        });
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn apply_main_window_corners(_window: &WebviewWindow) {}

struct SavedWindowBounds {
    size: PhysicalSize<u32>,
    position: PhysicalPosition<i32>,
}

pub struct AppSettingsState {
    close_to_tray: AtomicBool,
    mini_mode: AtomicBool,
    saved_bounds: Mutex<Option<SavedWindowBounds>>,
    window_drag_offset: Mutex<Option<(f64, f64)>>,
    /// macOS synchronous native TitleBar drag zone: `(height, left_inset, right_inset)` in logical points
    titlebar_drag_zone: Mutex<(f64, f64, f64)>,
}

impl AppSettingsState {
    pub fn new() -> Self {
        Self {
            close_to_tray: AtomicBool::new(true),
            mini_mode: AtomicBool::new(false),
            saved_bounds: Mutex::new(None),
            window_drag_offset: Mutex::new(None),
            titlebar_drag_zone: Mutex::new((40.0, 174.0, 260.0)),
        }
    }
}

#[tauri::command]
fn set_titlebar_drag_zone(
    state: State<'_, AppSettingsState>,
    height: f64,
    left_inset: f64,
    right_inset: f64,
) {
    if let Ok(mut guard) = state.titlebar_drag_zone.lock() {
        *guard = (
            height.clamp(24.0, 80.0),
            left_inset.max(0.0),
            right_inset.max(0.0),
        );
    }
}

/// Installs a synchronous macOS local `NSEvent` monitor for `LeftMouseDown` on the main window's
/// non-button TitleBar zone and hands the live event straight to `NSWindow.performWindowDragWithEvent:`.
/// Because macOS WindowServer owns the drag loop natively, Sequoia/Tahoe window tiling (snap to top,
/// left/right half-screen, corners, Option-drag, and Spaces) works identically to native Apple apps.
#[cfg(target_os = "macos")]
fn install_macos_titlebar_drag_monitor(app: AppHandle) {
    use block2::RcBlock;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_app_kit::NSWindow;
    use objc2_core_foundation::CGPoint;

    const NS_EVENT_MASK_LEFT_MOUSE_DOWN: u64 = 1 << 1;

    let app_clone = app.clone();
    let _ = app.run_on_main_thread(move || unsafe {
        let block = RcBlock::new(move |event: *mut AnyObject| -> *mut AnyObject {
            if event.is_null() {
                return event;
            }
            let Some(main_win) = app_clone.get_webview_window("main") else {
                return event;
            };
            if main_win.is_fullscreen().unwrap_or(false) {
                return event;
            }
            let Ok(main_ptr) = main_win.ns_window() else {
                return event;
            };
            let event_win: *mut AnyObject = msg_send![event, window];
            if event_win != main_ptr as *mut AnyObject {
                return event;
            }

            let ns_win: &NSWindow = &*(main_ptr as *const NSWindow);
            let frame = ns_win.frame();
            let loc: CGPoint = msg_send![event, locationInWindow];
            let y_from_top = frame.size.height - loc.y;

            let (height, left_inset, right_inset) = app_clone
                .state::<AppSettingsState>()
                .titlebar_drag_zone
                .lock()
                .map(|g| *g)
                .unwrap_or((40.0, 174.0, 260.0));

            let in_drag_zone = y_from_top >= 0.0
                && y_from_top <= height
                && loc.x >= left_inset
                && loc.x <= (frame.size.width - right_inset);

            if !in_drag_zone {
                return event;
            }

            let click_count: isize = msg_send![event, clickCount];
            if click_count == 2 {
                let _: () = msg_send![ns_win, performZoom: std::ptr::null::<AnyObject>()];
                return std::ptr::null_mut();
            }

            if click_count == 1 {
                ns_win.setMovable(true);
                let _: () = msg_send![ns_win, performWindowDragWithEvent: event];
                return std::ptr::null_mut();
            }

            event
        });

        let _monitor: *mut AnyObject = msg_send![
            class!(NSEvent),
            addLocalMonitorForEventsMatchingMask: NS_EVENT_MASK_LEFT_MOUSE_DOWN,
            handler: &*block
        ];
        // Keep the monitor block alive for the lifetime of the application
        std::mem::forget(block);
    });
}

#[cfg(not(target_os = "macos"))]
fn install_macos_titlebar_drag_monitor(_app: AppHandle) {}

/// Native macOS main-window drag anchor: captures global NSEvent::mouseLocation()
/// relative to NSWindow.frame().origin in AppKit screen points so TitleBar / MiniPlayer
/// dragging is 100% immune to WKWebView async-IPC performWindowDragWithEvent drops.
#[tauri::command]
fn begin_window_drag(app: AppHandle, state: State<'_, AppSettingsState>) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    if win.is_fullscreen().unwrap_or(false) {
        return;
    }

    #[cfg(target_os = "macos")]
    {
        use objc2::{class, msg_send, MainThreadMarker};
        use objc2_app_kit::NSWindow;
        use objc2_core_foundation::CGPoint;

        let capture = |w: &WebviewWindow| -> Option<(f64, f64)> {
            let ptr = w.ns_window().ok()?;
            let ns_win: &NSWindow = unsafe { &*(ptr as *const NSWindow) };
            let mouse: CGPoint = unsafe { msg_send![class!(NSEvent), mouseLocation] };
            let frame = ns_win.frame();
            ns_win.setMovable(true);
            unsafe {
                let _: () = msg_send![ns_win, makeKeyAndOrderFront: std::ptr::null::<objc2::runtime::AnyObject>()];
            }
            Some((mouse.x - frame.origin.x, mouse.y - frame.origin.y))
        };

        let offset = if MainThreadMarker::new().is_some() {
            capture(&win)
        } else {
            let (tx, rx) = std::sync::mpsc::channel();
            let win_clone = win.clone();
            let _ = win.run_on_main_thread(move || {
                let _ = tx.send(capture(&win_clone));
            });
            rx.recv_timeout(std::time::Duration::from_millis(120))
                .ok()
                .flatten()
        };

        if let Ok(mut guard) = state.window_drag_offset.lock() {
            *guard = offset;
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = state;
        let _ = win.start_dragging();
    }
}

#[tauri::command]
fn drag_window_move(app: AppHandle, state: State<'_, AppSettingsState>) {
    #[cfg(target_os = "macos")]
    {
        let offset = state.window_drag_offset.lock().ok().and_then(|g| *g);
        let Some((dx, dy)) = offset else {
            return;
        };
        let Some(win) = app.get_webview_window("main") else {
            return;
        };

        use objc2::{class, msg_send, MainThreadMarker};
        use objc2_app_kit::NSWindow;
        use objc2_core_foundation::CGPoint;

        let apply_move = move |w: &WebviewWindow| {
            if let Ok(ptr) = w.ns_window() {
                let ns_win: &NSWindow = unsafe { &*(ptr as *const NSWindow) };
                let mouse: CGPoint = unsafe { msg_send![class!(NSEvent), mouseLocation] };
                ns_win.setFrameOrigin(CGPoint::new(mouse.x - dx, mouse.y - dy));
            }
        };

        if MainThreadMarker::new().is_some() {
            apply_move(&win);
        } else {
            let win_clone = win.clone();
            let _ = win.run_on_main_thread(move || {
                apply_move(&win_clone);
            });
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, state);
    }
}

#[tauri::command]
fn end_window_drag(state: State<'_, AppSettingsState>) {
    if let Ok(mut guard) = state.window_drag_offset.lock() {
        *guard = None;
    }
}

#[tauri::command]
fn set_mini_player_mode(
    app: AppHandle,
    state: State<'_, AppSettingsState>,
    enabled: bool,
) -> Result<bool, String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "Ventana principal no encontrada.".to_string())?;

    let was_mini = state.mini_mode.load(Ordering::Relaxed);
    if enabled == was_mini {
        return Ok(enabled);
    }

    if enabled {
        if win.is_fullscreen().unwrap_or(false) {
            let _ = win.set_fullscreen(false);
        }
        if win.is_maximized().unwrap_or(false) {
            let _ = win.unmaximize();
        }

        if let (Ok(size), Ok(position)) = (win.outer_size(), win.outer_position()) {
            if let Ok(mut guard) = state.saved_bounds.lock() {
                *guard = Some(SavedWindowBounds { size, position });
            }
        }

        let _ = win.set_min_size(Some(LogicalSize::new(360.0, 148.0)));
        let _ = win.set_size(LogicalSize::new(396.0, 158.0));
        let _ = win.set_always_on_top(true);
        state.mini_mode.store(true, Ordering::Relaxed);
    } else {
        let _ = win.set_always_on_top(false);
        let _ = win.set_min_size(Some(LogicalSize::new(620.0, 520.0)));

        let saved = state
            .saved_bounds
            .lock()
            .ok()
            .and_then(|mut guard| guard.take());
        if let Some(bounds) = saved {
            let _ = win.set_size(bounds.size);
            let _ = win.set_position(bounds.position);
        } else {
            let _ = win.set_size(LogicalSize::new(1280.0, 820.0));
            let _ = win.center();
        }
        state.mini_mode.store(false, Ordering::Relaxed);
    }

    Ok(enabled)
}

#[tauri::command]
fn set_window_theme(app: AppHandle, theme: String) {
    if let Some(win) = app.get_webview_window("main") {
        let native_theme = match theme.as_str() {
            "light" => Some(Theme::Light),
            "dark" => Some(Theme::Dark),
            _ => None,
        };
        let _ = win.set_theme(native_theme);
    }
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn get_close_to_tray(state: State<'_, AppSettingsState>) -> bool {
    state.close_to_tray.load(Ordering::Relaxed)
}

#[tauri::command]
fn set_close_to_tray(state: State<'_, AppSettingsState>, enabled: bool) {
    state.close_to_tray.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
fn get_autostart_enabled(app: AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .is_enabled()
        .map_err(|e| format!("No se pudo consultar el inicio automático: {e}"))
}

#[tauri::command]
fn set_autostart_enabled(app: AppHandle, enabled: bool) -> Result<bool, String> {
    if enabled {
        app.autolaunch()
            .enable()
            .map_err(|e| format!("No se pudo activar el inicio automático: {e}"))?;
    } else {
        app.autolaunch()
            .disable()
            .map_err(|e| format!("No se pudo desactivar el inicio automático: {e}"))?;
    }
    Ok(enabled)
}

#[cfg(all(target_os = "macos", debug_assertions))]
fn apply_macos_dev_dock_icon() {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    // Unbundled `tauri dev` Mach-O binaries show a generic `exec` icon in the macOS Dock
    // because there is no `.app` Info.plist. Apply the real SpotiDesk icon at startup.
    const ICON_BYTES: &[u8] = include_bytes!("../icons/128x128@2x.png");
    unsafe {
        let ns_data: *mut AnyObject = msg_send![
            class!(NSData),
            dataWithBytes: ICON_BYTES.as_ptr() as *const std::ffi::c_void,
            length: ICON_BYTES.len()
        ];
        if ns_data.is_null() {
            return;
        }
        let alloc: *mut AnyObject = msg_send![class!(NSImage), alloc];
        let ns_image: *mut AnyObject = msg_send![alloc, initWithData: ns_data];
        if ns_image.is_null() {
            return;
        }
        let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        if !ns_app.is_null() {
            let _: () = msg_send![ns_app, setApplicationIconImage: ns_image];
        }
        let _: () = msg_send![ns_image, release];
    }
}

#[cfg(not(all(target_os = "macos", debug_assertions)))]
fn apply_macos_dev_dock_icon() {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(shortcuts::build_plugin())
        .manage(auth::AuthState::new())
        .manage(AppSettingsState::new())
        .manage(notch::NotchState::new())
        .manage(shortcuts::ShortcutStateStore::new())
        .manage(tray::TrayMenuState::new())
        .setup(|app| {
            apply_macos_dev_dock_icon();
            tray::setup_tray(app)?;
            shortcuts::register_media_shortcuts(app);
            if let Some(main_win) = app.get_webview_window("main") {
                apply_main_window_corners(&main_win);
            }
            install_macos_titlebar_drag_monitor(app.handle().clone());
            if let Err(err) = notch::create_notch_window(app.handle()) {
                eprintln!("[SpotiDesk] No se pudo crear la ventana Notch: {err}");
            }
            // Spotlight window is created lazily on first shortcut/tray trigger to keep idle RAM minimal
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                match event {
                    WindowEvent::CloseRequested { api, .. } => {
                        let close_to_tray = window
                            .app_handle()
                            .state::<AppSettingsState>()
                            .close_to_tray
                            .load(Ordering::Relaxed);

                        if close_to_tray {
                            // Minimize to tray instead of exiting so music continues uninterrupted
                            api.prevent_close();
                            let _ = window.hide();
                        } else {
                            if let Some(notch) = window.app_handle().get_webview_window(notch::NOTCH_LABEL) {
                                let _ = notch.destroy();
                            }
                            if let Some(sp) = window.app_handle().get_webview_window(spotlight::SPOTLIGHT_LABEL) {
                                let _ = sp.destroy();
                            }
                            window.app_handle().exit(0);
                        }
                    }
                    WindowEvent::Destroyed => {
                        if let Some(notch) = window.app_handle().get_webview_window(notch::NOTCH_LABEL) {
                            let _ = notch.destroy();
                        }
                        if let Some(sp) = window.app_handle().get_webview_window(spotlight::SPOTLIGHT_LABEL) {
                            let _ = sp.destroy();
                        }
                        window.app_handle().exit(0);
                    }
                    _ => {}
                }
            } else if window.label() == notch::NOTCH_LABEL {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            } else if window.label() == spotlight::SPOTLIGHT_LABEL {
                match event {
                    WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    WindowEvent::Focused(false) => {
                        let _ = window.hide();
                    }
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            auth::start_spotify_auth,
            auth::get_valid_token,
            auth::refresh_spotify_token,
            auth::logout_spotify,
            notch::toggle_notch,
            notch::get_notch_visible,
            notch::get_notch_layout,
            notch::set_notch_position,
            notch::begin_bubble_drag,
            notch::drag_bubble_move,
            notch::end_bubble_drag,
            notch::set_bubble_position,
            notch::send_notch_state,
            notch::send_notch_action,
            spotlight::hide_spotlight,
            spotlight::show_main_window,
            spotlight::request_spotlight_state,
            spotlight::send_spotlight_state,
            spotlight::send_spotlight_action,
            shortcuts::set_spotlight_shortcut,
            tray::update_tray_now_playing,
            translate_lyrics,
            get_close_to_tray,
            set_close_to_tray,
            get_autostart_enabled,
            set_autostart_enabled,
            set_mini_player_mode,
            set_window_theme,
            set_titlebar_drag_zone,
            begin_window_drag,
            drag_window_move,
            end_window_drag,
            check_for_updates,
            quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SpotiDesk");
}
