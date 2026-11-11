/**
 * Finds a neoHub on the local network using its UDP discovery protocol:
 * broadcast "hubseek" to port 19790 and the hub replies with
 * {"ip":"192.168.x.x","device_id":"..."}.
 */

import dgram from 'node:dgram';

export const DISCOVERY_PORT = 19790;

export interface DiscoveredHub {
  ip: string;
  deviceId: string;
}

export function discoverHub(timeoutMs = 5000): Promise<DiscoveredHub | null> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let done = false;
    const finish = (result: DiscoveredHub | null): void => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      socket.close();
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    // The hub does not always answer the first broadcast, so repeat it.
    const probe = (): void => {
      if (!done) {
        socket.send('hubseek', DISCOVERY_PORT, '255.255.255.255');
      }
    };
    let repeat: NodeJS.Timeout | undefined;

    socket.on('error', () => finish(null));
    socket.on('close', () => clearInterval(repeat));
    socket.on('message', (data) => {
      try {
        const reply = JSON.parse(data.toString()) as { ip?: unknown; device_id?: unknown };
        if (typeof reply.ip === 'string') {
          finish({ ip: reply.ip, deviceId: String(reply.device_id ?? '') });
        }
      } catch {
        // Our own broadcast echoing back, or unrelated traffic.
      }
    });
    socket.bind(DISCOVERY_PORT, () => {
      socket.setBroadcast(true);
      probe();
      repeat = setInterval(probe, 1000);
    });
  });
}
