/**
 * Minimal structural HAP / Homebridge type shims.
 *
 * Importing the `homebridge` package root pulls in its full type graph, which
 * makes `tsc` very slow on some filesystems. The plugin only touches a small
 * surface of the API, so that surface is modelled here. Homebridge's real
 * objects are structurally compatible.
 */

export type CharacteristicValue = string | number | boolean;
export type CharacteristicRef = unknown;
export type ServiceRef = unknown;

export interface CharacteristicLike {
  onSet(handler: (value: CharacteristicValue) => void | Promise<void>): CharacteristicLike;
  onGet(handler: () => CharacteristicValue | Promise<CharacteristicValue>): CharacteristicLike;
  setProps(props: Record<string, unknown>): CharacteristicLike;
}

export interface ServiceLike {
  getCharacteristic(characteristic: CharacteristicRef): CharacteristicLike;
  setCharacteristic(characteristic: CharacteristicRef, value: CharacteristicValue): ServiceLike;
  updateCharacteristic(characteristic: CharacteristicRef, value: CharacteristicValue): ServiceLike;
}

/** Data the plugin stores on each accessory so it survives restarts. */
export interface AccessoryContext {
  kind?: 'routine' | 'zone';
  /** Routine name exactly as stored on the hub, or the zone name. */
  hubName?: string;
}

export interface PlatformAccessoryLike {
  readonly UUID: string;
  displayName: string;
  context: AccessoryContext;
  category?: number;
  getService(service: ServiceRef): ServiceLike | undefined;
  addService(service: ServiceRef, ...args: unknown[]): ServiceLike;
}

export interface PlatformAccessoryConstructor {
  new (displayName: string, uuid: string): PlatformAccessoryLike;
}

export interface HapApi {
  Service: {
    AccessoryInformation: ServiceRef;
    Switch: ServiceRef;
    TemperatureSensor: ServiceRef;
  };
  Characteristic: {
    Manufacturer: CharacteristicRef;
    Model: CharacteristicRef;
    SerialNumber: CharacteristicRef;
    Name: CharacteristicRef;
    On: CharacteristicRef;
    CurrentTemperature: CharacteristicRef;
    StatusActive: CharacteristicRef;
    StatusFault: CharacteristicRef;
  };
  uuid: { generate(data: string): string };
}

export type ApiEventName = 'didFinishLaunching' | 'shutdown';

export interface HomebridgeApi {
  readonly hap: HapApi;
  readonly platformAccessory: PlatformAccessoryConstructor;
  on(event: ApiEventName, listener: () => void): void;
  registerPlatformAccessories(plugin: string, platform: string, accessories: PlatformAccessoryLike[]): void;
  unregisterPlatformAccessories(plugin: string, platform: string, accessories: PlatformAccessoryLike[]): void;
  updatePlatformAccessories(accessories: PlatformAccessoryLike[]): void;
}

export interface PlatformConfigLike {
  [key: string]: unknown;
  platform?: string;
  name?: string;
}

/** HAP accessory categories used by the plugin. */
export const CATEGORY_SWITCH = 8;
export const CATEGORY_SENSOR = 10;
