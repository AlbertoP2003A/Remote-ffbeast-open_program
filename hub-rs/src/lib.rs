//! Núcleo del hub de FFBeast Remote en Rust.
//!
//! Por ahora contiene el códec HID y los tipos de ajustes; el servidor HTTP/WS
//! y el driver se añaden en las siguientes fases.

pub mod assets;
pub mod config;
pub mod domain;
pub mod fields;
pub mod hid;
pub mod logger;
pub mod platform;
pub mod server;
pub mod startup;
pub mod tray;
