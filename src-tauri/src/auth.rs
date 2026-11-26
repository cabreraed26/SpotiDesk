use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use url::Url;

pub const REDIRECT_URI: &str = "http://127.0.0.1:8888/callback";
pub const CALLBACK_BIND_ADDR: &str = "127.0.0.1:8888";
pub const SPOTIFY_AUTH_URL: &str = "https://accounts.spotify.com/authorize";
pub const SPOTIFY_TOKEN_URL: &str = "https://accounts.spotify.com/api/token";
pub const SPOTIFY_SCOPES: &str = concat!(
    "streaming ",
    "user-read-email ",
    "user-read-private ",
    "user-read-playback-state ",
    "user-modify-playback-state ",
    "user-library-read ",
    "user-library-modify ",
    "user-follow-read ",
    "playlist-read-private ",
    "playlist-read-collaborative ",
    "playlist-modify-public ",
    "playlist-modify-private"
);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: u64,
    pub scope: Option<String>,
    pub client_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthTokenPayload {
    pub access_token: String,
    pub expires_at: u64,
    pub scope: Option<String>,
}

impl From<&StoredTokens> for AuthTokenPayload {
    fn from(tokens: &StoredTokens) -> Self {
        Self {
            access_token: tokens.access_token.clone(),
            expires_at: tokens.expires_at,
            scope: tokens.scope.clone(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct SpotifyTokenResponse {
    access_token: String,
    expires_in: u64,
    refresh_token: Option<String>,
    scope: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SpotifyErrorResponse {
    error: Option<String>,
    error_description: Option<String>,
}

pub struct AuthState {
    tokens: Mutex<Option<StoredTokens>>,
    http: Client,
}

impl AuthState {
    pub fn new() -> Self {
        let http = Client::builder()
            .timeout(Duration::from_secs(20))
            .user_agent("SpotiDesk/0.2.0")
            .build()
            .expect("failed to initialize HTTP client");

        Self {
            tokens: Mutex::new(None),
            http,
        }
    }
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn generate_random_b64(num_bytes: usize) -> String {
    let mut bytes = vec![0u8; num_bytes];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn generate_pkce_pair() -> (String, String) {
    let verifier = generate_random_b64(64);
    let digest = Sha256::digest(verifier.as_bytes());
    let challenge = URL_SAFE_NO_PAD.encode(digest);
    (verifier, challenge)
}

fn token_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No se pudo obtener el directorio de datos: {e}"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("No se pudo crear el directorio de datos: {e}"))?;
    Ok(dir.join("spotify_auth.json"))
}

fn persist_tokens(app: &AppHandle, tokens: &StoredTokens) -> Result<(), String> {
    let path = token_file_path(app)?;
    let serialized =
        serde_json::to_string_pretty(tokens).map_err(|e| format!("Error serializando tokens: {e}"))?;
    std::fs::write(&path, serialized).map_err(|e| format!("Error guardando tokens: {e}"))?;
    Ok(())
}

fn load_tokens_from_disk(app: &AppHandle) -> Option<StoredTokens> {
    let path = token_file_path(app).ok()?;
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<StoredTokens>(&raw).ok()
}

fn delete_tokens_from_disk(app: &AppHandle) {
    if let Ok(path) = token_file_path(app) {
        let _ = std::fs::remove_file(path);
    }
}

fn build_callback_html(title: &str, subtitle: &str, is_error: bool) -> String {
    let accent = if is_error { "#FF453A" } else { "#F5F5F7" };
    let symbol = if is_error { "!" } else { "&#10003;" };
    let body = format!(
        r#"<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>SpotiDesk</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    min-height: 100vh;
    display: grid;
    place-items: center;
    background: #000000;
    color: #F5F5F7;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
    -webkit-font-smoothing: antialiased;
  }}
  .card {{
    width: min(420px, 90vw);
    padding: 40px 32px;
    border-radius: 20px;
    background: #0A0A0C;
    border: 1px solid rgba(255,255,255,0.08);
    text-align: center;
  }}
  .badge {{
    width: 48px;
    height: 48px;
    margin: 0 auto 20px;
    border-radius: 999px;
    display: grid;
    place-items: center;
    font-size: 20px;
    font-weight: 600;
    color: #000000;
    background: {accent};
  }}
  h1 {{
    font-size: 20px;
    font-weight: 600;
    letter-spacing: -0.02em;
    margin-bottom: 10px;
  }}
  p {{
    font-size: 14px;
    line-height: 1.5;
    color: #86868B;
  }}
</style>
</head>
<body>
  <div class="card">
    <div class="badge">{symbol}</div>
    <h1>{title}</h1>
    <p>{subtitle}</p>
  </div>
  <script>setTimeout(() => window.close(), 1600);</script>
</body>
</html>"#
    );

    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    )
}

async fn wait_for_oauth_code(
    listener: TcpListener,
    expected_state: &str,
) -> Result<String, String> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(180);

    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err("Tiempo de espera agotado al autenticar con Spotify.".to_string());
        }

        let (mut stream, _) = tokio::time::timeout(remaining, listener.accept())
            .await
            .map_err(|_| "Tiempo de espera agotado al autenticar con Spotify.".to_string())?
            .map_err(|e| format!("Error recibiendo conexión OAuth: {e}"))?;

        let mut buffer = [0u8; 8192];
        let bytes_read = match tokio::time::timeout(Duration::from_secs(5), stream.read(&mut buffer)).await {
            Ok(Ok(n)) if n > 0 => n,
            _ => continue,
        };

        let request = String::from_utf8_lossy(&buffer[..bytes_read]);
        let request_line = request.lines().next().unwrap_or_default();
        let raw_path = request_line.split_whitespace().nth(1).unwrap_or("/");

        if !raw_path.starts_with("/callback") {
            let not_found = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
            let _ = stream.write_all(not_found.as_bytes()).await;
            let _ = stream.shutdown().await;
            continue;
        }

        let full_url = format!("http://127.0.0.1:8888{raw_path}");
        let parsed = Url::parse(&full_url)
            .map_err(|e| format!("URL de callback inválida: {e}"))?;

        let mut code: Option<String> = None;
        let mut returned_state: Option<String> = None;
        let mut oauth_error: Option<String> = None;

        for (k, v) in parsed.query_pairs() {
            match k.as_ref() {
                "code" => code = Some(v.into_owned()),
                "state" => returned_state = Some(v.into_owned()),
                "error" => oauth_error = Some(v.into_owned()),
                _ => {}
            }
        }

        if let Some(err) = oauth_error {
            let html = build_callback_html(
                "Autorización cancelada",
                "Spotify rechazó o canceló la conexión. Vuelve a SpotiDesk para reintentar.",
                true,
            );
            let _ = stream.write_all(html.as_bytes()).await;
            let _ = stream.shutdown().await;
            return Err(format!("Autenticación cancelada por Spotify: {err}"));
        }

        if returned_state.as_deref() != Some(expected_state) {
            let html = build_callback_html(
                "Error de verificación",
                "El parámetro de seguridad (state) no coincide. Intenta iniciar sesión de nuevo.",
                true,
            );
            let _ = stream.write_all(html.as_bytes()).await;
            let _ = stream.shutdown().await;
            return Err("Error de seguridad CSRF: el parámetro state no coincide.".to_string());
        }

        let auth_code = match code {
            Some(c) if !c.is_empty() => c,
            _ => {
                let html = build_callback_html(
                    "Código no encontrado",
                    "Spotify no devolvió un código de autorización válido.",
                    true,
                );
                let _ = stream.write_all(html.as_bytes()).await;
                let _ = stream.shutdown().await;
                return Err("No se recibió el código de autorización de Spotify.".to_string());
            }
        };

        let html = build_callback_html(
            "Conectado a SpotiDesk",
            "Autenticación completada de forma segura. Ya puedes cerrar esta pestaña.",
            false,
        );
        let _ = stream.write_all(html.as_bytes()).await;
        let _ = stream.shutdown().await;
        return Ok(auth_code);
    }
}

async fn exchange_code_for_tokens(
    http: &Client,
    client_id: &str,
    code: &str,
    code_verifier: &str,
) -> Result<StoredTokens, String> {
    let response = http
        .post(SPOTIFY_TOKEN_URL)
        .form(&[
            ("client_id", client_id),
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", REDIRECT_URI),
            ("code_verifier", code_verifier),
        ])
        .send()
        .await
        .map_err(|e| format!("No se pudo contactar con accounts.spotify.com: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let detail = response
            .json::<SpotifyErrorResponse>()
            .await
            .ok()
            .and_then(|e| e.error_description.or(e.error))
            .unwrap_or_else(|| format!("HTTP {status}"));
        return Err(format!("Error intercambiando el token PKCE: {detail}"));
    }

    let body = response
        .json::<SpotifyTokenResponse>()
        .await
        .map_err(|e| format!("Respuesta de token inválida: {e}"))?;

    Ok(StoredTokens {
        access_token: body.access_token,
        refresh_token: body.refresh_token,
        expires_at: unix_now() + body.expires_in,
        scope: body.scope,
        client_id: client_id.to_string(),
    })
}

async fn refresh_tokens_request(
    http: &Client,
    current: &StoredTokens,
) -> Result<StoredTokens, String> {
    let refresh_token = current
        .refresh_token
        .as_deref()
        .ok_or_else(|| "No hay refresh_token disponible. Inicia sesión nuevamente.".to_string())?;

    let response = http
        .post(SPOTIFY_TOKEN_URL)
        .form(&[
            ("client_id", current.client_id.as_str()),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
        ])
        .send()
        .await
        .map_err(|e| format!("Error de red al refrescar token: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let detail = response
            .json::<SpotifyErrorResponse>()
            .await
            .ok()
            .and_then(|e| e.error_description.or(e.error))
            .unwrap_or_else(|| format!("HTTP {status}"));
        return Err(format!("No se pudo refrescar la sesión de Spotify: {detail}"));
    }

    let body = response
        .json::<SpotifyTokenResponse>()
        .await
        .map_err(|e| format!("Respuesta de refresh inválida: {e}"))?;

    Ok(StoredTokens {
        access_token: body.access_token,
        refresh_token: body.refresh_token.or_else(|| current.refresh_token.clone()),
        expires_at: unix_now() + body.expires_in,
        scope: body.scope.or_else(|| current.scope.clone()),
        client_id: current.client_id.clone(),
    })
}

#[tauri::command]
pub async fn start_spotify_auth(
    app: AppHandle,
    state: State<'_, AuthState>,
    client_id: String,
) -> Result<AuthTokenPayload, String> {
    let trimmed_id = client_id.trim().to_string();
    if trimmed_id.is_empty() {
        return Err("Falta VITE_SPOTIFY_CLIENT_ID. Configúralo en .env o ingrésalo en la pantalla de inicio.".to_string());
    }

    let (code_verifier, code_challenge) = generate_pkce_pair();
    let oauth_state = generate_random_b64(24);

    let listener = TcpListener::bind(CALLBACK_BIND_ADDR).await.map_err(|e| {
        format!(
            "No se pudo abrir el servidor local en {CALLBACK_BIND_ADDR} (¿puerto ocupado?): {e}"
        )
    })?;

    let mut auth_url = Url::parse(SPOTIFY_AUTH_URL).map_err(|e| e.to_string())?;
    auth_url
        .query_pairs_mut()
        .append_pair("client_id", &trimmed_id)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", REDIRECT_URI)
        .append_pair("scope", SPOTIFY_SCOPES)
        .append_pair("code_challenge_method", "S256")
        .append_pair("code_challenge", &code_challenge)
        .append_pair("state", &oauth_state);

    app.opener()
        .open_url(auth_url.as_str(), None::<&str>)
        .map_err(|e| format!("No se pudo abrir el navegador para iniciar sesión: {e}"))?;

    let code = wait_for_oauth_code(listener, &oauth_state).await?;
    let tokens = exchange_code_for_tokens(&state.http, &trimmed_id, &code, &code_verifier).await?;

    persist_tokens(&app, &tokens)?;

    let payload = AuthTokenPayload::from(&tokens);
    {
        let mut guard = state.tokens.lock().await;
        *guard = Some(tokens);
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }

    Ok(payload)
}

#[tauri::command]
pub async fn get_valid_token(
    app: AppHandle,
    state: State<'_, AuthState>,
) -> Result<Option<AuthTokenPayload>, String> {
    let maybe_current = {
        let mut guard = state.tokens.lock().await;
        if guard.is_none() {
            *guard = load_tokens_from_disk(&app);
        }
        guard.clone()
    };

    let Some(current) = maybe_current else {
        return Ok(None);
    };

    // Refresh proactively 90 seconds before expiration
    if unix_now() + 90 < current.expires_at {
        return Ok(Some(AuthTokenPayload::from(&current)));
    }

    match refresh_tokens_request(&state.http, &current).await {
        Ok(refreshed) => {
            let _ = persist_tokens(&app, &refreshed);
            let payload = AuthTokenPayload::from(&refreshed);
            let mut guard = state.tokens.lock().await;
            *guard = Some(refreshed);
            Ok(Some(payload))
        }
        Err(_) => {
            delete_tokens_from_disk(&app);
            let mut guard = state.tokens.lock().await;
            *guard = None;
            Ok(None)
        }
    }
}

#[tauri::command]
pub async fn refresh_spotify_token(
    app: AppHandle,
    state: State<'_, AuthState>,
) -> Result<AuthTokenPayload, String> {
    let current = {
        let mut guard = state.tokens.lock().await;
        if guard.is_none() {
            *guard = load_tokens_from_disk(&app);
        }
        guard
            .clone()
            .ok_or_else(|| "No hay sesión activa de Spotify.".to_string())?
    };

    let refreshed = refresh_tokens_request(&state.http, &current).await?;
    persist_tokens(&app, &refreshed)?;
    let payload = AuthTokenPayload::from(&refreshed);

    let mut guard = state.tokens.lock().await;
    *guard = Some(refreshed);

    Ok(payload)
}

#[tauri::command]
pub async fn logout_spotify(
    app: AppHandle,
    state: State<'_, AuthState>,
) -> Result<(), String> {
    delete_tokens_from_disk(&app);
    let mut guard = state.tokens.lock().await;
    *guard = None;
    Ok(())
}
