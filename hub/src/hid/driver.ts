import { EventEmitter } from "node:events";
import { FEATURE_REPORT } from "./constants.js";
import {
  decodeAdc,
  decodeEffects,
  decodeHardware,
  decodeGpio,
  decodeLicense,
  decodeState,
  encodeCommand,
  encodeSetting,
  type CommandName,
} from "./codec.js";
import {
  FIELDS,
  readFieldValue,
  resolveField,
  valueFromSettings,
  withValue,
} from "./fields.js";
import type {
  AppConfig,
  DeviceHealth,
  DeviceSettings,
  FieldDef,
  HubStatus,
  LicenseInfo,
  LiveState,
} from "./types.js";
import type { Logger } from "../log.js";
import { HttpError, delay, errorMessage } from "../errors.js";
import { checkField, firmwareString } from "../domain/compatibility.js";
import { VERSION } from "../config.js";
import type { HidTransport, TransportFactory } from "./transport.js";

export interface WheelDeviceOptions {
  factory: TransportFactory;
  config: AppConfig;
  log: Logger;
  reconnectMs?: number;
}

export interface ApplyResult {
  settings: DeviceSettings;
  /** true si algun campo cambiado solo se aplica tras guardar y reiniciar. */
  restartRequired: boolean;
}

const READBACK_DELAY_MS = 6;
const APPLY_DELAY_MS = 3;
const WRITABLE_FIELDS: FieldDef[] = FIELDS.filter((field) => field.group !== "misc");

/**
 * Unico propietario del HID del volante. Emite:
 *  - "connected" | "disconnected"
 *  - "settings" (DeviceSettings)
 *  - "state" (LiveState)
 *  - "license" (LicenseInfo)
 */
export class WheelDevice extends EventEmitter {
  private transport: HidTransport | null = null;
  private timer: NodeJS.Timeout | null = null;
  private connecting = false;
  private stopped = false;
  private quiet = false;
  private queue: Promise<unknown> = Promise.resolve();

  private settings: DeviceSettings | null = null;
  private license: LicenseInfo | null = null;
  private live: LiveState | null = null;
  private path: string | null = null;
  private lastFindError: string | null = null;
  /** La proxima lectura debe comprobar que la fuerza quedo desactivada. */
  private pendingForceCheck = false;
  /** Se activa al pedir la desactivacion y se traslada al soltar el HID. */
  private pendingForceCheckRequested = false;

  private consecutiveFailures = 0;
  private lastError: string | null = null;
  private lastErrorAt: number | null = null;
  private connections = 0;

  constructor(private readonly options: WheelDeviceOptions) {
    super();
    this.setMaxListeners(50);
  }

  get factory(): TransportFactory {
    return this.options.factory;
  }

  get connected(): boolean {
    return this.transport !== null;
  }

  get mock(): boolean {
    return this.options.factory.kind === "mock";
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    void this.tryConnect();
    this.timer = setInterval(() => {
      void this.tryConnect();
    }, this.options.reconnectMs ?? 1500);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.drop("hub detenido");
  }

  health(): DeviceHealth {
    return {
      degraded: this.consecutiveFailures >= 3,
      consecutiveFailures: this.consecutiveFailures,
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt,
      connections: this.connections,
    };
  }

  status(): HubStatus {
    const config = this.options.config;
    return {
      connected: this.connected,
      mock: this.mock,
      firmware: firmwareString(this.license),
      license: this.license,
      readOnly: config.readOnly,
      port: config.port,
      version: VERSION,
      path: this.path,
      position: this.live?.position ?? null,
      torque: this.live?.torque ?? null,
      health: this.health(),
    };
  }

  getSettings(): DeviceSettings | null {
    return this.settings;
  }

  getLicense(): LicenseInfo | null {
    return this.license;
  }

  getLive(): LiveState | null {
    return this.live;
  }

  /** Relee los cuatro bloques + licencia. */
  refreshAll(): Promise<DeviceSettings> {
    return this.enqueue(() => this.refreshAllInternal());
  }

  writeSetting(fieldRef: string | number, value: number, index = 0): Promise<DeviceSettings> {
    return this.enqueue(() => this.writeSettingInternal(fieldRef, value, index));
  }

  /**
   * Aplica un perfil completo. Escribe solo los campos que cambian y verifica
   * con read-back. Devuelve el resultado final leido del volante.
   */
  applyAll(input: Partial<DeviceSettings>): Promise<ApplyResult> {
    return this.enqueue(async () => {
      const base = this.settings;
      if (!base) throw new HttpError(409, "Volante desconectado", "wheel_disconnected");
      const merged = mergeSettings(base, input);

      const errors: Array<{ field: string; index?: number; message: string }> = [];
      let restartRequired = false;
      this.quiet = true;
      try {
        for (const def of WRITABLE_FIELDS) {
          const count = def.arrayLength ?? 1;
          for (let index = 0; index < count; index += 1) {
            const value = valueFromSettings(merged, def.name, index);
            if (value === undefined) continue;
            const current = valueFromSettings(base, def.name, index);
            if (current === value) continue;
            if (def.requiresReboot) restartRequired = true;
            try {
              await this.writeSettingInternal(def.name, value, index, APPLY_DELAY_MS);
            } catch (error) {
              errors.push({
                field: def.name,
                index: def.arrayLength ? index : undefined,
                message: errorMessage(error),
              });
            }
          }
        }
        const finalSettings = restartRequired
          ? (this.settings as DeviceSettings)
          : await this.refreshAllInternal();
        if (errors.length > 0) {
          throw new HttpError(
            409,
            "Algunos ajustes no se aplicaron",
            "apply_failed",
            { errors },
          );
        }
        return { settings: finalSettings, restartRequired };
      } finally {
        this.quiet = false;
        this.emit("settings", this.settings);
      }
    });
  }

  command(name: CommandName): Promise<void> {
    return this.enqueue(() => this.commandInternal(name));
  }

  /**
   * Desactiva la fuerza y encadena guardar + reiniciar en una sola operacion.
   * forceEnabled solo se aplica tras reiniciar, asi que no es un corte
   * instantaneo: la UI debe explicarlo y ofrecer el interruptor fisico como
   * alternativa para una emergencia real.
   */
  disableForces(): Promise<DeviceSettings> {
    return this.enqueue(async () => {
      const config = this.options.config;
      if (config.readOnly) {
        throw new HttpError(403, "Hub en modo solo lectura", "read_only");
      }
      if (!config.allowSaveCommand) {
        throw new HttpError(
          403,
          "El comando guardar esta desactivado: no se puede persistir el cambio",
          "command_disabled",
        );
      }
      const settings = await this.writeSettingInternal(
        "forceEnabled",
        0,
        0,
        APPLY_DELAY_MS,
      );
      this.pendingForceCheckRequested = true;
      try {
        this.commandInternal("save");
      } catch (error) {
        this.pendingForceCheckRequested = false;
        // Si no se pudo guardar, la UI no debe quedarse mostrando "fuerza OFF":
        // releemos el estado real del volante antes de propagar el error.
        try {
          await this.refreshAllInternal();
        } catch {
          // sin lectura, el estado se resolvera al reconectar
        }
        throw error;
      }
      return settings;
    });
  }

  private commandInternal(name: CommandName): void {
    const config = this.options.config;
    if (config.readOnly) {
      throw new HttpError(403, "Hub en modo solo lectura", "read_only");
    }
    const allowed: Record<CommandName, boolean> = {
      "reset-center": true,
      save: config.allowSaveCommand,
      reboot: config.allowRebootCommand,
      dfu: config.allowDfuCommand,
    };
    if (!allowed[name]) {
      throw new HttpError(403, `Comando desactivado: ${name}`, "command_disabled");
    }
    this.assertStable();
    const transport = this.requireTransport();
    try {
      transport.write(encodeCommand(name));
    } catch (error) {
      this.noteFailure(error);
      throw error;
    }
    this.noteSuccess();
    this.options.log.info(`Comando enviado: ${name}`);
    // Guardar, reiniciar y DFU reinician el firmware: soltamos el HID y
    // dejamos que el bucle de reconexion lo recupere.
    if (name !== "reset-center") {
      setTimeout(() => {
        // Solo comprobamos la fuerza cuando el reinicio ya se ha pedido y el
        // HID se va a soltar; asi una lectura intermedia no da un falso aviso.
        if (this.pendingForceCheckRequested) {
          this.pendingForceCheck = true;
          this.pendingForceCheckRequested = false;
        }
        this.drop(`comando ${name}`);
      }, 300);
    }
  }

  // ------------------------------------------------------------------ interno

  private enqueue<T>(task: () => Promise<T> | T): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private noteFailure(error: unknown): void {
    this.consecutiveFailures += 1;
    this.lastError = errorMessage(error);
    this.lastErrorAt = Date.now();
    this.emit("health", this.health());
  }

  private noteSuccess(): void {
    if (this.consecutiveFailures === 0) return;
    this.consecutiveFailures = 0;
    this.emit("health", this.health());
  }

  private assertStable(): void {
    if (this.consecutiveFailures >= 3) {
      throw new HttpError(
        409,
        "Volante inestable: relee los ajustes antes de escribir",
        "wheel_unstable",
      );
    }
  }

  private async tryConnect(): Promise<void> {
    if (this.transport || this.stopped || this.connecting) return;
    this.connecting = true;
    try {
      let info = null;
      try {
        info = this.options.factory.find();
        this.lastFindError = null;
      } catch (error) {
        const message = errorMessage(error);
        if (message !== this.lastFindError) {
          this.lastFindError = message;
          this.options.log.warn(
            "No se pudo enumerar HID (¿falta node-hid?). El hub sigue funcionando.",
            message,
          );
        }
        return;
      }
      if (!info) return;

      const transport = this.options.factory.open(info.path);
      transport.onData((payload) => this.handleState(payload));
      transport.onError((error) => {
        this.options.log.warn("Error de HID", error);
        this.drop(error.message);
      });

      this.transport = transport;
      this.path = info.path;
      this.connections += 1;
      this.options.log.info(`Volante conectado (${this.options.factory.kind})`);
      this.emit("connected");
      await this.refreshAllInternal();
    } catch (error) {
      this.options.log.warn("No se pudo abrir el volante", errorMessage(error));
      this.drop(errorMessage(error));
    } finally {
      this.connecting = false;
    }
  }

  private drop(reason: string): void {
    if (!this.transport) return;
    const transport = this.transport;
    this.transport = null;
    this.path = null;
    try {
      transport.close();
    } catch {
      // ya cerrado
    }
    this.options.log.warn(`Volante desconectado: ${reason}`);
    this.emit("disconnected");
  }

  private requireTransport(): HidTransport {
    if (!this.transport) {
      throw new HttpError(409, "Volante desconectado", "wheel_disconnected");
    }
    return this.transport;
  }

  private readGroup(group: "effects" | "hardware" | "gpio" | "adc"): Buffer {
    return this.requireTransport().getFeatureReport(FEATURE_REPORT[group]);
  }

  private async refreshAllInternal(): Promise<DeviceSettings> {
    let forceStillEnabled = false;
    try {
      const effects = decodeEffects(this.readGroup("effects"));
      const hardware = decodeHardware(this.readGroup("hardware"));
      const gpio = decodeGpio(this.readGroup("gpio"));
      const adc = decodeAdc(this.readGroup("adc"));
      const license = decodeLicense(
        this.requireTransport().getFeatureReport(FEATURE_REPORT.license),
      );

      this.settings = { effects, hardware, gpio, adc };
      this.license = license;
      forceStillEnabled = hardware.forceEnabled === 1;
    } catch (error) {
      this.noteFailure(error);
      throw error;
    }
    this.noteSuccess();

    if (this.pendingForceCheck) {
      this.pendingForceCheck = false;
      this.emit("safety", {
        ok: !forceStillEnabled,
        forceEnabled: forceStillEnabled,
        message: forceStillEnabled
          ? "El volante sigue con la fuerza activada tras el reinicio. Revísalo en Hardware."
          : "Fuerzas desactivadas y verificadas.",
      });
    }

    this.emit("settings", this.settings);
    this.emit("license", this.license);
    return this.settings as DeviceSettings;
  }

  private validate(def: FieldDef, value: number, index: number): void {
    if (!Number.isInteger(value)) {
      throw new HttpError(422, `${def.label}: el valor debe ser entero`, "invalid_value");
    }
    if (def.arrayLength !== undefined) {
      if (!Number.isInteger(index) || index < 0 || index >= def.arrayLength) {
        throw new HttpError(
          422,
          `${def.label}: indice ${index} fuera de rango (0..${def.arrayLength - 1})`,
          "invalid_index",
        );
      }
    } else if (index !== 0) {
      throw new HttpError(422, `${def.label} no admite indice`, "invalid_index");
    }
    if (value < def.min || value > def.max) {
      throw new HttpError(
        422,
        `${def.label}: ${value} fuera de rango (${def.min}..${def.max})`,
        "invalid_value",
      );
    }
    if (def.options && !def.options.some((option) => option.value === value)) {
      throw new HttpError(
        422,
        `${def.label}: valor no permitido (${def.options.map((o) => o.value).join(", ")})`,
        "invalid_value",
      );
    }
  }

  private async writeSettingInternal(
    fieldRef: string | number,
    value: number,
    index = 0,
    postDelay = READBACK_DELAY_MS,
  ): Promise<DeviceSettings> {
    const config = this.options.config;
    if (config.readOnly) {
      throw new HttpError(403, "Hub en modo solo lectura", "read_only");
    }
    const def = resolveField(fieldRef);
    if (!def) {
      throw new HttpError(422, `Campo desconocido: ${String(fieldRef)}`, "unknown_field");
    }
    this.validate(def, value, index);

    const compatibility = checkField(def.name, value, this.license);
    if (compatibility) {
      throw new HttpError(422, compatibility, "unsupported_field", { field: def.name });
    }

    this.assertStable();
    const transport = this.requireTransport();
    try {
      transport.write(encodeSetting(def.id, index, def.type, value));
      await delay(postDelay);

      if (def.readback && !def.requiresReboot) {
        const payload = this.readGroup(
          def.group as "effects" | "hardware" | "gpio" | "adc",
        );
        const actual = readFieldValue(payload, def.name, index);
        if (actual !== value) {
          throw new HttpError(
            409,
            `El volante no aceptó ${def.label} (esperado ${value}, leído ${String(actual)})`,
            "readback_failed",
            { field: def.name, index, expected: value, actual: actual ?? null },
          );
        }
      }
    } catch (error) {
      this.noteFailure(error);
      throw error;
    }
    this.noteSuccess();
    // Los campos con requiresReboot (fuerza, GPIO, reset Z0...) no se aplican
    // hasta guardar y reiniciar; el firmware sigue devolviendo el valor viejo,
    // asi que no tiene sentido hacer read-back aqui. La UI encadena el save.

    if (this.settings && def.group !== "misc") {
      this.settings = withValue(this.settings, def.name, value, index);
      if (!this.quiet) this.emit("settings", this.settings);
    }
    return this.settings as DeviceSettings;
  }

  private handleState(payload: Buffer): void {
    let raw;
    try {
      raw = decodeState(payload);
    } catch (error) {
      this.options.log.debug("Reporte de estado invalido", errorMessage(error));
      return;
    }
    const range = this.settings?.effects.motionRange || 900;
    const live: LiveState = {
      ...raw,
      positionDegrees: (raw.position / 10000) * (range / 2),
      positionPercent: raw.position / 100,
      positionNormalized: raw.position / 10000,
      torqueNormalized: raw.torque / 10000,
      torquePercent: raw.torque / 100,
      timestamp: Date.now(),
    };
    this.live = live;
    this.emit("state", live);
  }
}

function mergeSettings(
  base: DeviceSettings,
  input: Partial<DeviceSettings>,
): DeviceSettings {
  const group = <T extends object>(current: T, patch: unknown): T => {
    if (patch === undefined || patch === null) return current;
    if (typeof patch !== "object" || Array.isArray(patch)) {
      throw new HttpError(400, "Formato de ajustes invalido", "invalid_body");
    }
    return { ...current, ...(patch as T) };
  };
  return {
    effects: group(base.effects, input.effects),
    hardware: group(base.hardware, input.hardware),
    gpio: group(base.gpio, input.gpio),
    adc: group(base.adc, input.adc),
  };
}
