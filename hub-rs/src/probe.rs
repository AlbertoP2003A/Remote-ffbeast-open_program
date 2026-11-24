use std::time::{Duration, Instant};

use ffbeast_hub::hid::{codec, types::*};
use hidapi::HidApi;

const FEATURES: &[(u8, &str)] = &[
    (REPORT_ID_HARDWARE, "hardware"),
    (REPORT_ID_EFFECTS, "effects"),
    (REPORT_ID_GPIO, "gpio"),
    (REPORT_ID_ADC, "adc"),
    (REPORT_ID_LICENSE, "license"),
];

fn hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn decode_feature(name: &str, report_id: u8, payload: &[u8]) {
    let decoded = match report_id {
        REPORT_ID_HARDWARE => codec::decode_hardware(payload).map(|value| format!("{value:#?}")),
        REPORT_ID_EFFECTS => codec::decode_effects(payload).map(|value| format!("{value:#?}")),
        REPORT_ID_GPIO => codec::decode_gpio(payload).map(|value| format!("{value:#?}")),
        REPORT_ID_ADC => codec::decode_adc(payload).map(|value| format!("{value:#?}")),
        REPORT_ID_LICENSE => codec::decode_license(payload).map(|value| format!("{value:#?}")),
        _ => return,
    };
    match decoded {
        Ok(text) => println!("  {text}"),
        Err(error) => eprintln!("  decode {name} fallo: {error}"),
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let api = HidApi::new()?;

    let mut found = 0;
    for info in api.device_list() {
        if info.vendor_id() != USB_VID || info.product_id() != USB_PID {
            continue;
        }
        found += 1;
        println!(
            "device iface={:>2} usage_page=0x{:04X} usage=0x{:04X} product={:?} path={:?}",
            info.interface_number(),
            info.usage_page(),
            info.usage(),
            info.product_string(),
            info.path(),
        );
    }

    if found == 0 {
        eprintln!("No se encontro el FFBeast (VID {USB_VID:04X}:{USB_PID:04X}).");
        return Ok(());
    }

    if let Some(info) = api.device_list().find(|info| {
        info.vendor_id() == USB_VID
            && info.product_id() == USB_PID
            && info.interface_number() == VENDOR_INTERFACE
    }) {
        let device = info.open_device(&api)?;
        println!("Interfaz {VENDOR_INTERFACE} abierta: leyendo feature reports...");

        for (report_id, name) in FEATURES {
            let mut buffer = [0u8; REPORT_SIZE];
            buffer[0] = *report_id;
            match device.get_feature_report(&mut buffer) {
                Ok(length) => {
                    println!(
                        "feature {name:<8} (0x{report_id:02X}) {length:>2} bytes: {}",
                        hex(&buffer[..length])
                    );
                    let payload = codec::payload_from_report(&buffer[..length], *report_id);
                    decode_feature(name, *report_id, payload);
                }
                Err(error) => eprintln!("feature {name} (0x{report_id:02X}) fallo: {error}"),
            }
        }
    }

    if let Some(info) = api.device_list().find(|info| {
        info.vendor_id() == USB_VID
            && info.product_id() == USB_PID
            && info.interface_number() == JOYSTICK_INTERFACE
    }) {
        let device = info.open_device(&api)?;
        println!("Interfaz {JOYSTICK_INTERFACE} abierta: leyendo joystick durante 2 s...");

        let mut buffer = [0u8; 64];
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut reads = 0usize;
        let mut printed = 0usize;

        while Instant::now() < deadline {
            match device.read_timeout(&mut buffer, 200) {
                Ok(0) => {}
                Ok(length) => {
                    reads += 1;
                    if printed < 5 {
                        printed += 1;
                        match codec::decode_joystick(&buffer[..length]) {
                            Ok(axes) => println!(
                                "joystick x={} y={} z={} rx={} ry={} rz={} slider={} dial={} botones={:?}",
                                axes.x,
                                axes.y,
                                axes.z,
                                axes.rx,
                                axes.ry,
                                axes.rz,
                                axes.slider,
                                axes.dial,
                                axes.buttons
                            ),
                            Err(error) => eprintln!("decode joystick fallo: {error}"),
                        }
                    }
                }
                Err(error) => {
                    eprintln!("lectura de joystick fallo: {error}");
                    break;
                }
            }
        }
        println!("reportes de joystick leidos: {reads}");
    }

    Ok(())
}
