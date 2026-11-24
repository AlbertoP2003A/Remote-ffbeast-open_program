use std::fmt;

use super::types::{
    AdcSettings, DeviceSettings, EffectsSettings, FieldType, GpioSettings, HardwareSettings,
    JoystickAxes, LicenseInfo, StateRaw, DATA_COMMAND_DIRECT_CONTROL, DATA_COMMAND_DFU,
    DATA_COMMAND_REBOOT, DATA_COMMAND_RESET_CENTER, DATA_COMMAND_SAVE,
    DATA_COMMAND_SETTINGS_FIELD, PAYLOAD_SIZE, REPORT_ID_GENERIC, REPORT_ID_JOYSTICK,
    REPORT_SIZE,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CodecError {
    TooShort {
        name: &'static str,
        length: usize,
        min: usize,
    },
    WrongReportId {
        expected: u8,
        actual: u8,
    },
}

impl fmt::Display for CodecError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TooShort { name, length, min } => write!(
                f,
                "Reporte {name} demasiado corto: {length} bytes (min {min})"
            ),
            Self::WrongReportId { expected, actual } => write!(
                f,
                "Report id inesperado: 0x{actual:02X} (esperado 0x{expected:02X})"
            ),
        }
    }
}

impl std::error::Error for CodecError {}

pub type Result<T> = std::result::Result<T, CodecError>;

pub fn clamp(value: i32, min: i32, max: i32) -> i32 {
    value.max(min).min(max)
}

fn ensure(payload: &[u8], min: usize, name: &'static str) -> Result<()> {
    if payload.len() < min {
        return Err(CodecError::TooShort {
            name,
            length: payload.len(),
            min,
        });
    }
    Ok(())
}

fn u8_at(payload: &[u8], offset: usize) -> u8 {
    payload[offset]
}

fn i8_at(payload: &[u8], offset: usize) -> i8 {
    payload[offset] as i8
}

fn u16_at(payload: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([payload[offset], payload[offset + 1]])
}

fn i16_at(payload: &[u8], offset: usize) -> i16 {
    i16::from_le_bytes([payload[offset], payload[offset + 1]])
}

fn u32_at(payload: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([
        payload[offset],
        payload[offset + 1],
        payload[offset + 2],
        payload[offset + 3],
    ])
}

fn put_u16(payload: &mut [u8], offset: usize, value: u16) {
    payload[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}

fn put_i16(payload: &mut [u8], offset: usize, value: i16) {
    payload[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}

fn put_u32(payload: &mut [u8], offset: usize, value: u32) {
    payload[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

/// La respuesta de hidapi puede incluir el report id al principio.
/// Devuelve siempre un payload de como maximo 64 bytes.
pub fn payload_from_report<'a>(buf: &'a [u8], report_id: u8) -> &'a [u8] {
    if buf.len() > PAYLOAD_SIZE && buf.first() == Some(&report_id) {
        &buf[1..1 + PAYLOAD_SIZE]
    } else if buf.len() > PAYLOAD_SIZE {
        &buf[..PAYLOAD_SIZE]
    } else {
        buf
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandName {
    Reboot,
    Save,
    Dfu,
    ResetCenter,
}

impl CommandName {
    pub fn code(self) -> u8 {
        match self {
            Self::Reboot => DATA_COMMAND_REBOOT,
            Self::Save => DATA_COMMAND_SAVE,
            Self::Dfu => DATA_COMMAND_DFU,
            Self::ResetCenter => DATA_COMMAND_RESET_CENTER,
        }
    }
}

/// Escribe un ajuste en el reporte generico de 65 bytes.
pub fn encode_setting(field_id: u8, index: u8, ty: FieldType, value: i32) -> [u8; REPORT_SIZE] {
    let mut buf = [0u8; REPORT_SIZE];
    buf[0] = REPORT_ID_GENERIC;
    buf[1] = DATA_COMMAND_SETTINGS_FIELD;
    buf[2] = field_id;
    buf[3] = index;

    match ty {
        FieldType::U8 => buf[4] = clamp(value, 0, 0xff) as u8,
        FieldType::I8 => buf[4] = (clamp(value, -0x80, 0x7f) as i8) as u8,
        FieldType::U16 => put_u16(&mut buf, 4, clamp(value, 0, 0xffff) as u16),
        FieldType::I16 => put_i16(&mut buf, 4, clamp(value, -0x8000, 0x7fff) as i16),
    }
    buf
}

pub fn encode_command(name: CommandName) -> [u8; REPORT_SIZE] {
    let mut buf = [0u8; REPORT_SIZE];
    buf[0] = REPORT_ID_GENERIC;
    buf[1] = name.code();
    buf
}

pub fn encode_direct_control(
    spring_force: i32,
    constant_force: i32,
    periodic_force: i32,
    force_drop: u8,
) -> [u8; REPORT_SIZE] {
    let mut buf = [0u8; REPORT_SIZE];
    buf[0] = REPORT_ID_GENERIC;
    buf[1] = DATA_COMMAND_DIRECT_CONTROL;
    put_i16(&mut buf, 2, clamp(spring_force, -10000, 10000) as i16);
    put_i16(&mut buf, 4, clamp(constant_force, -10000, 10000) as i16);
    put_i16(&mut buf, 6, clamp(periodic_force, -10000, 10000) as i16);
    buf[8] = force_clamp(force_drop);
    buf
}

fn force_clamp(value: u8) -> u8 {
    value.min(100)
}

pub fn decode_state(payload: &[u8]) -> Result<StateRaw> {
    ensure(payload, 9, "state")?;
    Ok(StateRaw {
        release_type: u8_at(payload, 0),
        major: u8_at(payload, 1),
        minor: u8_at(payload, 2),
        patch: u8_at(payload, 3),
        is_registered: u8_at(payload, 4) != 0,
        position: i16_at(payload, 5),
        torque: i16_at(payload, 7),
    })
}

/// Decodifica un input report de la interfaz de joystick.
/// El buffer debe incluir el report id como primer byte.
pub fn decode_joystick(payload: &[u8]) -> Result<JoystickAxes> {
    ensure(payload, 25, "joystick")?;
    if payload[0] != REPORT_ID_JOYSTICK {
        return Err(CodecError::WrongReportId {
            expected: REPORT_ID_JOYSTICK,
            actual: payload[0],
        });
    }
    let mut buttons = Vec::new();
    for bit in 0..64 {
        let byte = payload[1 + (bit >> 3)];
        if byte & (1 << (bit & 7)) != 0 {
            buttons.push((bit + 1) as u8);
        }
    }
    Ok(JoystickAxes {
        x: i16_at(payload, 9),
        y: i16_at(payload, 11),
        z: i16_at(payload, 13),
        rx: i16_at(payload, 15),
        ry: i16_at(payload, 17),
        rz: i16_at(payload, 19),
        slider: i16_at(payload, 21),
        dial: i16_at(payload, 23),
        buttons,
        timestamp: 0,
    })
}

pub fn decode_effects(payload: &[u8]) -> Result<EffectsSettings> {
    ensure(payload, 16, "effects")?;
    Ok(EffectsSettings {
        motion_range: u16_at(payload, 0),
        static_dampening_strength: u16_at(payload, 2),
        soft_stop_dampening_strength: u16_at(payload, 4),
        total_effect_strength: u8_at(payload, 6),
        integrated_spring_strength: u8_at(payload, 7),
        soft_stop_range: u8_at(payload, 8),
        soft_stop_strength: u8_at(payload, 9),
        direct_x_constant_direction: i8_at(payload, 10),
        direct_x_spring_strength: u8_at(payload, 11),
        direct_x_constant_strength: u8_at(payload, 12),
        direct_x_periodic_strength: u8_at(payload, 13),
        dynamic_dampening_strength: u16_at(payload, 14),
    })
}

pub fn decode_hardware(payload: &[u8]) -> Result<HardwareSettings> {
    ensure(payload, 17, "hardware")?;
    Ok(HardwareSettings {
        encoder_cpr: u16_at(payload, 0),
        integral_gain: u16_at(payload, 2),
        proportional_gain: u8_at(payload, 4),
        force_enabled: u8_at(payload, 5),
        debug_torque: u8_at(payload, 6),
        amplifier_gain: u8_at(payload, 7),
        calibration_magnitude: u8_at(payload, 8),
        calibration_speed: u8_at(payload, 9),
        power_limit: u8_at(payload, 10),
        braking_limit: u8_at(payload, 11),
        position_smoothing: u8_at(payload, 12),
        speed_buffer_size: u8_at(payload, 13),
        encoder_direction: i8_at(payload, 14),
        force_direction: i8_at(payload, 15),
        pole_pairs: u8_at(payload, 16),
    })
}

pub fn decode_gpio(payload: &[u8]) -> Result<GpioSettings> {
    ensure(payload, 47, "gpio")?;
    let mut pin_mode = [0u8; 10];
    pin_mode.copy_from_slice(&payload[1..11]);
    let mut button_mode = [0u8; 32];
    button_mode.copy_from_slice(&payload[11..43]);
    Ok(GpioSettings {
        extension_mode: u8_at(payload, 0),
        pin_mode,
        button_mode,
        spi_mode: u8_at(payload, 43),
        spi_latch_mode: u8_at(payload, 44),
        spi_latch_delay: u8_at(payload, 45),
        spi_clk_pulse_length: u8_at(payload, 46),
    })
}

pub fn decode_adc(payload: &[u8]) -> Result<AdcSettings> {
    ensure(payload, 24, "adc")?;
    let mut min = [0u16; 3];
    let mut max = [0u16; 3];
    let mut smoothing = [0u8; 3];
    let mut low = [0u8; 3];
    let mut high = [0u8; 3];
    let mut invert = [0u8; 3];
    for i in 0..3 {
        min[i] = u16_at(payload, i * 2);
        max[i] = u16_at(payload, 6 + i * 2);
        smoothing[i] = u8_at(payload, 12 + i);
        low[i] = u8_at(payload, 15 + i);
        high[i] = u8_at(payload, 18 + i);
        invert[i] = u8_at(payload, 21 + i);
    }
    Ok(AdcSettings {
        adc_min_dead_zone: min,
        adc_max_dead_zone: max,
        adc_smoothing: smoothing,
        adc_to_button_low: low,
        adc_to_button_high: high,
        adc_invert: invert,
    })
}

pub fn decode_license(payload: &[u8]) -> Result<LicenseInfo> {
    ensure(payload, 29, "license")?;
    Ok(LicenseInfo {
        release_type: u8_at(payload, 0),
        major: u8_at(payload, 1),
        minor: u8_at(payload, 2),
        patch: u8_at(payload, 3),
        serial_key: [u32_at(payload, 4), u32_at(payload, 8), u32_at(payload, 12)],
        device_id: [
            u32_at(payload, 16),
            u32_at(payload, 20),
            u32_at(payload, 24),
        ],
        is_registered: u8_at(payload, 28) != 0,
    })
}

pub fn encode_effects(settings: &EffectsSettings) -> [u8; PAYLOAD_SIZE] {
    let mut buf = [0u8; PAYLOAD_SIZE];
    put_u16(&mut buf, 0, settings.motion_range);
    put_u16(&mut buf, 2, settings.static_dampening_strength);
    put_u16(&mut buf, 4, settings.soft_stop_dampening_strength);
    buf[6] = settings.total_effect_strength;
    buf[7] = settings.integrated_spring_strength;
    buf[8] = settings.soft_stop_range;
    buf[9] = settings.soft_stop_strength;
    buf[10] = settings.direct_x_constant_direction as u8;
    buf[11] = settings.direct_x_spring_strength;
    buf[12] = settings.direct_x_constant_strength;
    buf[13] = settings.direct_x_periodic_strength;
    put_u16(&mut buf, 14, settings.dynamic_dampening_strength);
    buf
}

pub fn encode_hardware(settings: &HardwareSettings) -> [u8; PAYLOAD_SIZE] {
    let mut buf = [0u8; PAYLOAD_SIZE];
    put_u16(&mut buf, 0, settings.encoder_cpr);
    put_u16(&mut buf, 2, settings.integral_gain);
    buf[4] = settings.proportional_gain;
    buf[5] = settings.force_enabled;
    buf[6] = settings.debug_torque;
    buf[7] = settings.amplifier_gain;
    buf[8] = settings.calibration_magnitude;
    buf[9] = settings.calibration_speed;
    buf[10] = settings.power_limit;
    buf[11] = settings.braking_limit;
    buf[12] = settings.position_smoothing;
    buf[13] = settings.speed_buffer_size;
    buf[14] = settings.encoder_direction as u8;
    buf[15] = settings.force_direction as u8;
    buf[16] = settings.pole_pairs;
    buf
}

pub fn encode_gpio(settings: &GpioSettings) -> [u8; PAYLOAD_SIZE] {
    let mut buf = [0u8; PAYLOAD_SIZE];
    buf[0] = settings.extension_mode;
    buf[1..11].copy_from_slice(&settings.pin_mode);
    buf[11..43].copy_from_slice(&settings.button_mode);
    buf[43] = settings.spi_mode;
    buf[44] = settings.spi_latch_mode;
    buf[45] = settings.spi_latch_delay;
    buf[46] = settings.spi_clk_pulse_length;
    buf
}

pub fn encode_adc(settings: &AdcSettings) -> [u8; PAYLOAD_SIZE] {
    let mut buf = [0u8; PAYLOAD_SIZE];
    for i in 0..3 {
        put_u16(&mut buf, i * 2, settings.adc_min_dead_zone[i]);
        put_u16(&mut buf, 6 + i * 2, settings.adc_max_dead_zone[i]);
        buf[12 + i] = settings.adc_smoothing[i];
        buf[15 + i] = settings.adc_to_button_low[i];
        buf[18 + i] = settings.adc_to_button_high[i];
        buf[21 + i] = settings.adc_invert[i];
    }
    buf
}

pub fn encode_license(license: &LicenseInfo) -> [u8; PAYLOAD_SIZE] {
    let mut buf = [0u8; PAYLOAD_SIZE];
    buf[0] = license.release_type;
    buf[1] = license.major;
    buf[2] = license.minor;
    buf[3] = license.patch;
    put_u32(&mut buf, 4, license.serial_key[0]);
    put_u32(&mut buf, 8, license.serial_key[1]);
    put_u32(&mut buf, 12, license.serial_key[2]);
    put_u32(&mut buf, 16, license.device_id[0]);
    put_u32(&mut buf, 20, license.device_id[1]);
    put_u32(&mut buf, 24, license.device_id[2]);
    buf[28] = if license.is_registered { 1 } else { 0 };
    buf
}

pub fn encode_state(state: &StateRaw) -> [u8; PAYLOAD_SIZE] {
    let mut buf = [0u8; PAYLOAD_SIZE];
    buf[0] = state.release_type;
    buf[1] = state.major;
    buf[2] = state.minor;
    buf[3] = state.patch;
    buf[4] = if state.is_registered { 1 } else { 0 };
    put_i16(&mut buf, 5, state.position);
    put_i16(&mut buf, 7, state.torque);
    buf
}

pub fn encode_all(
    settings: &DeviceSettings,
) -> (
    [u8; PAYLOAD_SIZE],
    [u8; PAYLOAD_SIZE],
    [u8; PAYLOAD_SIZE],
    [u8; PAYLOAD_SIZE],
) {
    (
        encode_effects(&settings.effects),
        encode_hardware(&settings.hardware),
        encode_gpio(&settings.gpio),
        encode_adc(&settings.adc),
    )
}

/// Valor actual de un campo dentro de un payload ya sin report id.
pub fn read_field_value(payload: &[u8], name: &str, index: usize) -> Option<i32> {
    let u8_at = |offset: usize| payload.get(offset).map(|value| *value as i32);
    let i8_at = |offset: usize| payload.get(offset).map(|value| *value as i8 as i32);
    let u16_at = |offset: usize| {
        payload
            .get(offset..offset + 2)
            .and_then(|bytes| <[u8; 2]>::try_from(bytes).ok())
            .map(u16::from_le_bytes)
            .map(|value| value as i32)
    };

    match name {
        // Effects (payload 0x22)
        "motionRange" => u16_at(0),
        "staticDampeningStrength" => u16_at(2),
        "softStopDampeningStrength" => u16_at(4),
        "dynamicDampeningStrength" => u16_at(14),
        "totalEffectStrength" => u8_at(6),
        "integratedSpringStrength" => u8_at(7),
        "softStopRange" => u8_at(8),
        "softStopStrength" => u8_at(9),
        "directXConstantDirection" => i8_at(10),
        "directXSpringStrength" => u8_at(11),
        "directXConstantStrength" => u8_at(12),
        "directXPeriodicStrength" => u8_at(13),

        // Hardware (payload 0x21)
        "encoderCpr" => u16_at(0),
        "integralGain" => u16_at(2),
        "proportionalGain" => u8_at(4),
        "forceEnabled" => u8_at(5),
        "debugTorque" => u8_at(6),
        "amplifierGain" => u8_at(7),
        "calibrationMagnitude" => u8_at(8),
        "calibrationSpeed" => u8_at(9),
        "powerLimit" => u8_at(10),
        "brakingLimit" => u8_at(11),
        "positionSmoothing" => u8_at(12),
        "speedBufferSize" => u8_at(13),
        "encoderDirection" => i8_at(14),
        "forceDirection" => i8_at(15),
        "polePairs" => u8_at(16),

        // GPIO (payload 0xA1)
        "extensionMode" => u8_at(0),
        "pinMode" => u8_at(1 + index),
        "buttonMode" => u8_at(11 + index),
        "spiMode" => u8_at(43),
        "spiLatchMode" => u8_at(44),
        "spiLatchDelay" => u8_at(45),
        "spiClkPulseLength" => u8_at(46),

        // ADC (payload 0xA2)
        "adcMinDeadZone" => u16_at(index * 2),
        "adcMaxDeadZone" => u16_at(6 + index * 2),
        "adcSmoothing" => u8_at(12 + index),
        "adcToButtonLow" => u8_at(15 + index),
        "adcToButtonHigh" => u8_at(18 + index),
        "adcInvert" => u8_at(21 + index),

        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(bytes: &[u8], count: usize) -> String {
        bytes[..count]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<Vec<_>>()
            .join("")
    }

    #[test]
    fn encode_setting_golden_vectors() {
        assert_eq!(hex(&encode_setting(5, 0, FieldType::U16, 900), 6), "a31405008403");
        assert_eq!(hex(&encode_setting(17, 0, FieldType::U8, 80), 5), "a314110050");
        assert_eq!(hex(&encode_setting(22, 0, FieldType::I8, -1), 5), "a3141600ff");
        assert_eq!(hex(&encode_setting(28, 3, FieldType::U8, 2), 5), "a3141c0302");
        assert_eq!(encode_setting(5, 0, FieldType::U16, 900).len(), REPORT_SIZE);
    }

    #[test]
    fn encode_commands_golden_vectors() {
        assert_eq!(hex(&encode_command(CommandName::Save), 5), "a302000000");
        assert_eq!(
            hex(&encode_command(CommandName::ResetCenter), 5),
            "a304000000"
        );
        assert_eq!(hex(&encode_command(CommandName::Reboot), 5), "a301000000");
        assert_eq!(hex(&encode_command(CommandName::Dfu), 5), "a303000000");
        assert_eq!(encode_command(CommandName::Save).len(), REPORT_SIZE);
    }

    #[test]
    fn state_roundtrip() {
        let state = StateRaw {
            release_type: 0,
            major: 26,
            minor: 1,
            patch: 1,
            is_registered: false,
            position: 9999,
            torque: -9999,
        };
        let payload = encode_state(&state);
        assert_eq!(decode_state(&payload).unwrap(), state);
    }

    #[test]
    fn effects_roundtrip_and_fields() {
        let settings = EffectsSettings::default();
        let payload = encode_effects(&settings);
        assert_eq!(decode_effects(&payload).unwrap(), settings);
        assert_eq!(read_field_value(&payload, "motionRange", 0), Some(900));
        assert_eq!(
            read_field_value(&payload, "directXConstantDirection", 0),
            Some(1)
        );
        assert_eq!(
            read_field_value(&payload, "dynamicDampeningStrength", 0),
            Some(0)
        );
    }

    #[test]
    fn hardware_roundtrip_and_fields() {
        let settings = HardwareSettings::default();
        let payload = encode_hardware(&settings);
        assert_eq!(decode_hardware(&payload).unwrap(), settings);
        assert_eq!(read_field_value(&payload, "encoderCpr", 0), Some(4096));
        assert_eq!(read_field_value(&payload, "encoderDirection", 0), Some(1));
    }

    #[test]
    fn gpio_and_adc_roundtrip() {
        let settings = DeviceSettings::default();
        let gpio = encode_gpio(&settings.gpio);
        assert_eq!(decode_gpio(&gpio).unwrap(), settings.gpio);
        assert_eq!(read_field_value(&gpio, "pinMode", 9), Some(0));

        let adc = encode_adc(&settings.adc);
        assert_eq!(decode_adc(&adc).unwrap(), settings.adc);
        assert_eq!(read_field_value(&adc, "adcMaxDeadZone", 2), Some(65535));
        assert_eq!(read_field_value(&adc, "adcToButtonHigh", 0), Some(100));
    }

    #[test]
    fn license_roundtrip() {
        let license = LicenseInfo::default();
        let payload = encode_license(&license);
        assert_eq!(decode_license(&payload).unwrap(), license);
    }

    #[test]
    fn rejects_short_payloads() {
        assert!(decode_effects(&[0u8; 4]).is_err());
        assert!(decode_hardware(&[0u8; 4]).is_err());
        assert!(decode_gpio(&[0u8; 4]).is_err());
        assert!(decode_adc(&[0u8; 4]).is_err());
        assert!(decode_license(&[0u8; 4]).is_err());
    }

    #[test]
    fn decodes_real_wheel_reports() {
        // Datos reales obtenidos con la sonda R0 (firmware 26.1.1 PRO).
        let effects = [
            0x1c, 0x02, 0x0a, 0x00, 0x0f, 0x00, 0x64, 0x00, 0x0a, 0x64, 0xff, 0x64, 0x64, 0x64,
            0x00, 0x00,
        ];
        let decoded = decode_effects(&effects).unwrap();
        assert_eq!(decoded.motion_range, 540);
        assert_eq!(decoded.static_dampening_strength, 10);
        assert_eq!(decoded.soft_stop_dampening_strength, 15);
        assert_eq!(decoded.total_effect_strength, 100);
        assert_eq!(decoded.direct_x_constant_direction, -1);

        let hardware = [
            0x20, 0x4e, 0x4b, 0x00, 0x0f, 0x01, 0x00, 0x00, 0x05, 0x64, 0x28, 0x14, 0x00, 0x02,
            0xff, 0x01, 0x0f,
        ];
        let decoded = decode_hardware(&hardware).unwrap();
        assert_eq!(decoded.encoder_cpr, 20000);
        assert_eq!(decoded.integral_gain, 75);
        assert_eq!(decoded.proportional_gain, 15);
        assert_eq!(decoded.force_enabled, 1);
        assert_eq!(decoded.debug_torque, 0);
        assert_eq!(decoded.calibration_magnitude, 5);
        assert_eq!(decoded.calibration_speed, 100);
        assert_eq!(decoded.power_limit, 40);
        assert_eq!(decoded.braking_limit, 20);
        assert_eq!(decoded.encoder_direction, -1);
        assert_eq!(decoded.force_direction, 1);
        assert_eq!(decoded.pole_pairs, 15);
    }
}
