use tauri::{App, Emitter, Runtime};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};

pub fn build_plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }

            let action = match shortcut.key {
                Code::MediaPlayPause => Some("play-pause"),
                Code::MediaTrackNext => Some("next"),
                Code::MediaTrackPrevious => Some("previous"),
                _ => None,
            };

            if let Some(action) = action {
                let _ = app.emit_to("main", "media-control", action);
            }
        })
        .build()
}

pub fn register_media_shortcuts(app: &App) {
    let media_keys = [
        Shortcut::new(None, Code::MediaPlayPause),
        Shortcut::new(None, Code::MediaTrackNext),
        Shortcut::new(None, Code::MediaTrackPrevious),
    ];

    for shortcut in media_keys {
        if let Err(err) = app.global_shortcut().register(shortcut) {
            eprintln!("[SpotiDesk] No se pudo registrar atajo multimedia {:?}: {err}", shortcut.key);
        }
    }
}
