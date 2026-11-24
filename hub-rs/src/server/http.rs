use std::collections::HashMap;
use std::io::{Cursor, Write};
use std::net::SocketAddr;

use axum::body::Body;
use axum::extract::{ConnectInfo, DefaultBodyLimit, Path, Query, State};
use axum::http::{header, HeaderName, HeaderValue, StatusCode, Uri};
use axum::middleware;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Extension, Json, Router};
use hidapi::HidApi;
use serde::Deserialize;
use serde_json::{json, Value};
use tower_http::set_header::SetResponseHeaderLayer;
use zip::write::SimpleFileOptions;

use crate::assets::WebAssets;

use crate::config::{config_path, new_token, save_config, VERSION};
use crate::fields;
use crate::hid::codec::CommandName;
use crate::hid::types::SettingsGroup;
use crate::server::auth::{require_auth, AuthContext};
use crate::startup;
use crate::server::error::ApiError;
use crate::server::ws;
use crate::server::AppState;

const CSP: &str = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws: wss:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

pub fn router(state: AppState) -> Router {
    let public = Router::new().route("/health", get(health));

    let private = Router::new()
        .route("/status", get(status))
        .route("/state", get(state_handler))
        .route("/session", get(session))
        .route("/fields", get(fields_handler))
        .route("/settings", get(get_settings).post(set_setting))
        .route("/settings/apply", post(apply_settings))
        .route("/command", post(run_command))
        .route("/safety/disable-forces", post(disable_forces))
        .route("/profiles", get(list_profiles).post(create_profile))
        .route("/profiles/apply", post(apply_profile))
        .route("/profiles/export", get(export_profiles))
        .route("/profiles/import", post(import_profiles))
        .route("/profiles/{id}", delete(delete_profile))
        .route("/config", get(get_config).post(set_config))
        .route("/token", get(get_token))
        .route("/token/regenerate", post(regenerate_token))
        .route("/qr", get(get_qr))
        .route("/qr/url", get(get_qr_url))
        .route("/logs", get(get_logs))
        .route("/diagnostics", get(get_diagnostics))
        .route("/diagnostics/download", get(get_diagnostics_download))
        .route("/ws", get(ws::handler))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            require_auth,
        ))
        .layer(DefaultBodyLimit::max(64 * 1024));

    let api = public.merge(private);

    Router::new()
        .nest("/api", api.clone())
        .nest("/api/v1", api)
        .fallback(get(static_handler))
        .layer(
            tower::ServiceBuilder::new()
                .layer(SetResponseHeaderLayer::overriding(
                    HeaderName::from_static("content-security-policy"),
                    HeaderValue::from_static(CSP),
                ))
                .layer(SetResponseHeaderLayer::overriding(
                    HeaderName::from_static("referrer-policy"),
                    HeaderValue::from_static("no-referrer"),
                ))
                .layer(SetResponseHeaderLayer::overriding(
                    HeaderName::from_static("x-frame-options"),
                    HeaderValue::from_static("DENY"),
                ))
                .layer(SetResponseHeaderLayer::overriding(
                    HeaderName::from_static("x-content-type-options"),
                    HeaderValue::from_static("nosniff"),
                ))
                .layer(SetResponseHeaderLayer::overriding(
                    HeaderName::from_static("permissions-policy"),
                    HeaderValue::from_static("geolocation=(), microphone=(), camera=()"),
                )),
        )
        .with_state(state)
}

async fn static_handler(State(state): State<AppState>, uri: Uri) -> Response {
    let requested = uri.path().trim_start_matches('/');
    let path = requested
        .split('/')
        .filter(|part| !part.is_empty() && *part != "." && *part != "..")
        .collect::<Vec<_>>()
        .join("/");
    let path = if path.is_empty() {
        "index.html".to_string()
    } else {
        path
    };

    let mut data: Option<Vec<u8>> = None;
    if let Ok(bytes) = tokio::fs::read(state.web_root.join(&path)).await {
        data = Some(bytes);
    }
    if data.is_none() {
        if let Some(file) = WebAssets::get(&path) {
            data = Some(file.data.into_owned());
        }
    }

    if data.is_none() && !path.contains('.') {
        if let Ok(bytes) = tokio::fs::read(state.web_root.join("index.html")).await {
            data = Some(bytes);
        }
        if data.is_none() {
            if let Some(file) = WebAssets::get("index.html") {
                data = Some(file.data.into_owned());
            }
        }
        return match data {
            Some(bytes) => asset_response("index.html", bytes),
            None => (
                StatusCode::OK,
                "La UI no está compilada. Ejecuta `npm run build`.",
            )
                .into_response(),
        };
    }

    match data {
        Some(bytes) => asset_response(&path, bytes),
        None => (StatusCode::NOT_FOUND, "No encontrado").into_response(),
    }
}

fn asset_response(path: &str, data: Vec<u8>) -> Response {
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let cache = if path.starts_with("assets/") {
        "public, max-age=31536000, immutable"
    } else if path == "index.html" {
        "no-store"
    } else {
        "no-cache"
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime.as_ref())
        .header(header::CACHE_CONTROL, cache)
        .body(Body::from(data))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

async fn health(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Response {
    let mut result = Json(json!({
        "ok": true,
        "version": VERSION,
        "api": 1,
    }))
    .into_response();

    if addr.ip().is_loopback() {
        let token = state.config.read().expect("config lock").token.clone();
        let cookie = format!(
            "ffbeast_token={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000"
        );
        if let Ok(value) = HeaderValue::from_str(&cookie) {
            result.headers_mut().insert(header::SET_COOKIE, value);
        }
    }
    result
}

async fn status(State(state): State<AppState>) -> Json<Value> {
    Json(json!({
        "status": state.device.status(Some(state.conflict.current())),
    }))
}

async fn state_handler(State(state): State<AppState>) -> Json<Value> {
    Json(json!({
        "state": state.device.live(),
    }))
}

async fn session(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
) -> Json<Value> {
    let config = state.config.read().expect("config lock");
    Json(json!({
        "authenticated": true,
        "loopback": auth.loopback,
        "readOnly": config.read_only,
    }))
}

async fn fields_handler() -> Json<Value> {
    Json(json!({
        "fields": fields::fields(),
    }))
}

async fn get_settings(State(state): State<AppState>) -> Json<Value> {
    if state.device.snapshot().connected {
        let _ = state.device.refresh().await;
    }
    let snapshot = state.device.snapshot();
    Json(json!({
        "settings": snapshot.settings,
        "fields": fields::fields(),
        "connected": snapshot.connected,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetSettingBody {
    field: Value,
    value: Value,
    #[serde(default)]
    index: usize,
}

async fn set_setting(
    State(state): State<AppState>,
    Json(body): Json<SetSettingBody>,
) -> Result<Response, ApiError> {
    let config = state.config.read().expect("config lock").clone();
    if config.read_only {
        return Err(ApiError::read_only());
    }
    let reference = match body.field {
        Value::String(value) => value,
        Value::Number(value) => value.to_string(),
        _ => return Err(ApiError::invalid("Falta el campo 'field'")),
    };
    let value = body
        .value
        .as_i64()
        .ok_or_else(|| ApiError::invalid("Valor inválido"))? as i32;
    let def = fields::resolve_field(&reference)
        .ok_or_else(|| ApiError::invalid(format!("Campo desconocido: {reference}")))?;
    fields::validate_field(def, value, body.index).map_err(ApiError::invalid)?;
    if let Some(message) = fields::check_compatibility(
        &def.name,
        value,
        state.device.snapshot().license.as_ref(),
    ) {
        return Err(ApiError::invalid(message));
    }

    let settings = state
        .device
        .write_setting(&def.name, value, body.index)
        .await
        .map_err(|message| ApiError::new(StatusCode::CONFLICT, "write_failed", message))?;
    Ok(Json(json!({ "ok": true, "settings": settings })).into_response())
}

fn merge_settings(current: &crate::hid::types::DeviceSettings, patch: &Value) -> Result<crate::hid::types::DeviceSettings, ApiError> {
    let mut base = serde_json::to_value(current)
        .map_err(|_| ApiError::invalid("Formato de ajustes inválido"))?;
    if let Some(patch_obj) = patch.as_object() {
        for group in ["effects", "hardware", "gpio", "adc"] {
            if let Some(patch_group) = patch_obj.get(group).and_then(|value| value.as_object()) {
                if let Some(base_group) = base.get_mut(group).and_then(|value| value.as_object_mut()) {
                    for (key, value) in patch_group {
                        base_group.insert(key.clone(), value.clone());
                    }
                }
            }
        }
    }
    serde_json::from_value(base).map_err(|_| ApiError::invalid("Formato de ajustes inválido"))
}

async fn apply_patch(state: &AppState, patch: Value) -> Result<Json<Value>, ApiError> {
    if state.config.read().expect("config lock").read_only {
        return Err(ApiError::read_only());
    }
    let current = state.device.settings().ok_or_else(|| {
        ApiError::new(
            StatusCode::CONFLICT,
            "wheel_disconnected",
            "Volante desconectado",
        )
    })?;
    let merged = merge_settings(&current, &patch)?;
    let license = state.device.snapshot().license;
    let mut last = current.clone();
    let mut changed = 0usize;
    let mut restart_required = false;

    for field in fields::fields() {
        if field.group == SettingsGroup::Misc {
            continue;
        }
        let count = field.array_length.unwrap_or(1);
        for index in 0..count {
            let from = fields::value_from_settings(&current, &field.name, index);
            let to = fields::value_from_settings(&merged, &field.name, index);
            if from == to {
                continue;
            }
            let Some(to) = to else {
                continue;
            };
            fields::validate_field(field, to, index).map_err(ApiError::invalid)?;
            if let Some(message) =
                fields::check_compatibility(&field.name, to, license.as_ref())
            {
                return Err(ApiError::invalid(message));
            }
            last = state
                .device
                .write_setting(&field.name, to, index)
                .await
                .map_err(|message| {
                    ApiError::new(StatusCode::CONFLICT, "apply_failed", message)
                })?;
            changed += 1;
            if field.requires_reboot.unwrap_or(false) {
                restart_required = true;
            }
        }
    }

    Ok(Json(json!({
        "ok": true,
        "settings": last,
        "restartRequired": restart_required,
        "changed": changed,
    })))
}

async fn apply_settings(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let patch = body.get("settings").cloned().unwrap_or(body);
    apply_patch(&state, patch).await
}

#[derive(Debug, Deserialize)]
struct CommandBody {
    name: String,
}

async fn run_command(
    State(state): State<AppState>,
    Json(body): Json<CommandBody>,
) -> Result<Response, ApiError> {
    let name = match body.name.as_str() {
        "reset-center" => CommandName::ResetCenter,
        "save" => CommandName::Save,
        "reboot" => CommandName::Reboot,
        "dfu" => CommandName::Dfu,
        _ => return Err(ApiError::invalid(format!("Comando desconocido: {}", body.name))),
    };
    state
        .device
        .command(name)
        .await
        .map_err(|message| ApiError::new(StatusCode::CONFLICT, "command_failed", message))?;
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({ "ok": true, "name": body.name })),
    )
        .into_response())
}

async fn disable_forces(State(state): State<AppState>) -> Result<Response, ApiError> {
    let config = state.config.read().expect("config lock").clone();
    if config.read_only {
        return Err(ApiError::read_only());
    }
    if !config.allow_save_command {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "command_disabled",
            "El comando guardar está desactivado: no se puede persistir el cambio",
        ));
    }
    if !state.device.snapshot().connected {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "wheel_disconnected",
            "Volante desconectado",
        ));
    }
    let settings = state.device.disable_forces().await.map_err(|message| {
        ApiError::new(StatusCode::CONFLICT, "safety_failed", message)
    })?;
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({ "ok": true, "restarting": true, "settings": settings })),
    )
        .into_response())
}

async fn list_profiles(State(state): State<AppState>) -> Json<Value> {
    let profiles = state
        .profiles
        .lock()
        .expect("profiles lock")
        .list();
    Json(json!({ "profiles": profiles }))
}

#[derive(Debug, Deserialize)]
struct CreateProfileBody {
    name: String,
    #[serde(default)]
    settings: Option<Value>,
}

async fn create_profile(
    State(state): State<AppState>,
    Json(body): Json<CreateProfileBody>,
) -> Result<Response, ApiError> {
    let settings = match body.settings {
        Some(value) => serde_json::from_value(value)
            .map_err(|_| ApiError::invalid("Formato de ajustes inválido"))?,
        None => state
            .device
            .settings()
            .ok_or_else(|| ApiError::new(StatusCode::CONFLICT, "wheel_disconnected", "Volante desconectado"))?,
    };
    let profile = state
        .profiles
        .lock()
        .expect("profiles lock")
        .create(&body.name, &settings)
        .map_err(|error| ApiError::invalid(error.to_string()))?;
    Ok((StatusCode::CREATED, Json(json!({ "ok": true, "profile": profile }))).into_response())
}

#[derive(Debug, Deserialize)]
struct ProfileIdBody {
    id: String,
}

async fn apply_profile(
    State(state): State<AppState>,
    Json(body): Json<ProfileIdBody>,
) -> Result<Json<Value>, ApiError> {
    let profile = state
        .profiles
        .lock()
        .expect("profiles lock")
        .get(&body.id)
        .ok_or_else(|| ApiError::not_found("Perfil no encontrado"))?;
    let patch = serde_json::to_value(profile.device_settings)
        .map_err(|_| ApiError::invalid("Perfil inválido"))?;
    apply_patch(&state, patch).await
}

async fn export_profiles(State(state): State<AppState>) -> Json<Value> {
    let file = state
        .profiles
        .lock()
        .expect("profiles lock")
        .export_all();
    Json(serde_json::to_value(file).expect("profile json"))
}

async fn import_profiles(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let imported = state
        .profiles
        .lock()
        .expect("profiles lock")
        .import_all(body)
        .map_err(|error| ApiError::invalid(error.to_string()))?;
    Ok(Json(json!({ "ok": true, "imported": imported })))
}

async fn delete_profile(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let deleted = state
        .profiles
        .lock()
        .expect("profiles lock")
        .delete(&id);
    if !deleted {
        return Err(ApiError::not_found("Perfil no encontrado"));
    }
    Ok(Json(json!({ "ok": true })))
}

async fn get_config(State(state): State<AppState>) -> Json<Value> {
    let config = state.config.read().expect("config lock").clone();
    Json(json!({
        "config": {
            "port": config.port,
            "readOnly": config.read_only,
            "allowSaveCommand": config.allow_save_command,
            "allowRebootCommand": config.allow_reboot_command,
            "allowDfuCommand": config.allow_dfu_command,
            "stateHz": config.state_hz,
            "mock": config.mock,
            "autostart": config.autostart,
        }
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetConfigBody {
    read_only: Option<bool>,
    allow_save_command: Option<bool>,
    autostart: Option<bool>,
}

async fn set_config(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Json(body): Json<SetConfigBody>,
) -> Result<Json<Value>, ApiError> {
    let mut config = state.config.write().expect("config lock");
    if let Some(next) = body.read_only {
        if config.read_only && !next && !auth.loopback {
            return Err(ApiError::loopback_only());
        }
        config.read_only = next;
    }
    if let Some(next) = body.allow_save_command {
        if !auth.loopback {
            return Err(ApiError::loopback_only());
        }
        config.allow_save_command = next;
    }
    if let Some(next) = body.autostart {
        if !auth.loopback {
            return Err(ApiError::loopback_only());
        }
        startup::set_enabled(next).map_err(|error| ApiError::internal(error))?;
        config.autostart = next;
    }
    save_config(&config).map_err(|error| ApiError::internal(error.to_string()))?;
    state.device.set_read_only(config.read_only);
    Ok(Json(json!({
        "ok": true,
        "config": {
            "port": config.port,
            "readOnly": config.read_only,
            "allowSaveCommand": config.allow_save_command,
            "allowRebootCommand": config.allow_reboot_command,
            "allowDfuCommand": config.allow_dfu_command,
            "stateHz": config.state_hz,
            "mock": config.mock,
            "autostart": config.autostart,
        }
    })))
}

async fn get_token(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
) -> Result<Json<Value>, ApiError> {
    if !auth.loopback {
        return Err(ApiError::loopback_only());
    }
    let token = state.config.read().expect("config lock").token.clone();
    Ok(Json(json!({ "token": token })))
}

async fn regenerate_token(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
) -> Result<Response, ApiError> {
    if !auth.loopback {
        return Err(ApiError::loopback_only());
    }
    let token = new_token();
    {
        let mut config = state.config.write().expect("config lock");
        config.token = token.clone();
        save_config(&config).map_err(|error| ApiError::internal(error.to_string()))?;
    }
    let cookie = format!(
        "ffbeast_token={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000"
    );
    let mut response = Json(json!({ "token": token })).into_response();
    if let Ok(value) = HeaderValue::from_str(&cookie) {
        response.headers_mut().insert(header::SET_COOKIE, value);
    }
    Ok(response)
}

async fn get_qr(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
) -> Result<Response, ApiError> {
    if !auth.loopback {
        return Err(ApiError::loopback_only());
    }
    let url = mobile_url(&state);
    let code = qrcode::QrCode::new(url.as_bytes())
        .map_err(|error| ApiError::internal(error.to_string()))?;
    let image = code
        .render::<image::Luma<u8>>()
        .min_dimensions(360, 360)
        .quiet_zone(true)
        .build();
    let mut png = Vec::new();
    image::DynamicImage::ImageLuma8(image)
        .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|error| ApiError::internal(error.to_string()))?;
    let mut response = png.into_response();
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static("image/png"));
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store"),
    );
    Ok(response)
}

async fn get_qr_url(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
) -> Result<Json<Value>, ApiError> {
    if !auth.loopback {
        return Err(ApiError::loopback_only());
    }
    let addresses = lan_addresses();
    let host = addresses
        .first()
        .map(|entry| entry.address.clone())
        .unwrap_or_else(|| "localhost".to_string());
    let url = mobile_url_with_host(&state, &host);
    Ok(Json(json!({
        "url": url,
        "host": host,
        "addresses": addresses,
    })))
}

async fn get_logs(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, ApiError> {
    if !auth.loopback {
        return Err(ApiError::loopback_only());
    }
    let lines = query
        .get("lines")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(200)
        .clamp(1, 1000);
    Ok(Json(json!({ "lines": state.log.recent_lines(lines) })))
}

fn diagnostics_payload(state: &AppState) -> Value {
    let config = state.config.read().expect("config lock").clone();
    let status = state.device.status(Some(state.conflict.current()));
    let snapshot = state.device.snapshot();
    json!({
        "version": VERSION,
        "api": 1,
        "uptimeSeconds": state.started_at.elapsed().as_secs(),
        "port": config.port,
        "readOnly": config.read_only,
        "mock": config.mock,
        "connected": snapshot.connected,
        "firmware": status.firmware.clone(),
        "license": status.license.clone(),
        "health": snapshot.health.clone(),
        "conflict": state.conflict.current(),
        "joystickConnected": snapshot.axes.is_some(),
        "lan": lan_addresses(),
        "dataDir": crate::config::app_data_dir().display().to_string(),
        "configPath": config_path().display().to_string(),
        "hid": hid_list(),
    })
}

async fn get_diagnostics(State(state): State<AppState>) -> Json<Value> {
    Json(diagnostics_payload(&state))
}

async fn get_diagnostics_download(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
) -> Result<Response, ApiError> {
    if !auth.loopback {
        return Err(ApiError::loopback_only());
    }
    let diagnostics = diagnostics_payload(&state);
    let config = state.config.read().expect("config lock").clone();
    let mut redacted = serde_json::to_value(&config)
        .map_err(|error| ApiError::internal(error.to_string()))?;
    if let Some(object) = redacted.as_object_mut() {
        object.insert("token".to_string(), json!("[redacted]"));
    }
    let log_text = redact_tokens(&state.log.recent_lines(1000).join("\n"));

    let mut buffer = Cursor::new(Vec::new());
    {
        let mut writer = zip::ZipWriter::new(&mut buffer);
        let options = SimpleFileOptions::default();
        writer
            .start_file("diagnostics.json", options)
            .map_err(|error| ApiError::internal(error.to_string()))?;
        writer
            .write_all(
                serde_json::to_string_pretty(&diagnostics)
                    .map_err(|error| ApiError::internal(error.to_string()))?
                    .as_bytes(),
            )
            .map_err(|error| ApiError::internal(error.to_string()))?;
        writer
            .start_file("config.redacted.json", options)
            .map_err(|error| ApiError::internal(error.to_string()))?;
        writer
            .write_all(
                serde_json::to_string_pretty(&redacted)
                    .map_err(|error| ApiError::internal(error.to_string()))?
                    .as_bytes(),
            )
            .map_err(|error| ApiError::internal(error.to_string()))?;
        writer
            .start_file("hub.log", options)
            .map_err(|error| ApiError::internal(error.to_string()))?;
        writer
            .write_all(log_text.as_bytes())
            .map_err(|error| ApiError::internal(error.to_string()))?;
        writer
            .start_file("LEEME.txt", options)
            .map_err(|error| ApiError::internal(error.to_string()))?;
        writer
            .write_all(
                "Diagnóstico de FFBeast Remote (Rust).\n\
                 Incluye diagnostics.json, config.redacted.json y hub.log.\n\
                 El token de emparejamiento está redactado.\n"
                    .as_bytes(),
            )
            .map_err(|error| ApiError::internal(error.to_string()))?;
        writer
            .finish()
            .map_err(|error| ApiError::internal(error.to_string()))?;
    }

    let bytes = buffer.into_inner();
    let mut response = bytes.into_response();
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static("application/zip"));
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("attachment; filename=\"ffbeast-diagnostics.zip\""),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store"),
    );
    Ok(response)
}

fn hid_list() -> Vec<Value> {
    let Ok(api) = HidApi::new() else {
        return Vec::new();
    };
    api.device_list()
        .map(|info| {
            json!({
                "path": info.path().to_string_lossy(),
                "product": info.product_string(),
                "vendorId": info.vendor_id(),
                "productId": info.product_id(),
                "interface": info.interface_number(),
            })
        })
        .collect()
}

fn redact_tokens(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(index) = rest.find("t=") {
        out.push_str(&rest[..index + 2]);
        out.push_str("[redacted]");
        let after = &rest[index + 2..];
        let end = after
            .find(|character: char| character.is_whitespace() || character == '&')
            .unwrap_or(after.len());
        rest = &after[end..];
    }
    out.push_str(rest);
    out
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LanAddress {
    address: String,
    iface: String,
    score: i32,
}

fn lan_addresses() -> Vec<LanAddress> {
    match local_ip_address::local_ip() {
        Ok(ip) => vec![LanAddress {
            address: ip.to_string(),
            iface: "local".to_string(),
            score: 0,
        }],
        Err(_) => Vec::new(),
    }
}

fn mobile_url(state: &AppState) -> String {
    let addresses = lan_addresses();
    let host = addresses
        .first()
        .map(|entry| entry.address.clone())
        .unwrap_or_else(|| "localhost".to_string());
    mobile_url_with_host(state, &host)
}

fn mobile_url_with_host(state: &AppState, host: &str) -> String {
    let token = state.config.read().expect("config lock").token.clone();
    let port = state.config.read().expect("config lock").port;
    format!("http://{host}:{port}/m?t={token}")
}
