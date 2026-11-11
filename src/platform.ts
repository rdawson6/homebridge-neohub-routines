/**
 * NeoHubRoutinesPlatform — Homebridge dynamic platform.
 *
 * - Each routine (recipe) stored on the neoHub appears as a switch. Turning it
 *   on runs the routine with RUN_RECIPE; the switch turns itself off again.
 * - Optionally, each thermostat zone appears as a temperature sensor, for use
 *   in HomeKit automations.
 * - The routine list is re-read periodically, so routines added or deleted in
 *   the Neo app appear in or disappear from HomeKit without a restart.
 */

import { NeoHubClient, encodeCommand } from './neohub-client.js';
import { discoverHub } from './discovery.js';
import { validateConfig, type NeoHubConfig } from './config.js';
import type { Logger } from './logger.js';
import type { HomebridgeApi, PlatformAccessoryLike, PlatformConfigLike, ServiceLike } from './hap-types.js';
import { CATEGORY_SENSOR, CATEGORY_SWITCH } from './hap-types.js';

export const PLUGIN_IDENTIFIER = 'homebridge-neohub-routines';
export const PLATFORM_NAME = 'NeoHubRoutines';

/** How long a routine switch stays on after being tapped. */
const SWITCH_RESET_MS = 1000;

interface ZoneReading {
  name: string;
  temperature: number | null;
  offline: boolean;
}

export class NeoHubRoutinesPlatform {
  private readonly log: Logger;
  private readonly api: HomebridgeApi;
  private readonly rawConfig: PlatformConfigLike;
  private config: NeoHubConfig | null = null;
  private client: NeoHubClient | null = null;

  /** Accessories restored from Homebridge's cache, keyed by UUID. */
  private readonly accessories = new Map<string, PlatformAccessoryLike>();
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly zones = new Map<string, ZoneReading>();

  constructor(log: Logger, config: PlatformConfigLike, api: HomebridgeApi) {
    this.log = log;
    this.rawConfig = config;
    this.api = api;

    this.api.on('didFinishLaunching', () => {
      void this.start();
    });
    this.api.on('shutdown', () => this.stop());
  }

  configureAccessory(accessory: PlatformAccessoryLike): void {
    this.accessories.set(accessory.UUID, accessory);
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  private async start(): Promise<void> {
    const { config, errors } = validateConfig(this.rawConfig);
    for (const error of errors) {
      this.log.error(error);
    }
    if (config === null) {
      return;
    }
    this.config = config;

    let host = config.host;
    if (host === null) {
      this.log.info('No hub address configured; searching the network for a neoHub...');
      const hub = await discoverHub();
      if (hub === null) {
        this.log.error('No neoHub found on the network. Enter the hub\'s IP address in the plugin settings.');
        return;
      }
      host = hub.ip;
      this.log.info(`Found neoHub at ${host}. Consider entering this address in the settings for faster startup.`);
    }

    this.client = new NeoHubClient({ host, token: config.token, log: this.log, commandGapMs: config.commandGapMs });

    // Re-attach handlers to cached accessories straight away so HomeKit
    // requests work even if the first hub read fails.
    for (const accessory of this.accessories.values()) {
      this.attachHandlers(accessory);
    }

    await this.refreshRoutines();
    if (config.zoneSensors) {
      await this.refreshZones();
      this.timers.push(setInterval(() => void this.refreshZones(), config.liveDataRefreshMs));
    } else {
      this.removeAccessories((a) => a.context.kind === 'zone');
    }
    this.timers.push(setInterval(() => void this.refreshRoutines(), config.routineRefreshMs));
  }

  private stop(): void {
    for (const timer of this.timers.splice(0)) {
      clearInterval(timer);
    }
    this.client?.close();
  }

  // ─── Routines ────────────────────────────────────────────────────────────

  private async refreshRoutines(): Promise<void> {
    if (this.client === null || this.config === null) {
      return;
    }
    let names: string[];
    try {
      names = parseRoutineNames(await this.client.send(encodeCommand({ GET_RECIPES: 0 })));
    } catch (err) {
      this.log.warn(`Could not read routines from the neoHub: ${errorMessage(err)}`);
      return;
    }

    const wanted = new Map<string, string>();
    for (const name of names) {
      if (!this.config.excludeRoutines.has(name)) {
        wanted.set(this.api.hap.uuid.generate(`routine:${name}`), name);
      }
    }

    this.removeAccessories((a) => a.context.kind === 'routine' && !wanted.has(a.UUID));

    for (const [uuid, name] of wanted) {
      if (!this.accessories.has(uuid)) {
        const accessory = new this.api.platformAccessory(name, uuid);
        accessory.category = CATEGORY_SWITCH;
        accessory.context = { kind: 'routine', hubName: name };
        this.attachHandlers(accessory);
        this.api.registerPlatformAccessories(PLUGIN_IDENTIFIER, PLATFORM_NAME, [accessory]);
        this.accessories.set(uuid, accessory);
        this.log.info(`Added routine "${name}"`);
      }
    }
  }

  private async runRoutine(name: string, service: ServiceLike): Promise<void> {
    const { On } = this.api.hap.Characteristic;
    setTimeout(() => service.updateCharacteristic(On, false), SWITCH_RESET_MS);
    if (this.client === null) {
      this.log.error(`Cannot run routine "${name}": not connected to a neoHub`);
      return;
    }
    this.log.info(`Running routine "${name}"`);
    try {
      const result = await this.client.send(encodeCommand({ RUN_RECIPE: [name] }));
      this.log.debug(`Routine "${name}": ${JSON.stringify(result)}`);
    } catch (err) {
      this.log.error(`Routine "${name}" failed: ${errorMessage(err)}`);
    }
  }

  // ─── Zones ───────────────────────────────────────────────────────────────

  private async refreshZones(): Promise<void> {
    if (this.client === null) {
      return;
    }
    let readings: ZoneReading[];
    try {
      readings = parseLiveData(await this.client.send(encodeCommand({ GET_LIVE_DATA: 0 })));
    } catch (err) {
      this.log.warn(`Could not read zone temperatures from the neoHub: ${errorMessage(err)}`);
      return;
    }

    const wanted = new Set<string>();
    for (const reading of readings) {
      const uuid = this.api.hap.uuid.generate(`zone:${reading.name}`);
      wanted.add(uuid);
      this.zones.set(reading.name, reading);

      let accessory = this.accessories.get(uuid);
      if (accessory === undefined) {
        accessory = new this.api.platformAccessory(`${reading.name} Temperature`, uuid);
        accessory.category = CATEGORY_SENSOR;
        accessory.context = { kind: 'zone', hubName: reading.name };
        this.attachHandlers(accessory);
        this.api.registerPlatformAccessories(PLUGIN_IDENTIFIER, PLATFORM_NAME, [accessory]);
        this.accessories.set(uuid, accessory);
        this.log.info(`Added temperature sensor for zone "${reading.name}"`);
      }

      const { CurrentTemperature, StatusFault } = this.api.hap.Characteristic;
      const service = accessory.getService(this.api.hap.Service.TemperatureSensor);
      if (service !== undefined) {
        if (reading.temperature !== null) {
          service.updateCharacteristic(CurrentTemperature, reading.temperature);
        }
        service.updateCharacteristic(StatusFault, reading.offline ? 1 : 0);
      }
    }

    this.removeAccessories((a) => a.context.kind === 'zone' && !wanted.has(a.UUID));
  }

  // ─── Accessory wiring ────────────────────────────────────────────────────

  private attachHandlers(accessory: PlatformAccessoryLike): void {
    const { Service, Characteristic } = this.api.hap;
    const name = accessory.context.hubName ?? accessory.displayName;

    const info = accessory.getService(Service.AccessoryInformation) ?? accessory.addService(Service.AccessoryInformation);
    info
      .setCharacteristic(Characteristic.Manufacturer, 'Heatmiser')
      .setCharacteristic(Characteristic.Model, accessory.context.kind === 'zone' ? 'neoStat zone' : 'neoHub routine')
      .setCharacteristic(Characteristic.SerialNumber, accessory.UUID.slice(0, 8));

    if (accessory.context.kind === 'routine') {
      const service = accessory.getService(Service.Switch) ?? accessory.addService(Service.Switch, name);
      service
        .getCharacteristic(Characteristic.On)
        .onGet(() => false)
        .onSet((value) => {
          if (value === true) {
            void this.runRoutine(name, service);
          }
        });
    } else if (accessory.context.kind === 'zone') {
      const service =
        accessory.getService(Service.TemperatureSensor) ?? accessory.addService(Service.TemperatureSensor, accessory.displayName);
      service
        .getCharacteristic(Characteristic.CurrentTemperature)
        .setProps({ minValue: -20, maxValue: 60 })
        .onGet(() => this.zones.get(name)?.temperature ?? 0);
    }
  }

  private removeAccessories(predicate: (accessory: PlatformAccessoryLike) => boolean): void {
    const stale = [...this.accessories.values()].filter(predicate);
    if (stale.length === 0) {
      return;
    }
    for (const accessory of stale) {
      this.accessories.delete(accessory.UUID);
      this.log.info(`Removed "${accessory.displayName}" (no longer on the hub or disabled in settings)`);
    }
    this.api.unregisterPlatformAccessories(PLUGIN_IDENTIFIER, PLATFORM_NAME, stale);
  }
}

// ─── Response parsing ──────────────────────────────────────────────────────

/** GET_RECIPES returns {"result":[[name,[commands],[default devices]?], ...]}. */
export function parseRoutineNames(response: unknown): string[] {
  const result = (response as { result?: unknown } | null)?.result;
  if (!Array.isArray(result)) {
    return [];
  }
  const names = new Set<string>();
  for (const entry of result) {
    if (Array.isArray(entry) && typeof entry[0] === 'string' && entry[0] !== '') {
      names.add(entry[0]);
    }
  }
  return [...names];
}

/** GET_LIVE_DATA returns {"devices":[{ZONE_NAME, ACTUAL_TEMP, THERMOSTAT, OFFLINE, ...}], ...}. */
export function parseLiveData(response: unknown): ZoneReading[] {
  const devices = (response as { devices?: unknown } | null)?.devices;
  if (!Array.isArray(devices)) {
    return [];
  }
  const readings: ZoneReading[] = [];
  for (const device of devices as Record<string, unknown>[]) {
    // Timeclocks, plugs and repeaters have no temperature reading.
    if (device['THERMOSTAT'] !== true || typeof device['ZONE_NAME'] !== 'string') {
      continue;
    }
    const temperature = Number.parseFloat(String(device['ACTUAL_TEMP']));
    readings.push({
      name: device['ZONE_NAME'],
      temperature: Number.isFinite(temperature) ? temperature : null,
      offline: device['OFFLINE'] === true,
    });
  }
  return readings;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
