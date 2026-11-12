# homebridge-neohub-routines

A Homebridge plugin that runs your Heatmiser neoHub routines from HomeKit, over the hub's local API.

- Each routine in the Neo app appears in HomeKit as a switch. Turning it on runs the routine, and the switch turns itself off again after a second.
- Routines you add or delete in the Neo app appear in or disappear from HomeKit automatically (checked every 10 minutes by default).
- Optionally, each thermostat zone appears as a temperature sensor, so HomeKit automations can react to room temperatures.
- Talks to the hub directly on your network; no Heatmiser cloud account is involved.

Because routines become switches, you can run them from Siri ("turn on Winter Mode"), include them in scenes, and trigger them from HomeKit automations, for example running a boost routine at 16:00 each day.

## Requirements

- A second-generation neoHub (check the sticker on the back). The plugin uses the token API on port 4243.
- An API token, created in the Neo app under Settings > API.
- Node.js 20 or newer and Homebridge 1.8.0 or newer.

## Installation

```bash
npm install -g homebridge-neohub-routines
```

## Configuration

```json
{
  "platforms": [
    {
      "platform": "NeoHubRoutines",
      "token": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "host": "192.168.1.50"
    }
  ]
}
```

| Setting | Default | Description |
|---|---|---|
| `token` | (required) | API token from the Neo app. |
| `host` | (discover) | Hub IP address. If empty, the plugin finds the hub with a network broadcast at startup. Setting a fixed address (with a DHCP reservation on your router) is more reliable. |
| `zoneSensors` | `true` | Add a temperature sensor per thermostat zone. |
| `excludeRoutines` | `[]` | Routine names to keep out of HomeKit. |
| `routineRefreshMinutes` | `10` | How often to re-read the routine list. |
| `temperatureRefreshSeconds` | `120` | How often to read zone temperatures. The hub itself only updates them about every 90 seconds. |
| `commandGapSeconds` | `3` | Minimum gap between commands sent to the hub. |

## Notes on the neoHub

- **The hub is easily overwhelmed.** It stops responding for a minute or two if it receives several commands within a few seconds. The plugin sends one command at a time with a gap between them, so tapping several routine switches quickly queues them rather than sending them together.
- **One local client at a time works best.** Running this plugin alongside another local integration (Home Assistant, another Homebridge neoHub plugin) can cause timeouts.
- **A wrong token looks like a timeout.** The hub ignores requests with an unknown token instead of rejecting them. If the log shows "No reply from neoHub", check the token first.
- **Routines are matched by name.** Renaming a routine in the Neo app removes the old switch and adds a new one, so any HomeKit scenes or automations using it need updating.

## Creating routines

Create routines in the Neo app. The hub also accepts routines created through its API (`STORE_RECIPE`), but the app only displays them if each command names its zones directly, as the app's own routines do, for example:

```
{'STORE_RECIPE':['Summer Lounge Boost',['{\"HOLD\":[{\"temp\":20.5,\"id\":\"cmd\",\"hours\":5,\"minutes\":30},[\"Summer Lounge\"]]}']]}
```

Routines can contain any hub command, including `RUN_PROFILE_ID` to switch zones to a different schedule.

## Credits

**neoHub API**
Documented by Heatmiser in the *neoHub API* guide (Rev 3.02), shared on the [Heatmiser Developer Portal](https://dev.heatmiser.com). Members of the portal's forum reported the hub's command rate limits.

**Starting point**
[homebridge-heatmiser-smartstat](https://gitlab.com/sedov.nz/homebridge-heatmiser-smartstat) by Aleksandr Sedov showed that neoHub commands could be sent from Homebridge. This plugin uses the hub's local API instead of the cloud service that plugin relies on, and shares no code with it.

**Built with Kiro AI**
This plugin was designed and built with [Kiro](https://kiro.dev), an AI-powered development environment. Kiro found the hub on the network, tested each routine and schedule command against the live hub, worked out the quoting and routine formats the hub and the Neo app actually accept, and verified the plugin against the hub before release.

---

## Licence

MIT
