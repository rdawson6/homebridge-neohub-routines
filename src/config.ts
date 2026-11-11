/**
 * Validates the user's platform config and fills in defaults.
 */

import type { PlatformConfigLike } from './hap-types.js';

export interface NeoHubConfig {
  /** Hub IP address or hostname; null means discover it on the network. */
  host: string | null;
  token: string;
  zoneSensors: boolean;
  /** Routine names (as on the hub) that should not appear in HomeKit. */
  excludeRoutines: Set<string>;
  routineRefreshMs: number;
  liveDataRefreshMs: number;
  commandGapMs: number;
}

export interface ConfigResult {
  config: NeoHubConfig | null;
  errors: string[];
}

const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOST_PATTERN = /^[A-Za-z0-9.-]{1,253}$/;

export function validateConfig(raw: PlatformConfigLike): ConfigResult {
  const errors: string[] = [];

  const token = typeof raw['token'] === 'string' ? raw['token'].trim() : '';
  if (token === '') {
    errors.push('No API token configured. Create one in the Neo app under Settings > API and add it to the plugin settings.');
  } else if (!TOKEN_PATTERN.test(token)) {
    errors.push('The API token does not look like a neoHub token (expected the form xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).');
  }

  let host: string | null = null;
  if (typeof raw['host'] === 'string' && raw['host'].trim() !== '') {
    host = raw['host'].trim();
    if (!HOST_PATTERN.test(host)) {
      errors.push(`Invalid hub address "${host}". Use an IP address such as 192.168.1.50, or leave it empty to find the hub automatically.`);
    }
  }

  const exclude = Array.isArray(raw['excludeRoutines'])
    ? raw['excludeRoutines'].filter((n): n is string => typeof n === 'string' && n.trim() !== '').map((n) => n.trim())
    : [];

  if (errors.length > 0) {
    return { config: null, errors };
  }

  return {
    config: {
      host,
      token,
      zoneSensors: raw['zoneSensors'] !== false,
      excludeRoutines: new Set(exclude),
      routineRefreshMs: clampNumber(raw['routineRefreshMinutes'], 1, 1440, 10) * 60_000,
      liveDataRefreshMs: clampNumber(raw['temperatureRefreshSeconds'], 60, 3600, 120) * 1000,
      commandGapMs: clampNumber(raw['commandGapSeconds'], 1, 30, 3) * 1000,
    },
    errors,
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}
