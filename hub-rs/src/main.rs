#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Instant;

use anyhow::Context;
use clap::Parser;
use qrcode::QrCode;
use single_instance::SingleInstance;
use tokio::net::TcpListener;

use ffbeast_hub::config::{
    app_data_dir, load_config, save_config, LogLevel, VERSION,
};
use ffbeast_hub::domain::conflict::ConflictMonitor;
use ffbeast_hub::domain::profiles::ProfileStore;
use ffbeast_hub::hid::driver::WheelDevice;
use ffbeast_hub::logger::Logger;
use ffbeast_hub::platform;
use ffbeast_hub::server::auth::RateLimiter;
use ffbeast_hub::server::http::router;
use ffbeast_hub::server::AppState;
use ffbeast_hub::startup;
use ffbeast_hub::tray;

#[derive(Debug, Parser)]
#[command(name = "ffbeast-hub", version, about = "Hub HID de FFBeast Remote")]
struct Args {
    /// Puerto HTTP (por defecto 47100)
    #[arg(long)]
    port: Option<u16>,
    /// Carpeta de datos (por defecto %APPDATA%\ffbeast-remote)
    #[arg(long)]
    data_dir: Option<PathBuf>,
    /// Carpeta de la PWA compilada (web/dist); si no existe se usa la embebida
    #[arg(long)]
    web_root: Option<PathBuf>,
    /// Usa el volante simulado
    #[arg(long)]
    mock: bool,
    /// Arranca en solo lectura
    #[arg(long)]
    read_only: bool,
    /// Frecuencia del estado en vivo (1-60)
    #[arg(long)]
    state_hz: Option<u32>,
    /// debug, info, warn, error
    #[arg(long)]
    log_level: Option<String>,
    /// Abre la UI en el navegador al arrancar
    #[arg(long)]
    open: bool,
    /// Arranque automático (uso interno de Windows Run)
    #[arg(long, hide = true)]
    autostart: bool,
    /// Activa el arranque con Windows y sale
    #[arg(long)]
    install_autostart: bool,
    /// Desactiva el arranque con Windows y sale
    #[arg(long)]
    uninstall_autostart: bool,
    /// No crea la bandeja (modo consola/diagnóstico)
    #[arg(long)]
    no_tray: bool,
    /// No mostrar cuadros de diálogo (instalador/scripts)
    #[arg(long, hide = true)]
    quiet: bool,
}

fn main() {
    let args = match Args::try_parse() {
        Ok(args) => args,
        Err(error) => {
            let code = error.exit_code();
            if cfg!(debug_assertions) {
                let _ = error.print();
            } else {
                platform::message_box("FFBeast Remote", &error.to_string());
            }
            std::process::exit(code);
        }
    };

    if let Err(error) = run(args) {
        let text = format!("{error:#}");
        if cfg!(debug_assertions) {
            eprintln!("{text}");
        } else {
            platform::message_box("FFBeast Remote", &text);
        }
        std::process::exit(1);
    }
}

fn run(args: Args) -> anyhow::Result<()> {
    if let Some(dir) = &args.data_dir {
        std::env::set_var("FFBEAST_DATA_DIR", dir);
    }

    let mut config = load_config().context("no se pudo cargar config.json")?;
    if let Some(port) = args.port {
        config.port = port;
    }
    if args.mock {
        config.mock = true;
    }
    if args.read_only {
        config.read_only = true;
    }
    if let Some(hz) = args.state_hz {
        config.state_hz = hz.clamp(1, 60);
    }
    if let Some(level) = &args.log_level {
        if let Some(level) = LogLevel::from_env(level) {
            config.log_level = level;
        }
    }

    let data_dir = app_data_dir();
    let log = Logger::new_with_console(
        &data_dir,
        config.log_level,
        None,
        cfg!(debug_assertions),
    );

    if args.install_autostart {
        config.autostart = true;
        startup::set_enabled(true).map_err(|error| anyhow::anyhow!(error))?;
        save_config(&config).context("no se pudo guardar config.json")?;
        if cfg!(debug_assertions) || args.quiet {
            log.info("Arranque con Windows activado");
        } else {
            platform::info_box("FFBeast Remote", "Iniciar con Windows activado.");
        }
        return Ok(());
    }
    if args.uninstall_autostart {
        config.autostart = false;
        startup::set_enabled(false).map_err(|error| anyhow::anyhow!(error))?;
        save_config(&config).context("no se pudo guardar config.json")?;
        if cfg!(debug_assertions) || args.quiet {
            log.info("Arranque con Windows desactivado");
        } else {
            platform::info_box("FFBeast Remote", "Iniciar con Windows desactivado.");
        }
        return Ok(());
    }

    let _instance = SingleInstance::new("ffbeast-remote-hub").map_err(|error| {
        anyhow::anyhow!("no se pudo crear la instancia única: {error}")
    })?;
    if !_instance.is_single() {
        platform::open_browser(&format!("http://localhost:{}/", config.port));
        return Ok(());
    }

    if let Err(error) = startup::sync(config.autostart) {
        log.warn(format!("No se pudo sincronizar el autostart: {error}"));
    }

    let conflict_processes = config.conflict_processes.clone();
    let config = Arc::new(RwLock::new(config));
    let conflict = Arc::new(ConflictMonitor::new(conflict_processes, log.clone()));
    conflict.start();
    let device = WheelDevice::start(Arc::clone(&config), log.clone());
    let profiles = ProfileStore::new(&data_dir, log.clone());

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context("no se pudo crear el runtime de Tokio")?;

    let configured_port = config.read().expect("config lock").port;
    let listener = runtime
        .block_on(async { TcpListener::bind(("0.0.0.0", configured_port)).await })
        .with_context(|| {
            format!(
                "no se pudo abrir el puerto {configured_port}. ¿Hay otro hub abierto?"
            )
        })?;
    let port = listener.local_addr()?.port();

    let state = AppState {
        config: Arc::clone(&config),
        device,
        profiles: Arc::new(Mutex::new(profiles)),
        conflict,
        log: log.child("http"),
        started_at: Instant::now(),
        web_root: resolve_web_root(args.web_root),
        rate_limiter: Arc::new(RateLimiter::new(20.0, 40.0)),
    };

    let app = router(state.clone());
    let server_log = log.child("http");
    runtime.spawn(async move {
        if let Err(error) = axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        {
            server_log.error(format!("El servidor HTTP falló: {error}"));
        }
    });

    let snapshot = config.read().expect("config lock").clone();
    if cfg!(debug_assertions) {
        print_banner(port, &snapshot);
    }
    log.info(format!("PC: http://localhost:{port}/"));
    log.info("El QR para el móvil está en Ajustes → Emparejar un móvil");

    let should_open =
        args.open || (!args.autostart && !args.no_tray && !cfg!(debug_assertions));
    if should_open {
        platform::open_browser(&format!("http://localhost:{port}/"));
    }

    if args.no_tray {
        runtime.block_on(async {
            let _ = tokio::signal::ctrl_c().await;
        });
        runtime.shutdown_background();
        return Ok(());
    }

    tray::run(
        Arc::clone(&config),
        state.device.clone(),
        port,
        log.clone(),
    )?;
    runtime.shutdown_background();
    Ok(())
}

fn resolve_web_root(explicit: Option<PathBuf>) -> PathBuf {
    if let Some(path) = explicit {
        return path;
    }
    let candidates = [
        PathBuf::from("../web/dist"),
        PathBuf::from("web/dist"),
        PathBuf::from("../../web/dist"),
    ];
    for candidate in candidates {
        if candidate.join("index.html").is_file() {
            return candidate;
        }
    }
    PathBuf::from("../web/dist")
}

fn print_banner(port: u16, config: &ffbeast_hub::config::AppConfig) {
    let lan = local_ip_address::local_ip().ok().map(|ip| ip.to_string());
    let mobile = format!(
        "http://{}:{port}/m?t={}",
        lan.clone().unwrap_or_else(|| "localhost".to_string()),
        config.token
    );
    let line = "=".repeat(64);
    println!("\n{line}");
    println!(
        " FFBeast Remote {VERSION} (Rust){}",
        if config.mock { "  ·  MODO SIMULADO" } else { "" }
    );
    println!("{line}");
    println!(" PC:     http://localhost:{port}/");
    println!(" Móvil:  {mobile}");
    println!(" Datos:  {}", app_data_dir().display());
    if lan.is_none() {
        println!(" Aviso:  no se ha detectado una IP de LAN.");
    }
    if config.mock {
        println!(" Simulación: los cambios no llegan a ningún volante real.");
    }
    println!("{line}\n");

    if let Ok(code) = QrCode::new(mobile.as_bytes()) {
        let qr = code
            .render::<qrcode::render::unicode::Dense1x2>()
            .quiet_zone(true)
            .build();
        println!("{qr}\n");
    }
}
