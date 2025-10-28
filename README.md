# node-red-contrib-nordpool-chargecheap

A Node-RED node for analyzing Nordpool electricity prices and automatically selecting the cheapest (or most expensive) time periods for charging or automation purposes.

---

## 🌍 Features

- Selects the **cheapest** or **most expensive** time slots within a defined window  
- Supports both **individual selection** and **contiguous block mode**  
- Supports **Home Assistant** integration via `input_number` entity  
- Dynamic configuration via incoming `msg` payloads  
- Smart handling for overnight periods (start > stop)  
- Supports force-value override when outside the active period  
- Optional **manual HA override** with `msg.ha_enable`

---

## ⚙️ Node Configuration

| Field | Description |
|-------|-------------|
| **Name** | Display name for the node |
| **Start hour** | Starting hour (0–23) of the selection window |
| **Stop hour** | Ending hour (0–23) of the selection window |
| **Count** | Number of 15-minute intervals to select (e.g. `4` = 1 hour) |
| **Invert selection** | If checked, selects the *most expensive* periods instead of the cheapest |
| **Contiguous block mode** | If checked, selects one continuous block instead of individual intervals |
| **Payload ON** | Payload sent to output 1 during active (cheap) period |
| **Payload OFF** | Payload sent to output 2 during inactive period |
| **Force value outside period** | Value sent to HA entity when outside the active window |
| **Home Assistant entity** | HA entity ID (e.g. `input_number.elpris`) for price reporting |

---

## 💬 Inputs

The node reacts to several types of input messages:

| Property | Type | Description |
|-----------|------|-------------|
| `msg.data` | object | Expected to contain Nordpool price data, e.g. from `node-red-contrib-nordpool-api` |
| `msg.start` | number | Override start hour (0–23) |
| `msg.stop` | number | Override stop hour (0–23) |
| `msg.count` | number | Override number of intervals |
| `msg.ha_enable` | string | `"on"` → normal mode; `"off"` → HA override active (output 4 only) |
| `msg.reset` | any | Clears all stored context and resets node state |

Example input:
```json
{
  "start": 8,
  "stop": 22,
  "count": 12,
  "ha_enable": "on",
  "data": {
    "attributes": {
      "raw_today": [...],
      "raw_tomorrow": [...],
      "unit_of_measurement": "SEK/kWh"
    }
  }
}

<img width="972" height="705" alt="Screenshot 2025-10-26 at 16 11 16" src="https://github.com/user-attachments/assets/0c212234-0508-4e5e-9f1b-92c298642fbe" />

<img width="469" height="578" alt="Screenshot 2025-10-26 at 16 09 24" src="https://github.com/user-attachments/assets/16784e39-fc4b-4cbe-b3c9-ede6a024961a" />

<img width="429" height="553" alt="Screenshot 2025-10-26 at 16 52 55" src="https://github.com/user-attachments/assets/6c7b9838-ba13-4f00-8def-bb926afb062b" />

<img width="560" height="799" alt="Screenshot 2025-10-26 at 16 55 00" src="https://github.com/user-attachments/assets/8f1b74a1-ef2f-4758-bd1f-0534f6345bbf" />
