use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use chrono::{SecondsFormat, Utc};

use crate::config::LogLevel;

const MAX_BYTES: u64 = 1_000_000;
const KEEP_FILES: usize = 3;

struct Inner {
    file: PathBuf,
    level: LogLevel,
    console: bool,
    lock: Mutex<()>,
}

#[derive(Clone)]
pub struct Logger {
    inner: Arc<Inner>,
    scope: Arc<str>,
}

impl Logger {
    pub fn new(dir: &Path, level: LogLevel, file: Option<PathBuf>) -> Self {
        Self::new_with_console(dir, level, file, cfg!(debug_assertions))
    }

    pub fn new_with_console(
        dir: &Path,
        level: LogLevel,
        file: Option<PathBuf>,
        console: bool,
    ) -> Self {
        let file = file.unwrap_or_else(|| dir.join("hub.log"));
        if let Some(parent) = file.parent() {
            let _ = fs::create_dir_all(parent);
        }
        Self {
            inner: Arc::new(Inner {
                file,
                level,
                console,
                lock: Mutex::new(()),
            }),
            scope: Arc::from("hub"),
        }
    }

    pub fn child(&self, scope: &str) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
            scope: Arc::from(format!("{}/{}", self.scope, scope)),
        }
    }

    pub fn file(&self) -> &Path {
        &self.inner.file
    }

    pub fn debug(&self, message: impl AsRef<str>) {
        self.write(LogLevel::Debug, message.as_ref());
    }

    pub fn info(&self, message: impl AsRef<str>) {
        self.write(LogLevel::Info, message.as_ref());
    }

    pub fn warn(&self, message: impl AsRef<str>) {
        self.write(LogLevel::Warn, message.as_ref());
    }

    pub fn error(&self, message: impl AsRef<str>) {
        self.write(LogLevel::Error, message.as_ref());
    }

    pub fn recent_lines(&self, count: usize) -> Vec<String> {
        let Ok(text) = fs::read_to_string(&self.inner.file) else {
            return Vec::new();
        };
        let mut lines: Vec<String> = text
            .split('\n')
            .filter(|line| !line.is_empty())
            .map(ToString::to_string)
            .collect();
        let keep = count.min(lines.len());
        lines.split_off(lines.len() - keep)
    }

    fn write(&self, level: LogLevel, message: &str) {
        if level.rank() < self.inner.level.rank() {
            return;
        }
        let line = format!(
            "{} {} {} {}",
            Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            level_name(level),
            self.scope,
            message
        );
        if self.inner.console {
            match level {
                LogLevel::Error => eprintln!("{line}"),
                LogLevel::Warn => eprintln!("{line}"),
                _ => println!("{line}"),
            }
        }

        let _guard = self.inner.lock.lock().ok();
        rotate_if_needed(&self.inner.file);
        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.inner.file)
        {
            let _ = writeln!(file, "{line}");
        }
    }
}

fn level_name(level: LogLevel) -> &'static str {
    match level {
        LogLevel::Debug => "DEBUG",
        LogLevel::Info => "INFO ",
        LogLevel::Warn => "WARN ",
        LogLevel::Error => "ERROR",
    }
}

fn rotate_if_needed(file: &Path) {
    let Ok(meta) = fs::metadata(file) else {
        return;
    };
    if meta.len() < MAX_BYTES {
        return;
    }
    let _ = fs::remove_file(format!("{}.{}", file.display(), KEEP_FILES));
    for index in (1..KEEP_FILES).rev() {
        let from = format!("{}.{}", file.display(), index);
        let to = format!("{}.{}", file.display(), index + 1);
        let _ = fs::rename(from, to);
    }
    let _ = fs::rename(file, format!("{}.1", file.display()));
}
