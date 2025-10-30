# node-red-contrib-nordpool-chargecheap

A Node-RED node for analyzing Nordpool electricity prices and automatically selecting the cheapest (or most expensive) time periods for charging, discharging, load shifting or other automation purposes.

---

## ✅ Key Features

- Selects the **cheapest** or **most expensive** price intervals within a configurable time window.
- Two selection strategies:
  - **Discrete selection**: pick the N best (cheap) or worst (expensive) intervals.
  - **Contiguous block mode**: find one continuous block of length N with lowest (cheap) or highest (expensive) average price.
- Supports **overnight windows** (start > stop) and **rolling 24h mode** (start == stop).
- Rolling 24h mode provides a dynamic 24h window anchored to the most recent occurrence of the chosen start hour.
- **Home Assistant integration** via service-style payload (e.g. `input_number.set_value`).
- Dynamic runtime override via incoming `msg.start`, `msg.stop`, `msg.count`.
- Automatic unit normalization (Öre / SEK / EUR → Öre).
- **HA override (`msg.ha_enable="off"`)** keeps calculating selection but sends a fixed fallback (`force_value`) to HA.
- Full context reset using `msg.reset`.
- Detects interval length (15 / 30 / 60 minutes or other).
- Rich diagnostic attributes (block averages, reference thresholds, data completeness).
- Inverted mode for high-price alerting or battery discharge strategy.
- Additional semantic attributes clarifying override mode, selection purpose and next effective reference.
- **Slot alignment logic:** If you select e.g. `start=23`, `stop=0` with 15-minute slots, you will get the slots starting at 23:00, 23:15, 23:30, and 23:45 (not slots starting at 00:00 or later). This ensures interval selection is intuitive and matches human expectations.

---

## 🧠 Selection Logic Summary

| Mode | What is selected | `reference_price` meaning | `reference_price_role` |
|------|------------------|---------------------------|------------------------|
| Cheap (default) | Lowest priced intervals | Highest price among selected cheap intervals (upper cheap boundary) | `upper_bound_for_charging` |
| Expensive (invert) | Highest priced intervals | Lowest price among selected expensive intervals (lower expensive boundary) | `lower_bound_for_discharging` |

Why this reference logic?  
- In cheap mode, the selected cheap set forms a “price corridor” ≤ `reference_price`. The reference becomes a ceiling you still accept for charging.  
- In expensive mode, the selected expensive set forms a corridor ≥ `reference_price`. The reference becomes a floor beyond which discharging / shedding may occur.  

You also get `reference_price_numeric` (pure number) and `reference_price_effective` (null during HA override).  
In contiguous block mode the node finds the single block (length = `count`) with:
- Lowest average (cheap mode)
- Highest average (expensive mode)

---

## 🔄 Rolling 24h vs Normal Periods

- **Normal period (start != stop)**:
  - If `start < stop`: same-day window (e.g. 07→15).
  - If `start > stop`: overnight window crossing midnight (e.g. 22→06).
- **Rolling 24h (start == stop)**:
  - A 24h dynamic span beginning at the most recent occurrence of that hour.
  - If current time is earlier than the start hour, the window anchors to yesterday’s occurrence.
  - Example: At 21:30 with start=16 (rolling) → window = today 16:00 → tomorrow 15:59:59.
  - Attribute: `rolling_24h = on`.

---

## ⚙️ Node Configuration (Editor Fields)

| Field | Description |
|-------|-------------|
| Name | Display name for the node |
| Start hour | Start of selection window (0–23) |
| Stop hour | End of selection window (0–23); if same as start → rolling 24h |
| Count | Number of intervals to select (N price slots) |
| Invert selection | Choose expensive instead of cheap intervals |
| Contiguous block mode | Select one continuous block instead of distinct intervals |
| Payload ON | Output 1 payload when current time is inside a selected slot |
| Payload OFF | Output 2 payload when outside/idle |
| Force value outside period | Value pushed to HA when not active or under override |
| Home Assistant entity | HA entity ID (e.g. `input_number.elpris`) |
| Debug | Enables verbose node.debug logs |

---

## 🔌 Outputs (4)

| Output | Purpose | Example Payload |
|--------|---------|-----------------|
| 1 | Active slot indicator (ON) | `"on"` (configurable) |
| 2 | Inactive indicator (OFF) | `"off"` (configurable) |
| 3 | State + attributes object | `{ "state": 153.22, "attributes": { ... } }` |
| 4 | Home Assistant service message (optional) | `{ "action": "input_number.set_value", "data": { "entity_id": "input_number.elpris", "value": 153.22 } }` |

If HA override (`msg.ha_enable="off"`) is active, output 4 sends the configured `force_value` instead of `reference_price`.

---

## 💬 Runtime Inputs

| Property | Type | Description |
|----------|------|-------------|
| `msg.data` | object | Nordpool data wrapper (see format below) |
| `msg.start` | number/string | Override start hour (0–23) |
| `msg.stop` | number/string | Override stop hour (0–23) |
| `msg.count` | number/string | Override count (number of intervals) |
| `msg.ha_enable` | string | `"on"` (normal) or `"off"` (HA override) |
| `msg.reset` | any | Full reset of internal context |

Example injection:
```json
{
  "start": 22,
  "stop": 6,
  "count": 8,
  "ha_enable": "on",
  "data": {
    "attributes": {
      "raw_today": [
        { "start": "2025-10-28T00:00:00+01:00", "value": 94.35 },
        { "start": "2025-10-28T00:15:00+01:00", "value": 92.12 }
      ],
      "raw_tomorrow": [
        { "start": "2025-10-29T00:00:00+01:00", "value": 101.44 }
      ],
      "unit_of_measurement": "SEK/kWh"
    }
  }
}
```

Reset:
```json
{ "reset": true }
```

Disable HA dynamic updates:
```json
{ "ha_enable": "off" }
```

Re-enable:
```json
{ "ha_enable": "on" }
```

---

## 📦 Expected Nordpool Data Structure

Minimal attributes:
- `raw_today`: Array of objects with `start` and `value` (or `price`).
- Optional `raw_tomorrow`: Same shape.
- `unit_of_measurement`: e.g. `Öre/kWh`, `SEK/kWh`, `EUR/kWh`.
- Optional `price_in_cents: true` (already Öre).
- Deduplication performed on timestamp.

---

## 🧮 Interval Detection

The node infers `interval_minutes` from the smallest positive gap between consecutive timestamps.  
Attributes: `interval_minutes`, `expected_points`, `actual_points`, `missing_points`, and `partial_period` (true if incomplete data).  
If interval ≥ 55 minutes, `count` is capped at 23.

---

## 🔐 Reference Price Semantics (Detailed)

Attributes:
- `reference_price`: Formatted Öre string (e.g. `153.22Öre`).
- `reference_price_numeric`: Pure number (e.g. `153.22`).
- `reference_price_mode`: `cheap_selection_max` or `expensive_selection_min`.
- `reference_price_role`: `upper_bound_for_charging` or `lower_bound_for_discharging`.
- `reference_price_effective`: Equals `reference_price` unless HA override is active (then null).
- `next_reference_when_enabled`: Shows future effective reference during override (HA disabled).

Use cases:
- Charging logic: Activate when current spot price ≤ `reference_price_numeric` (cheap mode).
- Discharging logic: Activate when current spot price ≥ `reference_price_numeric` (expensive mode).

---

## 📊 Attribute Overview (Output 3 payload.attributes)

| Attribute | Meaning |
|-----------|---------|
| `time_01`, `time_02`, ... | Selected intervals (localized time + price) |
| `count` | Number of selected intervals |
| `selection_mode` | `cheap` or `expensive` |
| `selection_strategy` | `discrete_slots` or `contiguous_block` |
| `reference_price` | Threshold string |
| `reference_price_numeric` | Numeric threshold |
| `reference_price_mode` | Semantics of selection boundary |
| `reference_price_role` | Domain-oriented purpose |
| `reference_price_effective` | Null when override active |
| `next_reference_when_enabled` | Future reference if override off later |
| `max_time`, `min_time` | Extremes within selected set |
| `search_period` | Localized start → end label |
| `data_source` | Merged sets used (e.g. `today + tomorrow`) |
| `interval_minutes` | Detected slot length |
| `contiguous_mode` | `on` / `off` |
| `rolling_24h` | `on` if rolling 24h logic used |
| `block_mode_start` / `block_mode_stop` | Bounds of contiguous block |
| `block_mode_average` | Average price of block |
| `total_hours_span` | Duration of evaluated window |
| `expected_points` / `actual_points` | Diagnostics |
| `missing_points` | Count of missing slots |
| `partial_period` | True if incomplete data |
| `single_selection` | True if only one slot selected |
| `ha_override` | `on` if HA override active |
| `control_mode` | `override` or `normal` |
| `ha_sent_value` | Value pushed to HA entity this cycle |
| `calculated_at` | ISO timestamp of calculation |
| `slot_alignment` | First/last selected slot time |

---

## 🏠 Home Assistant Integration

If `ha_entity` is set (e.g. `input_number.elpris`), output 4 sends service-style payloads:

Active slot:
```json
{
  "action": "input_number.set_value",
  "data": { "entity_id": "input_number.elpris", "value": 153.42 }
}
```

Outside slot OR override:
```json
{
  "action": "input_number.set_value",
  "data": { "entity_id": "input_number.elpris", "value": -600 }
}
```

Disable dynamic updates (override battery logic but still preview future reference):
```json
{ "ha_enable": "off" }
```

Re-enable:
```json
{ "ha_enable": "on" }
```

During override:
- `ha_override = on`
- `reference_price_effective = null`
- `next_reference_when_enabled` shows what would be used if re-enabled now.

---

## 🔁 Reset Behavior

Sending any truthy `msg.reset`:
- Clears stored data (`today_data`, `yesterday_data`, `tomorrow_data`)
- Clears selection parameters (`start_time`, `stop_time`, `count_hour`)
- Clears `ha_enabled`
- Emits status “Full context reset”

Example:
```json
{ "reset": true }
```

---

## 🔌 Example Battery Use Case

Cheap mode:
- Select e.g. 12 cheapest 15-min slots (3h total) in evening for charging.
- Use Output 1 to turn charger relay ON only when active slot.
- Use `reference_price_numeric` in HA automation to decide dynamic pre-charging threshold.

Expensive mode:
- Invert selection to mark high-price windows.
- Use Output 1 to trigger battery discharge or load shedding when inside expensive window.

Override:
- Temporarily force HA entity to a known fallback (e.g. -600) while still previewing future thresholds.

---

## 🧪 Example Flow Outline

1. Nordpool upstream node fetches raw_today/raw_tomorrow.
2. Function/Change nodes send dynamic overrides (`msg.count`, `msg.start`, `msg.stop`).
3. This node calculates selection and outputs:
   - Output 1 → charger control
   - Output 2 → fallback/off
   - Output 3 → attributes for dashboards / DB
   - Output 4 → HA reference value injection
4. Optional UI to toggle `ha_enable`.

---

## 🚀 Installation

From Node-RED editor:
1. Menu → Manage palette → Install
2. Search: `node-red-contrib-nordpool-chargecheap`

Or via npm in Node-RED user directory:
```bash
npm install node-red-contrib-nordpool-chargecheap
```
Restart Node-RED if needed.

---

## ⚠️ Notes & Edge Cases

- Missing tomorrow data → `partial_period: true`.
- Rolling 24h mode may show partial data until future hours arrive.
- `count` auto-clamped if more than available intervals.
- Large gaps or malformed timestamps are ignored after dedupe.
- Interval detection outside 15/30/60 still supported (custom sources).
- **Slot alignment**: If your selection window does not align with slot boundaries, the node will include all slots starting at or after the start time and strictly before the stop time. For example, with 15-minute slots and start=23, stop=0, the slots chosen will be 23:00, 23:15, 23:30, and 23:45.

---

## 🐞 Troubleshooting

| Symptom | Possible Cause | Fix |
|---------|----------------|-----|
| `Waiting for Nordpool data` | `raw_today` empty | Check upstream feed |
| `partial_period` true | Incomplete tomorrow data | Wait for publication |
| Unexpected `reference_price_effective = null` | HA override active | Send `{"ha_enable":"on"}` |
| Charger not turning on | Not in active selected slot | Inspect `time_XX` + system clock |
| Price mismatch | Unit conversion discrepancy | Verify `unit_of_measurement` |
| Selection seems to shift during day | New tomorrow data appended | Consider lock logic (future enhancement) |
| Unexpected slot times | Selection window does not align with slot boundaries | Adjust your start/stop times to match slot intervals (e.g., use start=23:00 if slots start at 23:00) |

---

## 📝 License & Contributions

Open to:
- Performance improvements
- New selection heuristics
- HA-specific enhancements

(Insert license statement here, e.g. MIT.)

---

## 🖼 Screenshots

<img width="937" height="758" alt="Screenshot 2025-10-29 at 21 10 16" src="https://github.com/user-attachments/assets/047c7570-3bff-45c2-bd7b-a1867abb6c98" />

<img width="488" height="840" alt="Screenshot 2025-10-29 at 21 12 33" src="https://github.com/user-attachments/assets/785defa5-7bec-46d8-9e4d-3bf7dbed92f9" />

<img width="550" height="684" alt="Screenshot 2025-10-29 at 21 12 49" src="https://github.com/user-attachments/assets/36480c6c-d880-403a-b50f-5ead9efb36f4" />

---

## 🔄 Quick Reference Cheat Sheet

| Task | Payload |
|------|---------|
| Override window | `{ "start": 7, "stop": 23 }` |
| Change count | `{ "count": 12 }` |
| Enable HA | `{ "ha_enable": "on" }` |
| Disable HA | `{ "ha_enable": "off" }` |
| Full reset | `{ "reset": true }` |
| Switch to expensive mode | Toggle invert selection in node config |
| Rolling 24h mode | Set start == stop (e.g. both 16) |

---

## 📘 Suggested HA Automations (Example)

Cheap mode charge trigger:
```yaml
alias: Charge when cheap slot active
trigger:
  - platform: state
    entity_id: sensor.nordpool_chargecheap_active   # If you map output 1 → on/off helper
condition:
  - condition: template
    value_template: "{{ state_attr('sensor.nordpool_chargecheap','selection_mode') == 'cheap' }}"
action:
  - service: switch.turn_on
    target: { entity_id: switch.charger }
```

Expensive mode discharge trigger:
```yaml
alias: Discharge when expensive slot active
trigger:
  - platform: state
    entity_id: sensor.nordpool_chargecheap_active
condition:
  - condition: template
    value_template: "{{ state_attr('sensor.nordpool_chargecheap','selection_mode') == 'expensive' }}"
action:
  - service: switch.turn_on
    target: { entity_id: switch.discharge_relay }
```

Override awareness:
```yaml
alias: Notify HA override
trigger:
  - platform: state
    entity_id: sensor.nordpool_chargecheap
condition:
  - condition: template
    value_template: "{{ state_attr('sensor.nordpool_chargecheap','ha_override') == 'on' }}"
action:
  - service: persistent_notification.create
    data:
      title: "Nordpool Override Active"
      message: >
        Dynamic pricing paused. Future reference would be:
        {{ state_attr('sensor.nordpool_chargecheap','next_reference_when_enabled') }} Öre.
```

---

## ℹ️ Versioning Notes

If you upgrade from an earlier version:
- New attributes (`reference_price_role`, `reference_price_numeric`, override diagnostics) are additive.
- No breaking changes in output ordering or fundamental logic.

---

Enjoy smarter price-based automation! Contributions and suggestions are welcome.
