use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use serde::Deserialize;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

pub struct DiscordState {
    inner: Mutex<Option<(String, DiscordIpcClient)>>,
}

impl DiscordState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscordPresencePayload {
    pub client_id: String,
    pub track_name: String,
    pub artists: String,
    pub album_name: Option<String>,
    pub album_image: Option<String>,
    pub track_url: Option<String>,
    pub is_playing: bool,
    pub position_ms: u64,
    pub duration_ms: u64,
}

fn ensure_connected<'a>(
    guard: &'a mut Option<(String, DiscordIpcClient)>,
    client_id: &str,
) -> Result<&'a mut DiscordIpcClient, String> {
    let needs_new = match guard {
        Some((existing_id, _)) => existing_id != client_id,
        None => true,
    };

    if needs_new {
        if let Some((_, mut old)) = guard.take() {
            let _ = old.close();
        }
        let mut client =
            DiscordIpcClient::new(client_id).map_err(|e| format!("Discord IPC init error: {e}"))?;
        client
            .connect()
            .map_err(|e| format!("Discord no detectado: {e}"))?;
        *guard = Some((client_id.to_string(), client));
    }

    Ok(&mut guard.as_mut().unwrap().1)
}

#[tauri::command]
pub fn update_discord_presence(
    state: State<'_, DiscordState>,
    payload: DiscordPresencePayload,
) -> Result<(), String> {
    let client_id = payload.client_id.trim().to_string();
    if client_id.is_empty() {
        return Ok(());
    }

    let mut guard = state
        .inner
        .lock()
        .map_err(|_| "Discord state lock poisoned".to_string())?;

    let details = payload.track_name;
    let state_line = if payload.is_playing {
        format!("de {}", payload.artists)
    } else {
        format!("En pausa · {}", payload.artists)
    };

    let album_label = payload
        .album_name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "SpotiDesk".to_string());

    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let build_activity = || {
        let mut act = activity::Activity::new()
            .details(&details)
            .state(&state_line);

        if let Some(ref img_url) = payload.album_image {
            let assets = activity::Assets::new()
                .large_image(img_url)
                .large_text(&album_label);
            act = act.assets(assets);
        }

        if payload.is_playing && payload.duration_ms > payload.position_ms {
            let elapsed = (payload.position_ms / 1000) as i64;
            let remaining = ((payload.duration_ms - payload.position_ms) / 1000) as i64;
            let timestamps = activity::Timestamps::new()
                .start(now_secs.saturating_sub(elapsed))
                .end(now_secs.saturating_add(remaining));
            act = act.timestamps(timestamps);
        }

        if let Some(ref url) = payload.track_url {
            act = act.buttons(vec![activity::Button::new("Escuchar en Spotify", url)]);
        }

        act
    };

    // Try setting activity; if Discord restarted and broke the pipe, reconnect once seamlessly
    let client = match ensure_connected(&mut guard, &client_id) {
        Ok(c) => c,
        Err(_) => return Ok(()), // Discord isn't running — fail silently
    };

    if client.set_activity(build_activity()).is_err() {
        *guard = None;
        if let Ok(reconnected) = ensure_connected(&mut guard, &client_id) {
            let _ = reconnected.set_activity(build_activity());
        }
    }

    Ok(())
}

#[tauri::command]
pub fn clear_discord_presence(state: State<'_, DiscordState>) {
    if let Ok(mut guard) = state.inner.lock() {
        if let Some((_, mut client)) = guard.take() {
            let _ = client.clear_activity();
            let _ = client.close();
        }
    }
}
