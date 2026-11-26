use tauri::{App, Emitter, Runtime};
use tauri_plugin_global_shortcut::{Code, ShortcutState};

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

#[cfg(not(target_os = "macos"))]
pub fn register_media_shortcuts(app: &App) {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

    let media_keys = [
        Shortcut::new(None, Code::MediaPlayPause),
        Shortcut::new(None, Code::MediaTrackNext),
        Shortcut::new(None, Code::MediaTrackPrevious),
    ];

    for shortcut in media_keys {
        if let Err(err) = app.global_shortcut().register(shortcut) {
            eprintln!(
                "[SpotiDesk] No se pudo registrar atajo multimedia {:?}: {err}",
                shortcut.key
            );
        }
    }
}

#[cfg(target_os = "macos")]
mod macos_media {
    use block2::RcBlock;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_foundation::{NSNumber, NSString};
    use tauri::{AppHandle, Emitter};

    #[link(name = "MediaPlayer", kind = "framework")]
    unsafe extern "C" {
        static MPMediaItemPropertyTitle: &'static NSString;
        static MPMediaItemPropertyArtist: &'static NSString;
        static MPMediaItemPropertyAlbumTitle: &'static NSString;
        static MPMediaItemPropertyPlaybackDuration: &'static NSString;
        static MPNowPlayingInfoPropertyElapsedPlaybackTime: &'static NSString;
        static MPNowPlayingInfoPropertyPlaybackRate: &'static NSString;
    }

    const MP_REMOTE_COMMAND_SUCCESS: isize = 0;
    const MP_PLAYBACK_STATE_PLAYING: usize = 1;
    const MP_PLAYBACK_STATE_PAUSED: usize = 2;
    const MP_PLAYBACK_STATE_STOPPED: usize = 3;

    fn bind_command(center: *mut AnyObject, selector: &str, app: AppHandle, action: &'static str) {
        unsafe {
            let cmd: *mut AnyObject = match selector {
                "togglePlayPauseCommand" => msg_send![center, togglePlayPauseCommand],
                "playCommand" => msg_send![center, playCommand],
                "pauseCommand" => msg_send![center, pauseCommand],
                "nextTrackCommand" => msg_send![center, nextTrackCommand],
                "previousTrackCommand" => msg_send![center, previousTrackCommand],
                _ => return,
            };
            if cmd.is_null() {
                return;
            }
            let _: () = msg_send![cmd, setEnabled: true];
            let block = RcBlock::new(move |_event: *mut AnyObject| -> isize {
                let _ = app.emit_to("main", "media-control", action);
                MP_REMOTE_COMMAND_SUCCESS
            });
            let _token: *mut AnyObject = msg_send![cmd, addTargetWithHandler: &*block];
            // Keep handler block alive for the lifetime of the application
            std::mem::forget(block);
        }
    }

    pub fn register(app: AppHandle) {
        let app_clone = app.clone();
        let _ = app.run_on_main_thread(move || unsafe {
            let center: *mut AnyObject =
                msg_send![class!(MPRemoteCommandCenter), sharedCommandCenter];
            if center.is_null() {
                return;
            }
            bind_command(center, "togglePlayPauseCommand", app_clone.clone(), "play-pause");
            bind_command(center, "playCommand", app_clone.clone(), "play");
            bind_command(center, "pauseCommand", app_clone.clone(), "pause");
            bind_command(center, "nextTrackCommand", app_clone.clone(), "next");
            bind_command(center, "previousTrackCommand", app_clone, "previous");
        });
    }

    pub fn update_now_playing(app: &AppHandle, payload: &serde_json::Value) {
        let track = payload.get("track");
        let title = track
            .and_then(|t| t.get("name"))
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let artist = track
            .and_then(|t| t.get("artists"))
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let album = track
            .and_then(|t| t.get("albumName"))
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let is_playing = payload
            .get("isPlaying")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let position_sec = payload
            .get("positionMs")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0)
            / 1000.0;
        let duration_sec = payload
            .get("durationMs")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0)
            / 1000.0;

        let _ = app.run_on_main_thread(move || unsafe {
            let center: *mut AnyObject =
                msg_send![class!(MPNowPlayingInfoCenter), defaultCenter];
            if center.is_null() {
                return;
            }

            let Some(title_str) = title else {
                let null_ptr: *const AnyObject = std::ptr::null();
                let _: () = msg_send![center, setNowPlayingInfo: null_ptr];
                let _: () = msg_send![center, setPlaybackState: MP_PLAYBACK_STATE_STOPPED];
                return;
            };

            let dict: *mut AnyObject = msg_send![class!(NSMutableDictionary), dictionary];
            if dict.is_null() {
                return;
            }

            let ns_title = NSString::from_str(&title_str);
            let _: () = msg_send![dict, setObject: &*ns_title, forKey: MPMediaItemPropertyTitle];

            if let Some(artist_str) = artist {
                let ns_artist = NSString::from_str(&artist_str);
                let _: () =
                    msg_send![dict, setObject: &*ns_artist, forKey: MPMediaItemPropertyArtist];
            }

            if let Some(album_str) = album.filter(|s| !s.is_empty()) {
                let ns_album = NSString::from_str(&album_str);
                let _: () =
                    msg_send![dict, setObject: &*ns_album, forKey: MPMediaItemPropertyAlbumTitle];
            }

            if duration_sec > 0.0 {
                let ns_dur = NSNumber::new_f64(duration_sec);
                let _: () = msg_send![
                    dict,
                    setObject: &*ns_dur,
                    forKey: MPMediaItemPropertyPlaybackDuration
                ];
            }

            let ns_pos = NSNumber::new_f64(position_sec.max(0.0));
            let _: () = msg_send![
                dict,
                setObject: &*ns_pos,
                forKey: MPNowPlayingInfoPropertyElapsedPlaybackTime
            ];

            let ns_rate = NSNumber::new_f64(if is_playing { 1.0 } else { 0.0 });
            let _: () = msg_send![
                dict,
                setObject: &*ns_rate,
                forKey: MPNowPlayingInfoPropertyPlaybackRate
            ];

            let _: () = msg_send![center, setNowPlayingInfo: dict];
            let state = if is_playing {
                MP_PLAYBACK_STATE_PLAYING
            } else {
                MP_PLAYBACK_STATE_PAUSED
            };
            let _: () = msg_send![center, setPlaybackState: state];
        });
    }
}

#[cfg(target_os = "macos")]
pub fn register_media_shortcuts(app: &App) {
    // On macOS, tauri-plugin-global-shortcut uses CGEventTap for media keys which requires
    // Accessibility permission. MPRemoteCommandCenter works natively without extra permissions
    // and also integrates with MacBook media keys, AirPods, and Control Center Now Playing.
    macos_media::register(app.handle().clone());
}

#[cfg(target_os = "macos")]
pub fn update_macos_now_playing(app: &tauri::AppHandle, payload: &serde_json::Value) {
    macos_media::update_now_playing(app, payload);
}
