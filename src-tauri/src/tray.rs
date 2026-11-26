use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager};

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
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn setup_tray(app: &App) -> tauri::Result<()> {
    let toggle_item =
        MenuItem::with_id(app, "toggle", "Mostrar / Ocultar SpotiDesk", true, None::<&str>)?;
    let toggle_notch_item = MenuItem::with_id(
        app,
        "toggle_notch",
        "Mostrar / Ocultar Notch superior",
        true,
        None::<&str>,
    )?;
    let sep_top = PredefinedMenuItem::separator(app)?;
    let play_pause_item =
        MenuItem::with_id(app, "play_pause", "Reproducir / Pausar", true, None::<&str>)?;
    let next_item = MenuItem::with_id(app, "next", "Siguiente pista", true, None::<&str>)?;
    let prev_item = MenuItem::with_id(app, "previous", "Pista anterior", true, None::<&str>)?;
    let sep_bottom = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "Salir de SpotiDesk", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &toggle_item,
            &toggle_notch_item,
            &sep_top,
            &play_pause_item,
            &next_item,
            &prev_item,
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
            "quit" => {
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
