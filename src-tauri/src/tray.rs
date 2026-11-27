use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager, Wry};

pub struct TrayMenuState {
    now_playing_item: Mutex<Option<MenuItem<Wry>>>,
    like_item: Mutex<Option<MenuItem<Wry>>>,
}

impl TrayMenuState {
    pub fn new() -> Self {
        Self {
            now_playing_item: Mutex::new(None),
            like_item: Mutex::new(None),
        }
    }
}

pub fn toggle_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let is_visible = window.is_visible().unwrap_or(false);
        let is_minimized = window.is_minimized().unwrap_or(false);

        if is_visible && !is_minimized {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }
}

pub fn show_main_window(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.show();

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn setup_tray(app: &App) -> tauri::Result<()> {
    let now_playing_item =
        MenuItem::with_id(app, "now_playing", "Sin reproducción activa", false, None::<&str>)?;
    let sep_status = PredefinedMenuItem::separator(app)?;
    let play_pause_item =
        MenuItem::with_id(app, "play_pause", "Reproducir / Pausar", true, None::<&str>)?;
    let next_item = MenuItem::with_id(app, "next", "Siguiente pista", true, None::<&str>)?;
    let prev_item = MenuItem::with_id(app, "previous", "Pista anterior", true, None::<&str>)?;
    let like_item =
        MenuItem::with_id(app, "toggle_like", "Añadir a Me Gusta", true, None::<&str>)?;
    let sep_mid = PredefinedMenuItem::separator(app)?;
    let spotlight_item =
        MenuItem::with_id(app, "open_spotlight", "Abrir Spotlight flotante", true, None::<&str>)?;
    let toggle_item =
        MenuItem::with_id(app, "toggle", "Mostrar / Ocultar SpotiDesk", true, None::<&str>)?;
    let toggle_notch_item = MenuItem::with_id(
        app,
        "toggle_notch",
        "Mostrar / Ocultar Notch",
        true,
        None::<&str>,
    )?;
    let sep_bottom = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "Salir de SpotiDesk", true, None::<&str>)?;

    if let Some(state) = app.try_state::<TrayMenuState>() {
        if let Ok(mut g) = state.now_playing_item.lock() {
            *g = Some(now_playing_item.clone());
        }
        if let Ok(mut g) = state.like_item.lock() {
            *g = Some(like_item.clone());
        }
    }

    let menu = Menu::with_items(
        app,
        &[
            &now_playing_item,
            &sep_status,
            &play_pause_item,
            &next_item,
            &prev_item,
            &like_item,
            &sep_mid,
            &spotlight_item,
            &toggle_item,
            &toggle_notch_item,
            &sep_bottom,
            &quit_item,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id("spotidesk-tray")
        .menu(&menu)
        .tooltip("SpotiDesk")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "toggle" => toggle_main_window(app),
            "open_spotlight" => crate::spotlight::toggle_spotlight(app),
            "toggle_notch" => {
                let visible = crate::notch::toggle_notch_window(app);
                let _ = app.emit_to("main", "notch-visibility-changed", visible);
            }
            "play_pause" => {
                let _ = app.emit_to("main", "media-control", "play-pause");
            }
            "next" => {
                let _ = app.emit_to("main", "media-control", "next");
            }
            "previous" => {
                let _ = app.emit_to("main", "media-control", "previous");
            }
            "toggle_like" => {
                let _ = app.emit_to("main", "notch-action", "toggle-like");
            }
            "quit" => {
                if let Some(notch) = app.get_webview_window(crate::notch::NOTCH_LABEL) {
                    let _ = notch.destroy();
                }
                if let Some(sp) = app.get_webview_window(crate::spotlight::SPOTLIGHT_LABEL) {
                    let _ = sp.destroy();
                }
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.destroy();
                }
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

fn truncate_chars(s: &str, max_chars: usize) -> String {
    let mut out: String = s.chars().take(max_chars).collect();
    if s.chars().count() > max_chars {
        out.push('…');
    }
    out
}

#[tauri::command]
pub fn update_tray_now_playing(
    app: AppHandle,
    title: Option<String>,
    artist: Option<String>,
    is_playing: bool,
    is_liked: bool,
) {
    let label = match (title.as_deref(), artist.as_deref()) {
        (Some(t), Some(a)) if !t.is_empty() && !a.is_empty() => {
            let icon = if is_playing { "▶" } else { "❚❚" };
            format!("{icon} {}", truncate_chars(&format!("{t} — {a}"), 46))
        }
        (Some(t), _) if !t.is_empty() => {
            let icon = if is_playing { "▶" } else { "❚❚" };
            format!("{icon} {}", truncate_chars(t, 46))
        }
        _ => "Sin reproducción activa".to_string(),
    };

    if let Some(state) = app.try_state::<TrayMenuState>() {
        if let Ok(guard) = state.now_playing_item.lock() {
            if let Some(item) = guard.as_ref() {
                let _ = item.set_text(&label);
            }
        }
        if let Ok(guard) = state.like_item.lock() {
            if let Some(item) = guard.as_ref() {
                let like_text = if is_liked {
                    "Quitar de Tus Me Gusta ♥"
                } else {
                    "Añadir a Me Gusta ♡"
                };
                let _ = item.set_text(like_text);
            }
        }
    }

    if let Some(tray) = app.tray_by_id("spotidesk-tray") {
        let tooltip = if title.is_some() {
            format!("SpotiDesk · {label}")
        } else {
            "SpotiDesk".to_string()
        };
        let _ = tray.set_tooltip(Some(&tooltip));
    }
}
