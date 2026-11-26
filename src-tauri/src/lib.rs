mod auth;
mod discord;
mod notch;
mod shortcuts;
mod tray;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager, State, WebviewWindow, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

#[cfg(target_os = "macos")]
fn apply_main_window_corners(window: &WebviewWindow) {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSColor, NSWindow};
    use objc2_quartz_core::kCACornerCurveContinuous;

    let is_maximized = window.is_maximized().unwrap_or(false);
    let is_fullscreen = window.is_fullscreen().unwrap_or(false);
    let radius: f64 = if is_maximized || is_fullscreen { 0.0 } else { 16.0 };

    let apply = move |win: &WebviewWindow| {
        if let Ok(ptr) = win.ns_window() {
            let ns_win: &NSWindow = unsafe { &*(ptr as *const NSWindow) };
            ns_win.setOpaque(false);
            ns_win.setBackgroundColor(Some(&NSColor::clearColor()));
            if let Some(content_view) = ns_win.contentView() {
                content_view.setWantsLayer(true);
                if let Some(layer) = content_view.layer() {
                    layer.setCornerRadius(radius);
                    layer.setMasksToBounds(true);
                    layer.setBackgroundColor(None);
                    unsafe {
                        layer.setCornerCurve(kCACornerCurveContinuous);
                    }
                }
            }
            ns_win.invalidateShadow();
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

    if let Ok(hwnd) = window.hwnd() {
        let preference = DWMWCP_ROUND;
        unsafe {
            let _ = DwmSetWindowAttribute(
                hwnd.0 as isize,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                &preference as *const u32 as *const std::ffi::c_void,
                std::mem::size_of::<u32>() as u32,
            );
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn apply_main_window_corners(_window: &WebviewWindow) {}

pub struct AppSettingsState {
    close_to_tray: AtomicBool,
}

impl AppSettingsState {
    pub fn new() -> Self {
        Self {
            close_to_tray: AtomicBool::new(true),
        }
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
        .manage(discord::DiscordState::new())
        .manage(notch::NotchState::new())
        .setup(|app| {
            tray::setup_tray(app)?;
            shortcuts::register_media_shortcuts(app);
            if let Some(main_win) = app.get_webview_window("main") {
                apply_main_window_corners(&main_win);
            }
            if let Err(err) = notch::create_notch_window(app.handle()) {
                eprintln!("[SpotiDesk] No se pudo crear la ventana Notch: {err}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                match event {
                    WindowEvent::Resized(_) => {
                        #[cfg(target_os = "macos")]
                        if let Some(main_win) = window.app_handle().get_webview_window("main") {
                            apply_main_window_corners(&main_win);
                        }
                    }
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
                            window.app_handle().exit(0);
                        }
                    }
                    WindowEvent::Destroyed => {
                        if let Some(notch) = window.app_handle().get_webview_window(notch::NOTCH_LABEL) {
                            let _ = notch.destroy();
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
            notch::send_notch_state,
            notch::send_notch_action,
            get_close_to_tray,
            set_close_to_tray,
            get_autostart_enabled,
            set_autostart_enabled,
            discord::update_discord_presence,
            discord::clear_discord_presence,
            quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SpotiDesk");
}
