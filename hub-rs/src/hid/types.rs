use serde::{Deserialize, Serialize};

pub const USB_VID: u16 = 0x045b;
pub const USB_PID: u16 = 0x59d7;
pub const VENDOR_INTERFACE: i32 = 0;
pub const JOYSTICK_INTERFACE: i32 = 1;
pub const USAGE_PAGE: u16 = 0xff72;

pub const REPORT_SIZE: usize = 65;
pub const PAYLOAD_SIZE: usize = 64;

pub const REPORT_ID_JOYSTICK: u8 = 0x01;
pub const REPORT_ID_HARDWARE: u8 = 0x21;
pub const REPORT_ID_EFFECTS: u8 = 0x22;
pub const REPORT_ID_LICENSE: u8 = 0x25;
pub const REPORT_ID_GPIO: u8 = 0xa1;
pub const REPORT_ID_ADC: u8 = 0xa2;
pub const REPORT_ID_GENERIC: u8 = 0xa3;

pub const DATA_COMMAND_REBOOT: u8 = 0x01;
pub const DATA_COMMAND_SAVE: u8 = 0x02;
pub const DATA_COMMAND_DFU: u8 = 0x03;
pub const DATA_COMMAND_RESET_CENTER: u8 = 0x04;
pub const DATA_COMMAND_DIRECT_CONTROL: u8 = 0x10;
pub const DATA_COMMAND_SETTINGS_FIELD: u8 = 0x14;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FieldType {
    U8,
    I8,
    U16,
    I16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SettingsGroup {
    Effects,
    Hardware,
    Gpio,
    Adc,
    Misc,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldOption {
    pub value: i32,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldDef {
    pub name: String,
    pub id: u8,
    pub r#type: FieldType,
    pub group: SettingsGroup,
    pub label: String,
    pub unit: Option<String>,
    pub min: i32,
    pub max: i32,
    pub step: i32,
    pub advanced: bool,
    pub array_length: Option<usize>,
    pub readback: bool,
    pub requires_reboot: Option<bool>,
    pub description: Option<String>,
    pub options: Option<Vec<FieldOption>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectsSettings {
    pub motion_range: u16,
    pub static_dampening_strength: u16,
    pub soft_stop_dampening_strength: u16,
    pub dynamic_dampening_strength: u16,
    pub total_effect_strength: u8,
    pub integrated_spring_strength: u8,
    pub soft_stop_range: u8,
    pub soft_stop_strength: u8,
    pub direct_x_constant_direction: i8,
    pub direct_x_spring_strength: u8,
    pub direct_x_constant_strength: u8,
    pub direct_x_periodic_strength: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareSettings {
    pub encoder_cpr: u16,
    pub integral_gain: u16,
    pub proportional_gain: u8,
    pub force_enabled: u8,
    pub debug_torque: u8,
    pub amplifier_gain: u8,
    pub calibration_magnitude: u8,
    pub calibration_speed: u8,
    pub power_limit: u8,
    pub braking_limit: u8,
    pub position_smoothing: u8,
    pub speed_buffer_size: u8,
    pub encoder_direction: i8,
    pub force_direction: i8,
    pub pole_pairs: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpioSettings {
    pub extension_mode: u8,
    pub pin_mode: [u8; 10],
    pub button_mode: [u8; 32],
    pub spi_mode: u8,
    pub spi_latch_mode: u8,
    pub spi_latch_delay: u8,
    pub spi_clk_pulse_length: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdcSettings {
    pub adc_min_dead_zone: [u16; 3],
    pub adc_max_dead_zone: [u16; 3],
    pub adc_smoothing: [u8; 3],
    pub adc_to_button_low: [u8; 3],
    pub adc_to_button_high: [u8; 3],
    pub adc_invert: [u8; 3],
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSettings {
    pub effects: EffectsSettings,
    pub hardware: HardwareSettings,
    pub gpio: GpioSettings,
    pub adc: AdcSettings,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseInfo {
    pub release_type: u8,
    pub major: u8,
    pub minor: u8,
    pub patch: u8,
    pub serial_key: [u32; 3],
    pub device_id: [u32; 3],
    pub is_registered: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StateRaw {
    pub release_type: u8,
    pub major: u8,
    pub minor: u8,
    pub patch: u8,
    pub is_registered: bool,
    pub position: i16,
    pub torque: i16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoystickAxes {
    pub x: i16,
    pub y: i16,
    pub z: i16,
    pub rx: i16,
    pub ry: i16,
    pub rz: i16,
    pub slider: i16,
    pub dial: i16,
    pub buttons: Vec<u8>,
    pub timestamp: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveState {
    pub release_type: u8,
    pub major: u8,
    pub minor: u8,
    pub patch: u8,
    pub is_registered: bool,
    pub position: i16,
    pub torque: i16,
    pub position_degrees: f64,
    pub position_percent: f64,
    pub position_normalized: f64,
    pub torque_normalized: f64,
    pub torque_percent: f64,
    pub timestamp: u64,
    pub axes: Option<JoystickAxes>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceHealth {
    pub degraded: bool,
    pub consecutive_failures: u32,
    pub last_error: Option<String>,
    pub last_error_at: Option<u64>,
    pub connections: u64,
}

impl Default for DeviceHealth {
    fn default() -> Self {
        Self {
            degraded: false,
            consecutive_failures: 0,
            last_error: None,
            last_error_at: None,
            connections: 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictInfo {
    pub active: bool,
    pub process: Option<String>,
    pub checked_at: Option<u64>,
}

impl Default for ConflictInfo {
    fn default() -> Self {
        Self {
            active: false,
            process: None,
            checked_at: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafetyEvent {
    pub ok: bool,
    pub force_enabled: bool,
    pub message: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubStatus {
    pub connected: bool,
    pub mock: bool,
    pub firmware: Option<String>,
    pub license: Option<LicenseInfo>,
    pub read_only: bool,
    pub port: u16,
    pub version: String,
    pub path: Option<String>,
    pub position: Option<i16>,
    pub torque: Option<i16>,
    pub health: DeviceHealth,
    pub conflict: Option<ConflictInfo>,
}

impl Default for EffectsSettings {
    fn default() -> Self {
        Self {
            motion_range: 900,
            static_dampening_strength: 10,
            soft_stop_dampening_strength: 20,
            dynamic_dampening_strength: 0,
            total_effect_strength: 100,
            integrated_spring_strength: 0,
            soft_stop_range: 10,
            soft_stop_strength: 100,
            direct_x_constant_direction: 1,
            direct_x_spring_strength: 100,
            direct_x_constant_strength: 100,
            direct_x_periodic_strength: 100,
        }
    }
}

impl Default for HardwareSettings {
    fn default() -> Self {
        Self {
            encoder_cpr: 4096,
            integral_gain: 100,
            proportional_gain: 10,
            force_enabled: 1,
            debug_torque: 0,
            amplifier_gain: 1,
            calibration_magnitude: 50,
            calibration_speed: 50,
            power_limit: 80,
            braking_limit: 50,
            position_smoothing: 10,
            speed_buffer_size: 10,
            encoder_direction: 1,
            force_direction: 1,
            pole_pairs: 7,
        }
    }
}

impl Default for GpioSettings {
    fn default() -> Self {
        Self {
            extension_mode: 0,
            pin_mode: [0; 10],
            button_mode: [1; 32],
            spi_mode: 0,
            spi_latch_mode: 0,
            spi_latch_delay: 0,
            spi_clk_pulse_length: 0,
        }
    }
}

impl Default for AdcSettings {
    fn default() -> Self {
        Self {
            adc_min_dead_zone: [0; 3],
            adc_max_dead_zone: [65535; 3],
            adc_smoothing: [0; 3],
            adc_to_button_low: [0; 3],
            adc_to_button_high: [100; 3],
            adc_invert: [0; 3],
        }
    }
}

impl Default for DeviceSettings {
    fn default() -> Self {
        Self {
            effects: EffectsSettings::default(),
            hardware: HardwareSettings::default(),
            gpio: GpioSettings::default(),
            adc: AdcSettings::default(),
        }
    }
}

impl Default for LicenseInfo {
    fn default() -> Self {
        Self {
            release_type: 0,
            major: 26,
            minor: 1,
            patch: 1,
            serial_key: [0x1234_5678, 0x2345_6789, 0x3456_789a],
            device_id: [0xaaaa_1111, 0xbbbb_2222, 0xcccc_3333],
            is_registered: true,
        }
    }
}
