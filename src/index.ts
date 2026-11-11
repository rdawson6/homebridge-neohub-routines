/**
 * Plugin entry point. Registers the platform under the alias declared in
 * config.schema.json (`NeoHubRoutines`).
 */

import { NeoHubRoutinesPlatform, PLATFORM_NAME } from './platform.js';
import type { HomebridgeApi, PlatformConfigLike } from './hap-types.js';
import type { Logger } from './logger.js';

interface RegistrarApi extends HomebridgeApi {
  registerPlatform(
    platformName: string,
    constructor: new (log: Logger, config: PlatformConfigLike, api: HomebridgeApi) => unknown,
  ): void;
}

export default function initialiser(api: RegistrarApi): void {
  api.registerPlatform(PLATFORM_NAME, NeoHubRoutinesPlatform);
}
