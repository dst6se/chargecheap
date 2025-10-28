# ⚡ Nordpool ChargeCheap (Node-RED Custom Node)

A Node-RED node that analyzes Nordpool electricity prices and selects the cheapest (or most expensive, if inverted) time periods within a defined window.

---

## ✨ Features

- 🕓 Supports **start**, **stop**, and **count** windows (in 15-minute steps)  
- 🔁 Optional **invert mode** → select most expensive periods  
- 🔗 Optional **contiguous block mode** → find one continuous cheap block  
- 🏠 Home Assistant integration via entity and `ha_enable` control  
- 💬 4 separate outputs for clear flow design  
- 🧠 Context storage for today / tomorrow data  
- 🌙 Handles overnight periods (start > stop)  
- 📊 MQTT-friendly JSON payload on output 3  

---

## 🔌 Outputs

| Output | Description |
|:-------|:-------------|
| **1** | “ON” payload (`msg.payload = payload_on`) |
| **2** | “OFF” payload (`msg.payload = payload_off`) |
| **3** | **JSON status** object → contains analysis result and current state. <br>Perfect for use with MQTT sensors in Home Assistant (`sensor.nordpool_chargecheap_status`). |
| **4** | Home Assistant command object (`input_number.set_value` action) <br>Used to update an entity with current or forced value. |

---

## 📥 Inputs (`msg`)

| Property | Type | Description |
|:----------|:-----|:------------|
| **msg.data** | object | Nordpool data object with `attributes.raw_today` and `attributes.raw_tomorrow`. <br>Fully compatible with Home Assistant’s Nordpool sensor (`event_data.data`). |
| **msg.start** | number / string | Start hour (0–23). Overrides node config. |
| **msg.stop** | number / string | Stop hour (0–23). Overrides node config. |
| **msg.count** | number / string | Number of 15-minute intervals to select (1 = 15 min, 4 = 1 hour). |
| **msg.ha_enable** | `"on"` / `"off"` | Enables or disables Home Assistant integration. <br>When `"off"`, sends only to output 4 with `force_value` and shows “HA disabled (manual override)”. |
| **msg.reset** | any | Clears stored context (today/tomorrow data). Node reports “Context reset”. |

---

## 🏡 Home Assistant Integration

This node works directly with Home Assistant’s **Nordpool integration**.

You can connect a Home Assistant event node and send its `event_data.data` output directly into this node.  

### Example Input

```json
{
  "data": {
    "attributes": {
      "raw_today": [
        { "start": "2025-10-28T00:00:00+01:00", "value": 0.72 },
        { "start": "2025-10-28T01:00:00+01:00", "value": 0.69 }
      ],
      "raw_tomorrow": [
        { "start": "2025-10-29T00:00:00+01:00", "value": 0.81 }
      ],
      "unit_of_measurement": "SEK/kWh",
      "region": "SE3"
    }
  }
}
