use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;
use serde_json::{json, Value};
use tokio::time::{interval, Duration};

use crate::config::VERSION;
use crate::fields;
use crate::server::AppState;

pub async fn handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    ws.on_upgrade(move |socket| run(socket, state))
}

async fn run(mut socket: WebSocket, state: AppState) {
    if !send(
        &mut socket,
        "hello",
        json!({ "version": VERSION, "api": 1 }),
    )
    .await
    {
        return;
    }

    let status = state.device.status(Some(state.conflict.current()));
    let mut last_status_key = (
        status.connected,
        status.read_only,
        status.health.degraded,
        status.health.consecutive_failures,
    );
    let _ = send(
        &mut socket,
        "status",
        serde_json::to_value(&status).unwrap_or(Value::Null),
    )
    .await;
    let _ = send(
        &mut socket,
        "fields",
        json!({ "fields": fields::fields() }),
    )
    .await;
    if let Some(settings) = state.device.settings() {
        let _ = send(
            &mut socket,
            "settings",
            json!({ "settings": settings }),
        )
        .await;
    }
    if let Some(live) = state.device.live() {
        let _ = send(
            &mut socket,
            "state",
            serde_json::to_value(&live).unwrap_or(Value::Null),
        )
        .await;
    }

    let state_hz = state
        .config
        .read()
        .expect("config lock")
        .state_hz
        .clamp(1, 60);
    let mut ticker = interval(Duration::from_millis(1000 / state_hz as u64));
    let mut last_settings_version = state.device.settings_version();
    let mut last_safety_at = state.device.last_safety().map(|event| event.timestamp);
    let mut tick_count: u64 = 0;

    loop {
        tokio::select! {
            message = socket.recv() => {
                match message {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(value) = serde_json::from_str::<Value>(&text) {
                            if value.get("type").and_then(|value| value.as_str()) == Some("ping") {
                                let _ = send(&mut socket, "pong", json!({ "at": now_ms() })).await;
                            }
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        let _ = socket.send(Message::Pong(payload)).await;
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => {}
                }
            }
            _ = ticker.tick() => {
                tick_count = tick_count.wrapping_add(1);
                if let Some(live) = state.device.live() {
                    if !send(
                        &mut socket,
                        "state",
                        serde_json::to_value(&live).unwrap_or(Value::Null),
                    )
                    .await
                    {
                        break;
                    }
                }

                let status = state.device.status(Some(state.conflict.current()));
                let key = (
                    status.connected,
                    status.read_only,
                    status.health.degraded,
                    status.health.consecutive_failures,
                );
                if key != last_status_key || tick_count % 20 == 0 {
                    last_status_key = key;
                    if !send(
                        &mut socket,
                        "status",
                        serde_json::to_value(&status).unwrap_or(Value::Null),
                    )
                    .await
                    {
                        break;
                    }
                }

                let settings_version = state.device.settings_version();
                if settings_version != last_settings_version {
                    last_settings_version = settings_version;
                    if let Some(settings) = state.device.settings() {
                        if !send(
                            &mut socket,
                            "settings",
                            json!({ "settings": settings }),
                        )
                        .await
                        {
                            break;
                        }
                    }
                }

                if let Some(event) = state.device.last_safety() {
                    if Some(event.timestamp) != last_safety_at {
                        last_safety_at = Some(event.timestamp);
                        if !send(
                            &mut socket,
                            "safety",
                            serde_json::to_value(&event).unwrap_or(Value::Null),
                        )
                        .await
                        {
                            break;
                        }
                    }
                }
            }
        }
    }
}

async fn send(socket: &mut WebSocket, kind: &str, data: Value) -> bool {
    let Ok(text) = serde_json::to_string(&json!({ "type": kind, "data": data })) else {
        return false;
    };
    socket.send(Message::Text(text.into())).await.is_ok()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
