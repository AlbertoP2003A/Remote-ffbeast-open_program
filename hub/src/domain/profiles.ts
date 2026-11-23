import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DeviceSettings, Profile, ProfilesFile } from "../hid/types.js";
import type { Logger } from "../log.js";
import { HttpError } from "../errors.js";

const FILE_VERSION = 1;

export class ProfileStore {
  private readonly file: string;
  private profiles: Profile[] = [];
  private readonly log: Logger;

  constructor(dir: string, log: Logger) {
    this.file = path.join(dir, "profiles.json");
    this.log = log.child("profiles");
    this.load();
  }

  list(): Profile[] {
    return this.profiles.map((profile) => structuredClone(profile));
  }

  get(id: string): Profile | undefined {
    const profile = this.profiles.find((item) => item.id === id);
    return profile ? structuredClone(profile) : undefined;
  }

  create(name: string, deviceSettings: DeviceSettings): Profile {
    const clean = name.trim();
    if (clean.length < 1 || clean.length > 60) {
      throw new HttpError(422, "El nombre debe tener entre 1 y 60 caracteres", "invalid_name");
    }
    const profile: Profile = {
      id: crypto.randomUUID(),
      name: clean,
      createdAt: new Date().toISOString(),
      deviceSettings: structuredClone(deviceSettings),
    };
    this.profiles = [profile, ...this.profiles];
    this.save();
    return structuredClone(profile);
  }

  delete(id: string): boolean {
    const before = this.profiles.length;
    this.profiles = this.profiles.filter((profile) => profile.id !== id);
    if (this.profiles.length === before) return false;
    this.save();
    return true;
  }

  exportAll(): ProfilesFile {
    return { version: FILE_VERSION, profiles: this.list() };
  }

  importAll(data: unknown): number {
    if (!isProfilesFile(data)) {
      throw new HttpError(422, "Formato de perfiles invalido", "invalid_profiles");
    }
    const incoming = data.profiles.map((profile) => ({
      ...profile,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    }));
    this.profiles = [...incoming, ...this.profiles];
    this.save();
    return incoming.length;
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.file)) return;
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as unknown;
      if (isProfilesFile(parsed)) this.profiles = parsed.profiles;
    } catch (error) {
      this.log.warn("No se pudo leer profiles.json; se empieza vacio", error);
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(
        tmp,
        `${JSON.stringify(this.exportAll(), null, 2)}\n`,
        "utf8",
      );
      fs.renameSync(tmp, this.file);
    } catch (error) {
      this.log.error("No se pudieron guardar los perfiles", error);
      throw new HttpError(500, "No se pudieron guardar los perfiles", "profile_save_failed");
    }
  }
}

function isProfilesFile(value: unknown): value is ProfilesFile {
  if (!value || typeof value !== "object") return false;
  const file = value as Partial<ProfilesFile>;
  if (file.version !== FILE_VERSION || !Array.isArray(file.profiles)) return false;
  return file.profiles.every(
    (profile) =>
      profile &&
      typeof profile === "object" &&
      typeof profile.id === "string" &&
      typeof profile.name === "string" &&
      typeof profile.createdAt === "string" &&
      profile.deviceSettings &&
      typeof profile.deviceSettings === "object",
  );
}
