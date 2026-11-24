use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

impl Default for LogLevel {
    fn default() -> Self {
        Self::Info
    }
}

impl LogLevel {
    pub fn rank(self) -> u8 {
        match self {
            Self::Debug => 10,
            Self::Info => 20,
            Self::Warn => 30,
            Self::Error => 40,
        }
    }

    pub fn from_env(value: &str) -> Option<Self> {
        match value.to_ascii_lowercase().as_str() {
            "debug" => Some(Self::Debug),
            "info" => Some(Self::Info),
            "warn" => Some(Self::Warn),
            "error" => Some(Self::Error),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppConfig {
    pub version: u32,
    pub port: u16,
    pub token: String,
    pub read_only: bool,
    pub allow_save_command: bool,
    pub allow_reboot_command: bool,
    pub allow_dfu_command: bool,
    pub state_hz: u32,
    pub log_level: LogLevel,
    pub mock: bool,
    pub autostart: bool,
    pub conflict_processes: Vec<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            version: 1,
            port: 47100,
            token: new_token(),
            read_only: false,
            allow_save_command: true,
            allow_reboot_command: false,
            allow_dfu_command: false,
            state_hz: 20,
            log_level: LogLevel::Info,
            mock: false,
            autostart: false,
            conflict_processes: vec![
                "PitHouse.exe".to_string(),
                "Pit House.exe".to_string(),
                "FFBeast Pit House.exe".to_string(),
                "FFBeastPitHouse.exe".to_string(),
            ],
        }
    }
}

impl AppConfig {
    fn apply_env(&mut self) {
        if let Some(value) = env::var("FFBEAST_PORT").ok().and_then(|v| v.parse().ok()) {
            if (1..=65535).contains(&value) {
                self.port = value;
            }
        }
        if let Ok(value) = env::var("FFBEAST_TOKEN") {
            if !value.is_empty() {
                self.token = value;
            }
        }
        if let Ok(value) = env::var("FFBEAST_READ_ONLY") {
            if let Some(flag) = parse_bool(&value) {
                self.read_only = flag;
            }
        }
        if let Ok(value) = env::var("FFBEAST_MOCK") {
            if let Some(flag) = parse_bool(&value) {
                self.mock = flag;
            }
        }
        if let Some(value) = env::var("FFBEAST_STATE_HZ")
            .ok()
            .and_then(|v| v.parse::<u32>().ok())
        {
            if (1..=60).contains(&value) {
                self.state_hz = value;
            }
        }
        if let Some(value) = env::var("FFBEAST_LOG_LEVEL")
            .ok()
            .and_then(|v| LogLevel::from_env(&v))
        {
            self.log_level = value;
        }
    }
}

fn parse_bool(value: &str) -> Option<bool> {
    match value.to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

pub fn new_token() -> String {
    let mut bytes = [0u8; 24];
    rand::rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

pub fn app_data_dir() -> PathBuf {
    if let Some(value) = env::var_os("FFBEAST_DATA_DIR") {
        return PathBuf::from(value);
    }
    if cfg!(windows) {
        if let Some(appdata) = env::var_os("APPDATA") {
            return PathBuf::from(appdata).join("ffbeast-remote");
        }
    }
    if let Some(home) = env::var_os("HOME") {
        return PathBuf::from(home).join(".config").join("ffbeast-remote");
    }
    PathBuf::from(".ffbeast-remote")
}

pub fn config_path() -> PathBuf {
    app_data_dir().join("config.json")
}

pub fn save_config(config: &AppConfig) -> anyhow::Result<()> {
    let dir = app_data_dir();
    fs::create_dir_all(&dir)?;
    let target = dir.join("config.json");
    let tmp = dir.join("config.json.tmp");
    let text = format!("{}\n", serde_json::to_string_pretty(config)?);
    fs::write(&tmp, text)?;
    fs::rename(&tmp, &target)?;
    Ok(())
}

pub fn load_config() -> anyhow::Result<AppConfig> {
    let dir = app_data_dir();
    fs::create_dir_all(&dir)?;
    let target = dir.join("config.json");

    let mut config = if target.exists() {
        match fs::read_to_string(&target)
            .ok()
            .and_then(|text| serde_json::from_str::<AppConfig>(&text).ok())
        {
            Some(config) => config,
            None => AppConfig::default(),
        }
    } else {
        AppConfig::default()
    };

    if config.token.len() < 16 {
        config.token = new_token();
    }
    config.version = 1;

    // Se guarda la configuracion base (sin overrides de entorno).
    save_config(&config)?;

    let mut effective = config;
    effective.apply_env();
    Ok(effective)
}

pub fn ensure_parent(path: &Path) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    Ok(())
}
