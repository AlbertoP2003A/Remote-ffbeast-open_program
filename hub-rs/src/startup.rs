//! Arranque automático con Windows mediante HKCU\...\Run (sin administrador).

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const VALUE_NAME: &str = "FFBeastRemote";

pub fn command_line() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|error| error.to_string())?;
    Ok(format!("\"{}\" --autostart", exe.display()))
}

#[cfg(windows)]
pub fn set_enabled(enabled: bool) -> Result<(), String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (run, _) = hkcu
        .create_subkey(RUN_KEY)
        .map_err(|error| error.to_string())?;

    if enabled {
        let command = command_line()?;
        run.set_value(VALUE_NAME, &command)
            .map_err(|error| error.to_string())
    } else {
        match run.delete_value(VALUE_NAME) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

#[cfg(not(windows))]
pub fn set_enabled(_enabled: bool) -> Result<(), String> {
    Ok(())
}

/// Corrige la ruta si el ejecutable registrado ya no existe, o elimina una
/// entrada vieja. Si el valor apunta a otra copia que sigue existiendo, no se
/// toca (evita que abrir la portable cambie el autostart de la instalada).
pub fn sync(enabled: bool) -> Result<(), String> {
    if !enabled {
        return set_enabled(false);
    }

    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let run = match hkcu.open_subkey(RUN_KEY) {
            Ok(key) => key,
            Err(_) => return set_enabled(true),
        };
        let current: String = match run.get_value(VALUE_NAME) {
            Ok(value) => value,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return set_enabled(true);
            }
            Err(error) => return Err(error.to_string()),
        };
        let path = if let Some(rest) = current.strip_prefix('"') {
            rest.split('"').next().unwrap_or("")
        } else {
            current.split(" --").next().unwrap_or("")
        };
        if std::path::Path::new(path).exists() {
            return Ok(());
        }
        set_enabled(true)
    }

    #[cfg(not(windows))]
    {
        Ok(())
    }
}
