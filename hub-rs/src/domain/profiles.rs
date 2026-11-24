use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::config::ensure_parent;
use crate::hid::types::DeviceSettings;
use crate::logger::Logger;

const FILE_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub device_settings: DeviceSettings,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfilesFile {
    pub version: u32,
    pub profiles: Vec<Profile>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProfileError {
    InvalidName,
    InvalidProfiles,
    SaveFailed(String),
}

impl fmt::Display for ProfileError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidName => {
                write!(f, "El nombre debe tener entre 1 y 60 caracteres")
            }
            Self::InvalidProfiles => write!(f, "Formato de perfiles inválido"),
            Self::SaveFailed(reason) => write!(f, "No se pudieron guardar los perfiles: {reason}"),
        }
    }
}

impl std::error::Error for ProfileError {}

pub struct ProfileStore {
    file: PathBuf,
    profiles: Vec<Profile>,
    log: Logger,
}

impl ProfileStore {
    pub fn new(dir: &Path, log: Logger) -> Self {
        let file = dir.join("profiles.json");
        let log = log.child("profiles");
        let mut store = Self {
            file,
            profiles: Vec::new(),
            log,
        };
        store.load();
        store
    }

    pub fn list(&self) -> Vec<Profile> {
        self.profiles.clone()
    }

    pub fn get(&self, id: &str) -> Option<Profile> {
        self.profiles
            .iter()
            .find(|profile| profile.id == id)
            .cloned()
    }

    pub fn create(&mut self, name: &str, settings: &DeviceSettings) -> Result<Profile, ProfileError> {
        let clean = name.trim();
        if clean.is_empty() || clean.chars().count() > 60 {
            return Err(ProfileError::InvalidName);
        }
        let profile = Profile {
            id: Uuid::new_v4().to_string(),
            name: clean.to_string(),
            created_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            device_settings: settings.clone(),
        };
        self.profiles.insert(0, profile.clone());
        self.save()?;
        Ok(profile)
    }

    pub fn delete(&mut self, id: &str) -> bool {
        let before = self.profiles.len();
        self.profiles.retain(|profile| profile.id != id);
        if self.profiles.len() == before {
            return false;
        }
        if self.save().is_err() {
            return false;
        }
        true
    }

    pub fn export_all(&self) -> ProfilesFile {
        ProfilesFile {
            version: FILE_VERSION,
            profiles: self.list(),
        }
    }

    pub fn import_all(&mut self, value: serde_json::Value) -> Result<usize, ProfileError> {
        let incoming: ProfilesFile =
            serde_json::from_value(value).map_err(|_| ProfileError::InvalidProfiles)?;
        if incoming.version != FILE_VERSION {
            return Err(ProfileError::InvalidProfiles);
        }
        let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
        let imported: Vec<Profile> = incoming
            .profiles
            .into_iter()
            .map(|profile| Profile {
                id: Uuid::new_v4().to_string(),
                name: profile.name,
                created_at: now.clone(),
                device_settings: profile.device_settings,
            })
            .collect();
        let count = imported.len();
        self.profiles = imported.into_iter().chain(self.profiles.drain(..)).collect();
        self.save()?;
        Ok(count)
    }

    fn load(&mut self) {
        let Ok(text) = fs::read_to_string(&self.file) else {
            return;
        };
        match serde_json::from_str::<ProfilesFile>(&text) {
            Ok(file) if file.version == FILE_VERSION => self.profiles = file.profiles,
            _ => self
                .log
                .warn("No se pudo leer profiles.json; se empieza vacío"),
        }
    }

    fn save(&self) -> Result<(), ProfileError> {
        if let Err(error) = ensure_parent(&self.file) {
            self.log
                .error(format!("No se pudo crear la carpeta de perfiles: {error}"));
            return Err(ProfileError::SaveFailed(error.to_string()));
        }
        let text = format!(
            "{}\n",
            serde_json::to_string_pretty(&self.export_all())
                .map_err(|error| ProfileError::SaveFailed(error.to_string()))?
        );
        let tmp = self.file.with_extension("json.tmp");
        if let Err(error) = fs::write(&tmp, text).and_then(|_| fs::rename(&tmp, &self.file)) {
            self.log
                .error(format!("No se pudieron guardar los perfiles: {error}"));
            return Err(ProfileError::SaveFailed(error.to_string()));
        }
        Ok(())
    }
}
