use std::sync::OnceLock;

use crate::hid::types::{DeviceSettings, FieldDef, LicenseInfo};

const FIELDS_JSON: &str = include_str!("../assets/fields.json");

static FIELDS: OnceLock<Vec<FieldDef>> = OnceLock::new();

pub fn fields() -> &'static [FieldDef] {
    FIELDS.get_or_init(|| {
        serde_json::from_str(FIELDS_JSON).expect("assets/fields.json invalido")
    })
}

pub fn field_by_name(name: &str) -> Option<&'static FieldDef> {
    fields().iter().find(|field| field.name == name)
}

pub fn field_by_id(id: u8) -> Option<&'static FieldDef> {
    fields().iter().find(|field| field.id == id)
}

pub fn resolve_field(reference: &str) -> Option<&'static FieldDef> {
    if let Ok(id) = reference.parse::<u8>() {
        return field_by_id(id);
    }
    field_by_name(reference)
}

pub fn validate_field(def: &FieldDef, value: i32, index: usize) -> Result<(), String> {
    if let Some(length) = def.array_length {
        if index >= length {
            return Err(format!(
                "{}: indice {index} fuera de rango (0..{})",
                def.label,
                length - 1
            ));
        }
    } else if index != 0 {
        return Err(format!("{} no admite indice", def.label));
    }

    if value < def.min || value > def.max {
        return Err(format!(
            "{}: {value} fuera de rango ({}..{})",
            def.label, def.min, def.max
        ));
    }

    if let Some(options) = &def.options {
        if !options.iter().any(|option| option.value == value) {
            return Err(format!("{}: valor no permitido", def.label));
        }
    }
    Ok(())
}

pub fn value_from_settings(settings: &DeviceSettings, name: &str, index: usize) -> Option<i32> {
    let effects = &settings.effects;
    let hardware = &settings.hardware;
    let gpio = &settings.gpio;
    let adc = &settings.adc;

    match name {
        // Effects
        "motionRange" => Some(effects.motion_range as i32),
        "staticDampeningStrength" => Some(effects.static_dampening_strength as i32),
        "softStopDampeningStrength" => Some(effects.soft_stop_dampening_strength as i32),
        "dynamicDampeningStrength" => Some(effects.dynamic_dampening_strength as i32),
        "totalEffectStrength" => Some(effects.total_effect_strength as i32),
        "integratedSpringStrength" => Some(effects.integrated_spring_strength as i32),
        "softStopRange" => Some(effects.soft_stop_range as i32),
        "softStopStrength" => Some(effects.soft_stop_strength as i32),
        "directXConstantDirection" => Some(effects.direct_x_constant_direction as i32),
        "directXSpringStrength" => Some(effects.direct_x_spring_strength as i32),
        "directXConstantStrength" => Some(effects.direct_x_constant_strength as i32),
        "directXPeriodicStrength" => Some(effects.direct_x_periodic_strength as i32),

        // Hardware
        "encoderCpr" => Some(hardware.encoder_cpr as i32),
        "integralGain" => Some(hardware.integral_gain as i32),
        "proportionalGain" => Some(hardware.proportional_gain as i32),
        "forceEnabled" => Some(hardware.force_enabled as i32),
        "debugTorque" => Some(hardware.debug_torque as i32),
        "amplifierGain" => Some(hardware.amplifier_gain as i32),
        "calibrationMagnitude" => Some(hardware.calibration_magnitude as i32),
        "calibrationSpeed" => Some(hardware.calibration_speed as i32),
        "powerLimit" => Some(hardware.power_limit as i32),
        "brakingLimit" => Some(hardware.braking_limit as i32),
        "positionSmoothing" => Some(hardware.position_smoothing as i32),
        "speedBufferSize" => Some(hardware.speed_buffer_size as i32),
        "encoderDirection" => Some(hardware.encoder_direction as i32),
        "forceDirection" => Some(hardware.force_direction as i32),
        "polePairs" => Some(hardware.pole_pairs as i32),

        // GPIO
        "extensionMode" => Some(gpio.extension_mode as i32),
        "pinMode" => gpio.pin_mode.get(index).map(|value| *value as i32),
        "buttonMode" => gpio.button_mode.get(index).map(|value| *value as i32),
        "spiMode" => Some(gpio.spi_mode as i32),
        "spiLatchMode" => Some(gpio.spi_latch_mode as i32),
        "spiLatchDelay" => Some(gpio.spi_latch_delay as i32),
        "spiClkPulseLength" => Some(gpio.spi_clk_pulse_length as i32),

        // ADC
        "adcMinDeadZone" => adc.adc_min_dead_zone.get(index).map(|value| *value as i32),
        "adcMaxDeadZone" => adc.adc_max_dead_zone.get(index).map(|value| *value as i32),
        "adcSmoothing" => adc.adc_smoothing.get(index).map(|value| *value as i32),
        "adcToButtonLow" => adc.adc_to_button_low.get(index).map(|value| *value as i32),
        "adcToButtonHigh" => adc.adc_to_button_high.get(index).map(|value| *value as i32),
        "adcInvert" => adc.adc_invert.get(index).map(|value| *value as i32),

        _ => None,
    }
}

/// Escribe un valor en los ajustes. Devuelve false si el campo no existe,
/// es de solo escritura (misc) o el indice esta fuera de rango.
pub fn with_value(settings: &mut DeviceSettings, name: &str, value: i32, index: usize) -> bool {
    match name {
        // Effects
        "motionRange" => settings.effects.motion_range = value as u16,
        "staticDampeningStrength" => {
            settings.effects.static_dampening_strength = value as u16
        }
        "softStopDampeningStrength" => {
            settings.effects.soft_stop_dampening_strength = value as u16
        }
        "dynamicDampeningStrength" => {
            settings.effects.dynamic_dampening_strength = value as u16
        }
        "totalEffectStrength" => settings.effects.total_effect_strength = value as u8,
        "integratedSpringStrength" => settings.effects.integrated_spring_strength = value as u8,
        "softStopRange" => settings.effects.soft_stop_range = value as u8,
        "softStopStrength" => settings.effects.soft_stop_strength = value as u8,
        "directXConstantDirection" => {
            settings.effects.direct_x_constant_direction = value as i8
        }
        "directXSpringStrength" => settings.effects.direct_x_spring_strength = value as u8,
        "directXConstantStrength" => settings.effects.direct_x_constant_strength = value as u8,
        "directXPeriodicStrength" => settings.effects.direct_x_periodic_strength = value as u8,

        // Hardware
        "encoderCpr" => settings.hardware.encoder_cpr = value as u16,
        "integralGain" => settings.hardware.integral_gain = value as u16,
        "proportionalGain" => settings.hardware.proportional_gain = value as u8,
        "forceEnabled" => settings.hardware.force_enabled = value as u8,
        "debugTorque" => settings.hardware.debug_torque = value as u8,
        "amplifierGain" => settings.hardware.amplifier_gain = value as u8,
        "calibrationMagnitude" => settings.hardware.calibration_magnitude = value as u8,
        "calibrationSpeed" => settings.hardware.calibration_speed = value as u8,
        "powerLimit" => settings.hardware.power_limit = value as u8,
        "brakingLimit" => settings.hardware.braking_limit = value as u8,
        "positionSmoothing" => settings.hardware.position_smoothing = value as u8,
        "speedBufferSize" => settings.hardware.speed_buffer_size = value as u8,
        "encoderDirection" => settings.hardware.encoder_direction = value as i8,
        "forceDirection" => settings.hardware.force_direction = value as i8,
        "polePairs" => settings.hardware.pole_pairs = value as u8,

        // GPIO
        "extensionMode" => settings.gpio.extension_mode = value as u8,
        "pinMode" => {
            let Some(slot) = settings.gpio.pin_mode.get_mut(index) else {
                return false;
            };
            *slot = value as u8;
        }
        "buttonMode" => {
            let Some(slot) = settings.gpio.button_mode.get_mut(index) else {
                return false;
            };
            *slot = value as u8;
        }
        "spiMode" => settings.gpio.spi_mode = value as u8,
        "spiLatchMode" => settings.gpio.spi_latch_mode = value as u8,
        "spiLatchDelay" => settings.gpio.spi_latch_delay = value as u8,
        "spiClkPulseLength" => settings.gpio.spi_clk_pulse_length = value as u8,

        // ADC
        "adcMinDeadZone" => {
            let Some(slot) = settings.adc.adc_min_dead_zone.get_mut(index) else {
                return false;
            };
            *slot = value as u16;
        }
        "adcMaxDeadZone" => {
            let Some(slot) = settings.adc.adc_max_dead_zone.get_mut(index) else {
                return false;
            };
            *slot = value as u16;
        }
        "adcSmoothing" => {
            let Some(slot) = settings.adc.adc_smoothing.get_mut(index) else {
                return false;
            };
            *slot = value as u8;
        }
        "adcToButtonLow" => {
            let Some(slot) = settings.adc.adc_to_button_low.get_mut(index) else {
                return false;
            };
            *slot = value as u8;
        }
        "adcToButtonHigh" => {
            let Some(slot) = settings.adc.adc_to_button_high.get_mut(index) else {
                return false;
            };
            *slot = value as u8;
        }
        "adcInvert" => {
            let Some(slot) = settings.adc.adc_invert.get_mut(index) else {
                return false;
            };
            *slot = value as u8;
        }

        _ => return false,
    }
    true
}

pub fn firmware_at_least(license: Option<&LicenseInfo>, major: u8, minor: u8, patch: u8) -> bool {
    let Some(license) = license else {
        return true;
    };
    let value = license.major as u32 * 10_000 + license.minor as u32 * 100 + license.patch as u32;
    value >= major as u32 * 10_000 + minor as u32 * 100 + patch as u32
}

pub fn is_pro(license: Option<&LicenseInfo>) -> bool {
    license.map(|license| license.is_registered).unwrap_or(false)
}

pub fn check_compatibility(
    name: &str,
    value: i32,
    license: Option<&LicenseInfo>,
) -> Option<String> {
    if name == "motionRange" && value > 1080 && !is_pro(license) {
        return Some("Un recorrido superior a 1080° requiere licencia PRO.".to_string());
    }
    if name == "integratedSpringStrength"
        && value > 0
        && !firmware_at_least(license, 24, 1, 4)
    {
        return Some("El muelle integrado requiere firmware 24.1.4 o superior.".to_string());
    }
    if name == "dynamicDampeningStrength" && value > 0 {
        if !is_pro(license) || !firmware_at_least(license, 24, 1, 5) {
            return Some(
                "La amortiguación dinámica requiere firmware 24.1.5 o superior y licencia PRO."
                    .to_string(),
            );
        }
    }
    None
}
