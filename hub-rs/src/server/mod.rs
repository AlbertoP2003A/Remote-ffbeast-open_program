pub mod auth;
pub mod error;
pub mod http;
pub mod ws;

use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Instant;

use crate::config::AppConfig;
use crate::domain::conflict::ConflictMonitor;
use crate::domain::profiles::ProfileStore;
use crate::hid::driver::WheelDevice;
use crate::logger::Logger;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<RwLock<AppConfig>>,
    pub device: WheelDevice,
    pub profiles: Arc<Mutex<ProfileStore>>,
    pub conflict: Arc<ConflictMonitor>,
    pub log: Logger,
    pub started_at: Instant,
    pub web_root: PathBuf,
    pub rate_limiter: Arc<auth::RateLimiter>,
}
