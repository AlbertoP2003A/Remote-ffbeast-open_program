use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, RwLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use hidapi::{HidApi, HidDevice};
use tokio::sync::oneshot;

use crate::config::{AppConfig, VERSION};
use crate::fields;
use crate::hid::codec::{
    decode_adc, decode_effects, decode_gpio, decode_hardware, decode_joystick, decode_license,
    decode_state, encode_command, encode_setting, payload_from_report, read_field_value,
    CommandName,
};
use crate::hid::types::*;
use crate::logger::Logger;

#[derive(Debug, Clone)]
pub struct SharedDevice {
    pub connected: bool,
    pub mock: bool,
    pub settings: Option<DeviceSettings>,
    pub license: Option<LicenseInfo>,
    pub live: Option<LiveState>,
    pub axes: Option<JoystickAxes>,
    pub health: DeviceHealth,
    pub path: Option<String>,
    pub read_only: bool,
    pub port: u16,
    pub settings_version: u64,
    pub pending_force_check: bool,
    pub last_safety: Option<SafetyEvent>,
}

pub enum DeviceCommand {
    WriteSetting {
        field: String,
        value: i32,
        index: usize,
        reply: oneshot::Sender<Result<DeviceSettings, String>>,
    },
    Command {
        name: CommandName,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Refresh {
        reply: oneshot::Sender<Result<DeviceSettings, String>>,
    },
    DisableForces {
        reply: oneshot::Sender<Result<DeviceSettings, String>>,
    },
}

#[derive(Clone)]
pub struct WheelDevice {
    shared: Arc<RwLock<SharedDevice>>,
    log: Logger,
    tx: Sender<DeviceCommand>,
}

impl WheelDevice {
    pub fn start(config: Arc<RwLock<AppConfig>>, log: Logger) -> Self {
        let snapshot = config.read().expect("config lock").clone();
        let shared = Arc::new(RwLock::new(SharedDevice {
            connected: false,
            mock: snapshot.mock,
            settings: None,
            license: None,
            live: None,
            axes: None,
            health: DeviceHealth::default(),
            path: None,
            read_only: snapshot.read_only,
            port: snapshot.port,
            settings_version: 0,
            pending_force_check: false,
            last_safety: None,
        }));

        let (tx, rx) = mpsc::channel();
        let device = Self {
            shared: Arc::clone(&shared),
            log: log.clone(),
            tx,
        };

        if snapshot.mock {
            let shared_mock = Arc::clone(&shared);
            let log_mock = log.child("mock");
            let config_mock = Arc::clone(&config);
            thread::spawn(move || run_mock(shared_mock, log_mock, config_mock, rx));
        } else {
            let shared_vendor = Arc::clone(&shared);
            let log_vendor = log.child("hid");
            let config_vendor = Arc::clone(&config);
            thread::spawn(move || run_vendor(shared_vendor, log_vendor, config_vendor, rx));

            let shared_joystick = Arc::clone(&shared);
            let log_joystick = log.child("joystick");
            thread::spawn(move || run_joystick(shared_joystick, log_joystick));
        }

        device
    }

    pub fn snapshot(&self) -> SharedDevice {
        self.shared.read().expect("device lock").clone()
    }

    pub fn status(&self, conflict: Option<ConflictInfo>) -> HubStatus {
        let shared = self.shared.read().expect("device lock");
        let firmware = shared.license.as_ref().map(|license| {
            format!("{}.{}.{}", license.major, license.minor, license.patch)
        });
        HubStatus {
            connected: shared.connected,
            mock: shared.mock,
            firmware,
            license: shared.license.clone(),
            read_only: shared.read_only,
            port: shared.port,
            version: VERSION.to_string(),
            path: shared.path.clone(),
            position: shared.live.as_ref().map(|live| live.position),
            torque: shared.live.as_ref().map(|live| live.torque),
            health: shared.health.clone(),
            conflict,
        }
    }

    pub fn settings(&self) -> Option<DeviceSettings> {
        self.shared.read().expect("device lock").settings.clone()
    }

    pub fn live(&self) -> Option<LiveState> {
        self.shared.read().expect("device lock").live.clone()
    }

    pub fn health(&self) -> DeviceHealth {
        self.shared.read().expect("device lock").health.clone()
    }

    pub fn settings_version(&self) -> u64 {
        self.shared.read().expect("device lock").settings_version
    }

    pub fn last_safety(&self) -> Option<SafetyEvent> {
        self.shared.read().expect("device lock").last_safety.clone()
    }

    pub fn is_mock(&self) -> bool {
        self.shared.read().expect("device lock").mock
    }

    pub async fn write_setting(
        &self,
        field: &str,
        value: i32,
        index: usize,
    ) -> Result<DeviceSettings, String> {
        let (reply, receiver) = oneshot::channel();
        self.tx
            .send(DeviceCommand::WriteSetting {
                field: field.to_string(),
                value,
                index,
                reply,
            })
            .map_err(|_| "El driver no está disponible".to_string())?;
        await_reply(receiver).await
    }

    pub async fn command(&self, name: CommandName) -> Result<(), String> {
        let (reply, receiver) = oneshot::channel();
        self.tx
            .send(DeviceCommand::Command { name, reply })
            .map_err(|_| "El driver no está disponible".to_string())?;
        await_reply(receiver).await
    }

    pub async fn refresh(&self) -> Result<DeviceSettings, String> {
        let (reply, receiver) = oneshot::channel();
        self.tx
            .send(DeviceCommand::Refresh { reply })
            .map_err(|_| "El driver no está disponible".to_string())?;
        await_reply(receiver).await
    }

    pub async fn disable_forces(&self) -> Result<DeviceSettings, String> {
        let (reply, receiver) = oneshot::channel();
        self.tx
            .send(DeviceCommand::DisableForces { reply })
            .map_err(|_| "El driver no está disponible".to_string())?;
        await_reply(receiver).await
    }

    pub fn set_read_only(&self, read_only: bool) {
        self.shared
            .write()
            .expect("device lock")
            .read_only = read_only;
    }

    pub fn log(&self) -> &Logger {
        &self.log
    }
}

async fn await_reply<T>(
    receiver: tokio::sync::oneshot::Receiver<Result<T, String>>,
) -> Result<T, String> {
    // Si el volante se desconecta a mitad, el hilo del driver no llega a
    // responder. Mejor un error claro a los 5 s que una peticion colgada.
    const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
    match tokio::time::timeout(TIMEOUT, receiver).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("El driver no respondió".to_string()),
        Err(_) => Err("El driver no respondió (tiempo de espera agotado)".to_string()),
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn update_live(shared: &Arc<RwLock<SharedDevice>>, raw: StateRaw) {
    let mut state = shared.write().expect("device lock");
    let range = state
        .settings
        .as_ref()
        .map(|settings| settings.effects.motion_range as f64)
        .unwrap_or(900.0);
    let axes = state.axes.clone();
    state.live = Some(LiveState {
        release_type: raw.release_type,
        major: raw.major,
        minor: raw.minor,
        patch: raw.patch,
        is_registered: raw.is_registered,
        position: raw.position,
        torque: raw.torque,
        position_degrees: (raw.position as f64 / 10_000.0) * (range / 2.0),
        position_percent: raw.position as f64 / 100.0,
        position_normalized: raw.position as f64 / 10_000.0,
        torque_normalized: raw.torque as f64 / 10_000.0,
        torque_percent: raw.torque as f64 / 100.0,
        timestamp: now_ms(),
        axes,
    });
}

fn set_axes(shared: &Arc<RwLock<SharedDevice>>, axes: Option<JoystickAxes>) {
    let axes = axes.map(|mut axes| {
        axes.timestamp = now_ms();
        axes
    });
    let mut state = shared.write().expect("device lock");
    state.axes = axes.clone();
    if let Some(live) = state.live.as_mut() {
        live.axes = axes;
    }
}

fn note_failure(shared: &Arc<RwLock<SharedDevice>>, message: &str) {
    let mut state = shared.write().expect("device lock");
    state.health.consecutive_failures += 1;
    state.health.degraded = state.health.consecutive_failures >= 3;
    state.health.last_error = Some(message.to_string());
    state.health.last_error_at = Some(now_ms());
}

fn note_success(shared: &Arc<RwLock<SharedDevice>>) {
    let mut state = shared.write().expect("device lock");
    state.health.consecutive_failures = 0;
    state.health.degraded = false;
}

fn read_payload(device: &HidDevice, report_id: u8) -> Result<Vec<u8>, String> {
    let mut buffer = [0u8; REPORT_SIZE];
    buffer[0] = report_id;
    let length = device
        .get_feature_report(&mut buffer)
        .map_err(|error| error.to_string())?;
    Ok(payload_from_report(&buffer[..length], report_id).to_vec())
}

fn read_all(
    device: &HidDevice,
    shared: &Arc<RwLock<SharedDevice>>,
    log: &Logger,
) -> Result<(), String> {
    let effects = decode_effects(&read_payload(device, REPORT_ID_EFFECTS)?)
        .map_err(|error| error.to_string())?;
    let hardware = decode_hardware(&read_payload(device, REPORT_ID_HARDWARE)?)
        .map_err(|error| error.to_string())?;
    let gpio = decode_gpio(&read_payload(device, REPORT_ID_GPIO)?)
        .map_err(|error| error.to_string())?;
    let adc =
        decode_adc(&read_payload(device, REPORT_ID_ADC)?).map_err(|error| error.to_string())?;
    let license = decode_license(&read_payload(device, REPORT_ID_LICENSE)?)
        .map_err(|error| error.to_string())?;

    let force_enabled = hardware.force_enabled == 1;
    {
        let mut state = shared.write().expect("device lock");
        state.settings = Some(DeviceSettings {
            effects,
            hardware,
            gpio,
            adc,
        });
        state.license = Some(license);
        state.settings_version += 1;
        if state.pending_force_check {
            state.pending_force_check = false;
            state.last_safety = Some(SafetyEvent {
                ok: !force_enabled,
                force_enabled,
                message: if force_enabled {
                    "El volante sigue con la fuerza activada tras el reinicio. Revísalo en Hardware."
                        .to_string()
                } else {
                    "Fuerzas desactivadas y verificadas.".to_string()
                },
                timestamp: now_ms(),
            });
        }
    }
    note_success(shared);
    log.info("Ajustes leídos del volante");
    Ok(())
}

fn mark_connected(shared: &Arc<RwLock<SharedDevice>>, path: Option<String>) {
    let mut state = shared.write().expect("device lock");
    state.connected = true;
    state.path = path;
    state.health.connections += 1;
    state.health.last_error = None;
    state.health.consecutive_failures = 0;
    state.health.degraded = false;
}

fn mark_disconnected(shared: &Arc<RwLock<SharedDevice>>, reason: &str) {
    {
        let mut state = shared.write().expect("device lock");
        state.connected = false;
        state.live = None;
        state.path = None;
    }
    note_failure(shared, reason);
}

fn report_id_for_group(group: SettingsGroup) -> Option<u8> {
    match group {
        SettingsGroup::Effects => Some(REPORT_ID_EFFECTS),
        SettingsGroup::Hardware => Some(REPORT_ID_HARDWARE),
        SettingsGroup::Gpio => Some(REPORT_ID_GPIO),
        SettingsGroup::Adc => Some(REPORT_ID_ADC),
        SettingsGroup::Misc => None,
    }
}

fn write_setting_on_device(
    device: &HidDevice,
    shared: &Arc<RwLock<SharedDevice>>,
    field: &str,
    value: i32,
    index: usize,
) -> Result<DeviceSettings, String> {
    let def = fields::field_by_name(field)
        .ok_or_else(|| format!("Campo desconocido: {field}"))?;
    fields::validate_field(def, value, index)?;
    if let Some(message) =
        fields::check_compatibility(&def.name, value, shared.read().expect("device lock").license.as_ref())
    {
        return Err(message);
    }
    if shared.read().expect("device lock").read_only {
        return Err("Hub en modo solo lectura".to_string());
    }
    if shared.read().expect("device lock").health.degraded {
        return Err("Volante inestable: relee los ajustes antes de escribir".to_string());
    }

    let buffer = encode_setting(def.id, index as u8, def.r#type, value);
    if let Err(error) = device.write(&buffer) {
        note_failure(shared, &error.to_string());
        return Err(error.to_string());
    }
    thread::sleep(Duration::from_millis(6));

    if def.readback && !def.requires_reboot.unwrap_or(false) {
        let payload = match report_id_for_group(def.group) {
            Some(report_id) => read_payload(device, report_id)?,
            None => Vec::new(),
        };
        if !payload.is_empty() {
            let actual = read_field_value(&payload, &def.name, index);
            if actual != Some(value) {
                let message = format!(
                    "El volante no aceptó {} (esperado {value}, leído {actual:?})",
                    def.label
                );
                note_failure(shared, &message);
                return Err(message);
            }
        }
    }

    let mut state = shared.write().expect("device lock");
    if let Some(settings) = state.settings.as_mut() {
        fields::with_value(settings, &def.name, value, index);
    }
    state.settings_version += 1;
    state.health.consecutive_failures = 0;
    state.health.degraded = false;
    Ok(state.settings.clone().unwrap_or_default())
}

fn run_device_command(
    device: &HidDevice,
    shared: &Arc<RwLock<SharedDevice>>,
    config: &Arc<RwLock<AppConfig>>,
    name: CommandName,
) -> (Result<(), String>, bool) {
    if shared.read().expect("device lock").read_only {
        return (Err("Hub en modo solo lectura".to_string()), false);
    }
    if shared.read().expect("device lock").health.degraded {
        return (
            Err("Volante inestable: relee los ajustes antes de escribir".to_string()),
            false,
        );
    }
    let config = config.read().expect("config lock").clone();
    let allowed = match name {
        CommandName::ResetCenter => true,
        CommandName::Save => config.allow_save_command,
        CommandName::Reboot => config.allow_reboot_command,
        CommandName::Dfu => config.allow_dfu_command,
    };
    if !allowed {
        return (Err(format!("Comando desactivado: {name:?}")), false);
    }

    let buffer = encode_command(name);
    if let Err(error) = device.write(&buffer) {
        note_failure(shared, &error.to_string());
        return (Err(error.to_string()), false);
    }
    note_success(shared);

    if name == CommandName::ResetCenter {
        (Ok(()), false)
    } else {
        thread::sleep(Duration::from_millis(300));
        (Ok(()), true)
    }
}

fn handle_vendor_command(
    device: &HidDevice,
    shared: &Arc<RwLock<SharedDevice>>,
    config: &Arc<RwLock<AppConfig>>,
    log: &Logger,
    command: DeviceCommand,
) -> bool {
    match command {
        DeviceCommand::WriteSetting {
            field,
            value,
            index,
            reply,
        } => {
            let result = write_setting_on_device(device, shared, &field, value, index);
            let _ = reply.send(result);
            false
        }
        DeviceCommand::Command { name, reply } => {
            let (result, reconnect) = run_device_command(device, shared, config, name);
            match &result {
                Ok(()) => log.info(format!("Comando enviado: {name:?}")),
                Err(error) => log.warn(format!("Comando {name:?} rechazado: {error}")),
            }
            let _ = reply.send(result);
            reconnect
        }
        DeviceCommand::Refresh { reply } => {
            let result = read_all(device, shared, log).map(|_| {
                shared
                    .read()
                    .expect("device lock")
                    .settings
                    .clone()
                    .unwrap_or_default()
            });
            let _ = reply.send(result);
            false
        }
        DeviceCommand::DisableForces { reply } => {
            let allowed = config.read().expect("config lock").allow_save_command;
            if !allowed {
                let _ = reply.send(Err(
                    "El comando guardar está desactivado: no se puede persistir el cambio"
                        .to_string(),
                ));
                return false;
            }
            let result = write_setting_on_device(device, shared, "forceEnabled", 0, 0).and_then(
                |_| {
                    let (result, _) = run_device_command(device, shared, config, CommandName::Save);
                    result.map(|_| {
                        shared
                            .read()
                            .expect("device lock")
                            .settings
                            .clone()
                            .unwrap_or_default()
                    })
                },
            );
            if result.is_ok() {
                shared
                    .write()
                    .expect("device lock")
                    .pending_force_check = true;
            }
            let _ = reply.send(result);
            true
        }
    }
}

fn run_vendor(
    shared: Arc<RwLock<SharedDevice>>,
    log: Logger,
    config: Arc<RwLock<AppConfig>>,
    commands: Receiver<DeviceCommand>,
) {
    loop {
        // Contexto nuevo en cada intento: hidapi cachea la lista de
        // dispositivos y, al iniciar con Windows, el volante puede aparecer
        // después. Si HID aún no está listo, se reintenta en vez de morir.
        let api = match HidApi::new() {
            Ok(api) => api,
            Err(error) => {
                log.warn(format!("HID aún no está listo: {error}"));
                thread::sleep(Duration::from_millis(1500));
                continue;
            }
        };

        let info = api.device_list().find(|info| {
            info.vendor_id() == USB_VID
                && info.product_id() == USB_PID
                && info.interface_number() == VENDOR_INTERFACE
        });

        let Some(info) = info else {
            thread::sleep(Duration::from_millis(1500));
            continue;
        };

        let path = info.path().to_string_lossy().to_string();
        match info.open_device(&api) {
            Ok(device) => {
                mark_connected(&shared, Some(path));
                log.info("Volante conectado (vendor)");

                if let Err(error) = read_all(&device, &shared, &log) {
                    log.warn(format!("No se pudieron leer los ajustes: {error}"));
                    mark_disconnected(&shared, &error);
                    thread::sleep(Duration::from_millis(1500));
                    continue;
                }

                let mut buffer = [0u8; REPORT_SIZE];
                let mut reconnect = false;
                loop {
                    while let Ok(command) = commands.try_recv() {
                        if handle_vendor_command(&device, &shared, &config, &log, command) {
                            reconnect = true;
                            break;
                        }
                    }
                    if reconnect {
                        mark_disconnected(&shared, "comando de guardado/reinicio");
                        break;
                    }

                    match device.read_timeout(&mut buffer, 50) {
                        Ok(0) => {}
                        Ok(length) => {
                            if buffer[0] != REPORT_ID_GENERIC {
                                continue;
                            }
                            let payload = &buffer[1..length.min(REPORT_SIZE)];
                            match decode_state(payload) {
                                Ok(raw) => update_live(&shared, raw),
                                Err(error) => log.debug(format!("Estado inválido: {error}")),
                            }
                        }
                        Err(error) => {
                            log.warn(format!("Error de HID: {error}"));
                            mark_disconnected(&shared, &error.to_string());
                            break;
                        }
                    }
                }
            }
            Err(error) => {
                log.warn(format!("No se pudo abrir el volante: {error}"));
            }
        }

        thread::sleep(Duration::from_millis(1500));
    }
}

fn run_joystick(shared: Arc<RwLock<SharedDevice>>, log: Logger) {
    loop {
        let api = match HidApi::new() {
            Ok(api) => api,
            Err(error) => {
                log.warn(format!("HID aún no está listo (joystick): {error}"));
                thread::sleep(Duration::from_millis(1500));
                continue;
            }
        };

        let info = api.device_list().find(|info| {
            info.vendor_id() == USB_VID
                && info.product_id() == USB_PID
                && info.interface_number() == JOYSTICK_INTERFACE
        });

        let Some(info) = info else {
            thread::sleep(Duration::from_millis(1500));
            continue;
        };

        match info.open_device(&api) {
            Ok(device) => {
                log.info("Interfaz de joystick conectada");
                let mut buffer = [0u8; 64];
                loop {
                    match device.read_timeout(&mut buffer, 200) {
                        Ok(0) => {}
                        Ok(length) => match decode_joystick(&buffer[..length]) {
                            Ok(axes) => set_axes(&shared, Some(axes)),
                            Err(error) => log.debug(format!("Joystick inválido: {error}")),
                        },
                        Err(error) => {
                            log.warn(format!("Error de la interfaz de joystick: {error}"));
                            break;
                        }
                    }
                }
                set_axes(&shared, None);
                log.warn("Interfaz de joystick desconectada");
            }
            Err(error) => {
                log.warn(format!("No se pudo abrir el joystick: {error}"));
            }
        }

        thread::sleep(Duration::from_millis(1500));
    }
}

fn mock_reboot(shared: &Arc<RwLock<SharedDevice>>) {
    {
        let mut state = shared.write().expect("device lock");
        state.connected = false;
        state.live = None;
    }
    thread::sleep(Duration::from_millis(300));
    {
        let mut state = shared.write().expect("device lock");
        state.connected = true;
        state.health.connections += 1;
        state.health.consecutive_failures = 0;
        state.health.degraded = false;
    }
}

fn handle_mock_command(
    shared: &Arc<RwLock<SharedDevice>>,
    config: &Arc<RwLock<AppConfig>>,
    command: DeviceCommand,
) {
    match command {
        DeviceCommand::WriteSetting {
            field,
            value,
            index,
            reply,
        } => {
            let result = (|| -> Result<DeviceSettings, String> {
                if shared.read().expect("device lock").read_only {
                    return Err("Hub en modo solo lectura".to_string());
                }
                if shared.read().expect("device lock").health.degraded {
                    return Err("Volante inestable: relee los ajustes antes de escribir".to_string());
                }
                let def = fields::field_by_name(&field)
                    .ok_or_else(|| format!("Campo desconocido: {field}"))?;
                fields::validate_field(def, value, index)?;
                if let Some(message) = fields::check_compatibility(
                    &def.name,
                    value,
                    shared.read().expect("device lock").license.as_ref(),
                ) {
                    return Err(message);
                }
                let mut state = shared.write().expect("device lock");
                let Some(settings) = state.settings.as_mut() else {
                    return Err("Volante desconectado".to_string());
                };
                fields::with_value(settings, &def.name, value, index);
                state.settings_version += 1;
                state.health.consecutive_failures = 0;
                state.health.degraded = false;
                Ok(state.settings.clone().unwrap_or_default())
            })();
            let _ = reply.send(result);
        }
        DeviceCommand::Command { name, reply } => {
            let result = (|| -> Result<(), String> {
                if shared.read().expect("device lock").read_only {
                    return Err("Hub en modo solo lectura".to_string());
                }
                let config = config.read().expect("config lock").clone();
                let allowed = match name {
                    CommandName::ResetCenter => true,
                    CommandName::Save => config.allow_save_command,
                    CommandName::Reboot => config.allow_reboot_command,
                    CommandName::Dfu => config.allow_dfu_command,
                };
                if !allowed {
                    return Err(format!("Comando desactivado: {name:?}"));
                }
                Ok(())
            })();
            let _ = reply.send(result.clone());
            if result.is_ok() && name != CommandName::ResetCenter {
                mock_reboot(shared);
            }
        }
        DeviceCommand::Refresh { reply } => {
            let settings = shared
                .read()
                .expect("device lock")
                .settings
                .clone()
                .ok_or_else(|| "Volante desconectado".to_string());
            let _ = reply.send(settings);
        }
        DeviceCommand::DisableForces { reply } => {
            let result = (|| -> Result<DeviceSettings, String> {
                if !config.read().expect("config lock").allow_save_command {
                    return Err(
                        "El comando guardar está desactivado: no se puede persistir el cambio"
                            .to_string(),
                    );
                }
                if shared.read().expect("device lock").read_only {
                    return Err("Hub en modo solo lectura".to_string());
                }
                let mut state = shared.write().expect("device lock");
                let Some(settings) = state.settings.as_mut() else {
                    return Err("Volante desconectado".to_string());
                };
                settings.hardware.force_enabled = 0;
                state.settings_version += 1;
                Ok(state.settings.clone().unwrap_or_default())
            })();
            let ok = result.is_ok();
            let _ = reply.send(result);
            mock_reboot(shared);
            if ok {
                shared.write().expect("device lock").last_safety = Some(SafetyEvent {
                    ok: true,
                    force_enabled: false,
                    message: "Fuerzas desactivadas y verificadas.".to_string(),
                    timestamp: now_ms(),
                });
            }
        }
    }
}

fn run_mock(
    shared: Arc<RwLock<SharedDevice>>,
    log: Logger,
    config: Arc<RwLock<AppConfig>>,
    commands: Receiver<DeviceCommand>,
) {
    log.info("Volante simulado");
    {
        let mut state = shared.write().expect("device lock");
        state.connected = true;
        state.mock = true;
        state.settings = Some(DeviceSettings::default());
        state.license = Some(LicenseInfo::default());
        state.health.connections = 1;
        state.health.degraded = false;
    }

    let started = Instant::now();
    loop {
        while let Ok(command) = commands.try_recv() {
            handle_mock_command(&shared, &config, command);
        }

        let t = started.elapsed().as_secs_f64();
        let range = shared
            .read()
            .expect("device lock")
            .settings
            .as_ref()
            .map(|settings| settings.effects.motion_range as f64)
            .unwrap_or(900.0);
        let position = (t * 1.4).sin() * 8500.0;
        let torque = (t * 1.4).cos() * 2500.0 + (range - 900.0) * 2.0;
        let raw = StateRaw {
            release_type: 1,
            major: 26,
            minor: 1,
            patch: 1,
            is_registered: true,
            position: position.round() as i16,
            torque: torque.round() as i16,
        };
        update_live(&shared, raw);

        let axes = JoystickAxes {
            x: ((t * 1.4).sin() * 30_000.0) as i16,
            y: 0,
            z: 0,
            rx: (((t * 0.9).sin() + 1.0) / 2.0 * 32_767.0) as i16,
            ry: (((t * 0.6 + 1.0).sin() + 1.0) / 2.0 * 32_767.0) as i16,
            rz: (((t * 0.4 + 2.0).sin() + 1.0) / 2.0 * 32_767.0) as i16,
            slider: 0,
            dial: 0,
            buttons: Vec::new(),
            timestamp: now_ms(),
        };
        set_axes(&shared, Some(axes));
        thread::sleep(Duration::from_millis(20));
    }
}

/// Calcula la posicion en grados para la UI (util para tests).
#[allow(dead_code)]
pub fn degrees(position: i16, motion_range: u16) -> f64 {
    (position as f64 / 10_000.0) * (motion_range as f64 / 2.0)
}
