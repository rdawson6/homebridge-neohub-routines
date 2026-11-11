# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-11-11

First version.

### Added

- Homebridge dynamic platform (`NeoHubRoutines`) using the neoHub's local token API (WebSocket over TLS, port 4243).
- A self-resetting HomeKit switch for each routine on the hub; turning it on sends `RUN_RECIPE`.
- Periodic re-read of the routine list, adding and removing switches to match the hub.
- Optional temperature sensor per thermostat zone, from `GET_LIVE_DATA`, with a fault status for offline zones.
- Hub discovery by UDP broadcast when no address is configured.
- Single-connection command queue with a configurable minimum gap between commands, a 15 s reply timeout, and reconnect after a stalled or closed connection.
- Routine exclusion list and `config.schema.json` for the Homebridge UI.

### Notes

- Tested against a neoHub (firmware 2218) with a stand-in for Homebridge: discovery, routine listing, zone temperatures, removal of stale cached accessories, the exclusion list, and the error path for a failed routine.
- Not yet run inside a real Homebridge instance.
