/**
 * NeoHubClient — talks to a second-generation Heatmiser neoHub over its local
 * token API (encrypted WebSocket on port 4243).
 *
 * Hub behaviour this client works around:
 * - The hub uses a self-signed certificate, so certificate checks are disabled.
 *   The connection is still encrypted and the hub only accepts a valid token.
 * - The hub stalls for 40-150 s if it receives several commands in quick
 *   succession, so commands are sent strictly one at a time with a minimum gap.
 * - Command strings must use single-quoted JSON. Standard double-quoted JSON is
 *   rejected with {"error":"Invalid Json"} by some commands (STORE_RECIPE,
 *   STORE_PROFILE2).
 * - The hub sends a non-standard close frame, which `ws` reports as an error.
 *   That is harmless and only causes a reconnect on the next command.
 */

import WebSocket from 'ws';
import type { Logger } from './logger.js';

export const NEOHUB_PORT = 4243;

/** Thrown when the hub answers a command with an error object. */
export class NeoHubCommandError extends Error {}

export interface NeoHubClientOptions {
  host: string;
  token: string;
  log: Logger;
  /** Minimum milliseconds between the end of one command and the start of the next. */
  commandGapMs?: number;
  /** Milliseconds to wait for a reply before giving up on a command. */
  timeoutMs?: number;
}

interface QueuedCommand {
  command: string;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

/**
 * Encode a command object the way the hub expects: JSON with single quotes.
 * Throws if any string value contains a quote character, since the hub has no
 * escape syntax we can rely on for them.
 */
export function encodeCommand(command: Record<string, unknown>): string {
  const json = JSON.stringify(command);
  if (json.includes('\'') || json.includes('\\"')) {
    throw new Error('Names containing quote characters are not supported by the neoHub API');
  }
  return json.replace(/"/g, '\'');
}

export class NeoHubClient {
  private readonly host: string;
  private readonly token: string;
  private readonly log: Logger;
  private readonly commandGapMs: number;
  private readonly timeoutMs: number;

  private socket: WebSocket | null = null;
  private connecting: Promise<WebSocket> | null = null;
  private readonly queue: QueuedCommand[] = [];
  private busy = false;
  private nextCommandId = 1;
  private lastCommandEnd = 0;
  private closed = false;

  constructor(options: NeoHubClientOptions) {
    this.host = options.host;
    this.token = options.token;
    this.log = options.log;
    this.commandGapMs = options.commandGapMs ?? 3000;
    this.timeoutMs = options.timeoutMs ?? 15000;
  }

  /** Queue a command (already encoded) and resolve with the hub's parsed response. */
  send(command: string): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error('Client is closed'));
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ command, resolve, reject });
      void this.drain();
    });
  }

  /** Close the connection and fail any queued commands. */
  close(): void {
    this.closed = true;
    for (const item of this.queue.splice(0)) {
      item.reject(new Error('Client is closed'));
    }
    this.dropSocket();
  }

  // ─── Queue processing ────────────────────────────────────────────────────

  private async drain(): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    try {
      while (this.queue.length > 0 && !this.closed) {
        const wait = this.lastCommandEnd + this.commandGapMs - Date.now();
        if (wait > 0) {
          await delay(wait);
        }
        const item = this.queue.shift()!;
        try {
          item.resolve(await this.execute(item.command));
        } catch (err) {
          item.reject(err instanceof Error ? err : new Error(String(err)));
        } finally {
          this.lastCommandEnd = Date.now();
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private async execute(command: string): Promise<unknown> {
    const socket = await this.connect();
    const commandId = this.nextCommandId++;
    const message = JSON.stringify({
      message_type: 'hm_get_command_queue',
      message: JSON.stringify({
        token: this.token,
        COMMANDS: [{ COMMAND: command, COMMANDID: commandId }],
      }),
    });

    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer);
        socket.off('message', onMessage);
        socket.off('close', onClose);
      };
      const timer = setTimeout(() => {
        cleanup();
        // A stalled hub keeps the socket open but stops answering; start fresh.
        this.dropSocket();
        // The hub silently ignores requests carrying an unknown token, so a
        // timeout is also what a wrong token looks like.
        reject(new Error(
          `No reply from neoHub within ${this.timeoutMs / 1000} s. ` +
          'Check the API token is correct (the hub ignores unknown tokens), or the hub may be busy.',
        ));
      }, this.timeoutMs);
      const onClose = (): void => {
        cleanup();
        reject(new Error('neoHub closed the connection'));
      };
      const onMessage = (data: WebSocket.RawData): void => {
        let reply: { command_id?: number; message_type?: string; response?: string };
        try {
          reply = JSON.parse(data.toString()) as typeof reply;
        } catch {
          return; // Not for us.
        }
        if (reply.command_id !== commandId) {
          if (reply.message_type === 'hm_set_command_response' && reply.command_id === undefined) {
            // Authentication failures arrive without a command id.
            cleanup();
            reject(new NeoHubCommandError(`neoHub rejected the request: ${String(reply.response)}`));
          }
          return;
        }
        cleanup();
        let parsed: unknown = reply.response;
        if (typeof reply.response === 'string') {
          try {
            parsed = JSON.parse(reply.response);
          } catch {
            // Leave as a plain string.
          }
        }
        if (parsed !== null && typeof parsed === 'object' && 'error' in parsed) {
          reject(new NeoHubCommandError(String((parsed as { error: unknown }).error)));
          return;
        }
        resolve(parsed);
      };
      socket.on('message', onMessage);
      socket.on('close', onClose);
      socket.send(message);
    });
  }

  // ─── Connection management ─────────────────────────────────────────────

  private connect(): Promise<WebSocket> {
    if (this.socket !== null && this.socket.readyState === WebSocket.OPEN) {
      return Promise.resolve(this.socket);
    }
    if (this.connecting !== null) {
      return this.connecting;
    }
    this.connecting = new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(`wss://${this.host}:${NEOHUB_PORT}`, {
        rejectUnauthorized: false,
        handshakeTimeout: this.timeoutMs,
      });
      socket.once('open', () => {
        this.socket = socket;
        this.connecting = null;
        this.log.debug(`Connected to neoHub at ${this.host}`);
        resolve(socket);
      });
      socket.on('error', (err) => {
        if (this.connecting !== null && this.socket !== socket) {
          this.connecting = null;
          reject(new Error(`Could not connect to neoHub at ${this.host}: ${err.message}`));
          return;
        }
        // Errors on an open socket (including the hub's malformed close frame).
        this.log.debug(`neoHub connection error: ${err.message}`);
        if (this.socket === socket) {
          this.dropSocket();
        }
      });
      socket.on('close', () => {
        if (this.socket === socket) {
          this.socket = null;
        }
      });
    });
    return this.connecting;
  }

  private dropSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket !== null) {
      socket.removeAllListeners('message');
      socket.terminate();
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
