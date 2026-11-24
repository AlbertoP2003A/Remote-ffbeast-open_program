use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::hid::types::ConflictInfo;
use crate::logger::Logger;

pub fn parse_tasklist(output: &str) -> Vec<String> {
    let mut names = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix('"') {
            if let Some(end) = rest.find('"') {
                names.push(rest[..end].to_string());
            }
        }
    }
    names
}

pub fn normalize_process_name(name: &str) -> String {
    let lower = name.trim().to_ascii_lowercase();
    let base = lower.strip_suffix(".exe").unwrap_or(&lower);
    base.chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect()
}

pub fn process_matches(candidate: &str, target: &str) -> bool {
    let left = normalize_process_name(candidate);
    let right = normalize_process_name(target);
    if left.is_empty() || right.is_empty() {
        return false;
    }
    left == right || left.ends_with(&right) || right.ends_with(&left)
}

fn list_windows_processes() -> Vec<String> {
    let output = crate::platform::hidden_command("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .output();
    match output {
        Ok(output) if output.status.success() => {
            parse_tasklist(&String::from_utf8_lossy(&output.stdout))
        }
        _ => Vec::new(),
    }
}

#[derive(Clone)]
pub struct ConflictMonitor {
    inner: Arc<Mutex<ConflictInfo>>,
    processes: Vec<String>,
    log: Logger,
}

impl ConflictMonitor {
    pub fn new(processes: Vec<String>, log: Logger) -> Self {
        Self {
            inner: Arc::new(Mutex::new(ConflictInfo::default())),
            processes,
            log: log.child("conflict"),
        }
    }

    pub fn start(&self) {
        if self.processes.is_empty() {
            return;
        }
        let inner = Arc::clone(&self.inner);
        let processes = self.processes.clone();
        let log = self.log.clone();
        thread::spawn(move || loop {
            let names = list_windows_processes();
            let found = names.iter().find(|name| {
                processes
                    .iter()
                    .any(|target| process_matches(name, target))
            });
            let next = ConflictInfo {
                active: found.is_some(),
                process: found.cloned(),
                checked_at: Some(now_ms()),
            };
            let changed = {
                let mut current = inner.lock().expect("conflict lock");
                let changed = current.active != next.active || current.process != next.process;
                *current = next.clone();
                changed
            };
            if changed {
                if next.active {
                    log.warn(format!(
                        "Programa en conflicto detectado: {}. Cierra Pit House o este hub.",
                        next.process.as_deref().unwrap_or("desconocido")
                    ));
                } else {
                    log.info("El programa en conflicto ya no está abierto");
                }
            }
            thread::sleep(Duration::from_secs(5));
        });
    }

    pub fn current(&self) -> ConflictInfo {
        self.inner.lock().expect("conflict lock").clone()
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tasklist_csv() {
        let output = "\"PitHouse.exe\",\"1234\",\"Console\",\"1\",\"10.000 K\"\r\n\
                      \"chrome.exe\",\"5678\",\"Console\",\"1\",\"100.000 K\"\r\n";
        assert_eq!(
            parse_tasklist(output),
            vec!["PitHouse.exe".to_string(), "chrome.exe".to_string()]
        );
    }

    #[test]
    fn normalizes_process_names() {
        assert_eq!(normalize_process_name("FFBeast Pit House.exe"), "ffbeastpithouse");
        assert_eq!(normalize_process_name("PitHouse.EXE"), "pithouse");
        assert!(process_matches("FFBeast Pit House.exe", "PitHouse.exe"));
        assert!(!process_matches("notepad.exe", "PitHouse.exe"));
    }
}
