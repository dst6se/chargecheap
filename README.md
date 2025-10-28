# node-red-contrib-nordpool-chargecheap

A Node-RED node for analyzing Nordpool electricity prices and automatically selecting the cheapest (or most expensive) time periods for charging, load shifting or other automation purposes.

---

## ✅ Key Features

- Selects the **cheapest** or **most expensive** price intervals within a configurable window.
- Supports both:
  - **Discrete selection** (pick N best intervals)
  - **Contiguous block mode** (pick one continuous block of N intervals with lowest/highest average).
- Handles **overnight periods** (start > stop) and **rolling 24h mode** (start == stop).
- Rolling 24h mode (start == stop) gives a dynamic 24h window (e.g. 16:00 → 15:59 next day).
- **Home Assistant integration** via service-style payload (e.g. `input_number.set_value`).
- Dynamic runtime overrides via incoming `msg.start`, `msg.stop`, `msg.count`.
- Automatic unit normalization (Öre/SEK/EUR → Öre).
- Optional HA override (`msg.ha_enable="off"`) forces fallback value instead of current selected reference price.
- Full context reset using `msg.reset`.
- Detects interval length (15/30/60 minutes or other).
- Exposes rich attributes (selection details, block average, reference price, interval minutes, diagnostics).
- Supports selecting either the cheapest intervals or—when inverted—the most expensive (for things like high-price alerts).

---

## 🧠 Selection Logic Summary

| Mode | What is selected | `reference_price` meaning |
|------|------------------|---------------------------|
| Cheap (default) | Lowest priced intervals | Highest price among the selected cheap intervals (upper “cheap” threshold) |
| Expensive (invert) | Highest priced intervals | Lowest price among the selected expensive intervals (lower boundary of “expensive selection”) |

Why this reference logic?  
- In cheap mode, any real-time price below or equal to `reference_price` is inside your chosen cheap set.  
- In expensive mode, any price above the reported (lower) reference boundary belongs to the “expensive window” you selected.  
(You can extend logic later to also include both min and max as separate attributes if needed.)

In contiguous block mode the node finds the single continuous block (length = `count`) with:
- Lowest average (cheap mode)
- Highest average (expensive mode)

---

## 🔄 Rolling 24h vs Normal Periods

- **Normal period**: `start` and `stop` different (e.g. 22→06).  
  - If `start > stop` it spans midnight (overnight).
  - If `start < stop` it’s a same-day range.

- **Rolling 24h period**: `start == stop` (e.g. 16 and 16).  
  - The node creates a window starting at the most recent occurrence of that hour so that “now” is always inside the 24h span.
  - Example: At 21:30 with start=16 stop=16 → window = (today 16:00) → (tomorrow 15:59:59).
  - Attribute: `rolling_24h = on`.

---

## ⚙️ Node Configuration (Editor Fields)

| Field | Description |
|-------|-------------|
| Name | Display name for the node |
| Start hour | Start of selection window (0–23) |
| Stop hour | End of selection window (0–23); if same as start → rolling 24h |
| Count | Number of intervals (e.g. 4 × 15-minute intervals ≈ 1 hour) |
| Invert selection | Select expensive instead of cheap intervals |
| Contiguous block mode | Choose one continuous block instead of distinct intervals |
| Payload ON | Sent on output 1 when current time is inside an active selected interval |
| Payload OFF | Sent on output 2 when outside or inactive |
| Force value outside period | Used for HA entity when not active |
| Home Assistant entity | HA entity ID (e.g. `input_number.elpris`) |

---

## 🔌 Outputs (4)

| Output | Purpose | Example Payload |
|--------|---------|-----------------|
| 1 | Active period indicator (ON) | `on` (configurable) |
| 2 | Inactive indicator (OFF) | `off` (configurable) |
| 3 | State + attributes object | `{ state: 153.22, attributes: {...} }` |
| 4 | Home Assistant service message (optional) | `{ action: "input_number.set_value", data: { entity_id: "input_number.elpris", value: 153.22 } }` |

If HA override (`msg.ha_enable="off"`) is active, output 4 will send the configured `force_value` instead of the reference price.

---

## 💬 Runtime Inputs

| Property | Type | Description |
|----------|------|-------------|
| `msg.data` | object | Nordpool data wrapper (see format below) |
| `msg.start` | number | Override start hour (0–23) |
| `msg.stop` | number | Override stop hour (0–23) |
| `msg.count` | number | Override number of intervals |
| `msg.ha_enable` | string | `"on"` (normal) or `"off"` (force HA override) |
| `msg.reset` | any | Full reset of internal context (including HA override state) |

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

To reset:
```json
{ "reset": true }
```

To disable HA set-value behavior:
```json
{ "ha_enable": "off" }
```

---

## 📦 Expected Nordpool Data Structure

Minimal attributes needed:
- `raw_today`: Array of objects with at least `start` and `value` (or `price`).
- Optionally `raw_tomorrow`: Same structure (may arrive later in the day).
- `unit_of_measurement`: e.g. `Öre/kWh`, `SEK/kWh`, or `EUR/kWh`.
- Optional `price_in_cents: true` (treated as already in Öre).

Each `start` should be an ISO timestamp. The node deduplicates identical timestamps.

---

## 🧮 Interval Detection

The node infers interval length (`interval_minutes`) from the smallest positive gap between consecutive `start` timestamps. Common: 15, 30, or 60 minutes.  
Attributes include:
- `interval_minutes`
- `expected_points`, `actual_points`, `missing_points` (diagnostics)
- `partial_period: true` if data is incomplete

If interval ≥ 55 minutes, `count` is capped at 23 (for hours) to avoid unrealistic selections.

---

## 🔐 Reference Price Semantics

Attributes:
- `reference_price`: numeric threshold (in Öre) representing boundary inside the chosen selection.
- Cheap mode: highest price among selected cheap intervals.
- Expensive mode: lowest price among selected expensive intervals.
- `reference_price_mode`: `cheap_selection_max` or `expensive_selection_min`.

Rationale:  
- Cheap mode threshold can be used to decide “Is current price inside my cheap targets?”  
- Expensive mode threshold can be used to detect “Is current price above the lower bound of the expensive set?”

---

## 📊 Attribute Overview (Output 3 payload.attributes)

| Attribute | Meaning |
|-----------|---------|
| `time_01`, `time_02`, ... | Selected intervals with local time + price |
| `count` | Number of selected intervals |
| `selection_mode` | `cheap` or `expensive` |
| `reference_price` | Threshold price in Öre |
| `reference_price_mode` | See above |
| `max_time`, `min_time` | Highest/lowest priced among selected |
| `search_period` | Start → end label (localized) |
| `data_source` | Which merged sources were used (e.g. `yesterday + today + tomorrow`) |
| `interval_minutes` | Detected interval length |
| `contiguous_mode` | `on` / `off` |
| `rolling_24h` | `on` if start==stop logic used |
| `block_mode_start` / `block_mode_stop` | Contiguous block bounds (if enabled) |
| `block_mode_average` | Average price of the contiguous block |
| `total_hours_span` | Duration of the evaluated window |
| `expected_points` / `actual_points` | Diagnostics |
| `missing_points` | Data gaps (if any) |
| `partial_period` | True if data incomplete |
| `single_selection` | True if only one interval was selected |

---

## 🏠 Home Assistant Integration

If `ha_entity` is set (e.g. `input_number.elpris`), output 4 sends structured service-call style payloads:

Active interval:
```json
{
  "action": "input_number.set_value",
  "data": { "entity_id": "input_number.elpris", "value": 153.42 }
}
```

Outside interval or override active:
```json
{
  "action": "input_number.set_value",
  "data": { "entity_id": "input_number.elpris", "value": -600 }
}
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

## 🔁 Reset Behavior

Sending any truthy `msg.reset`:
- Clears all stored data (`today_data`, `yesterday_data`, `tomorrow_data`)
- Clears selection & overrides (`start_time`, `stop_time`, `count_hour`, `ha_enabled`)
- Sets status “Full context reset”

Example:
```json
{ "reset": true }
```

---

## 🧪 Example Flow Idea

1. Fetch Nordpool data hourly (or when updated).
2. Inject selection parameters via UI or function node.
3. Use output 1 to trigger charger “on” and output 2 to turn charger “off”.
4. Use output 3 to store attributes (e.g. InfluxDB, UI dashboard).
5. Use output 4 to sync current reference price into Home Assistant.

---

## 🚀 Installation

From Node-RED editor:
- Menu → Manage palette → Install → search for `node-red-contrib-nordpool-chargecheap`

Or via npm in your Node-RED user directory:
```bash
npm install node-red-contrib-nordpool-chargecheap
```

Restart Node-RED if needed.

---

## ⚠️ Notes & Edge Cases

- If tomorrow’s prices are not yet available, selection may mark `partial_period: true`.
- For rolling 24h mode you may temporarily miss intervals beyond currently available future data.
- If `count` exceeds available intervals, it is reduced to fit.
- If data contains gaps or out-of-order timestamps they are ignored after dedupe.

---

## 💡 Future Enhancements (Ideas)

- Optional attribute for both min & max reference thresholds in expensive mode.
- Ability to “lock” selection for a period so it doesn’t reshuffle when tomorrow’s data arrives.
- Multiple HA entities support.
- Switchable reference modes (avg, median, etc.).
- Price conversion to SEK if raw EUR values + automatic FX lookup (optional).

---

## 🐞 Troubleshooting

| Symptom | Possible Cause | Fix |
|---------|----------------|-----|
| `Waiting for Nordpool data` status | `raw_today` not populated yet | Confirm upstream Nordpool node outputs correctly |
| Incomplete selection / `partial_period` | Tomorrow data missing | Wait until Nordpool publishes next day |
| Wrong time zone display | System TZ mismatch | Node uses `Europe/Stockholm` explicitly |
| HA entity not updating | `ha_enable="off"` or no entity set | Send `{"ha_enable":"on"}`, confirm `ha_entity` configured |
| Reference price unexpected | Inverted mode semantics confusion | Re-check table under “Selection Logic Summary” |

---

## 📝 License & Contributions

Feel free to open issues or PRs for:
- Performance improvements
- Additional selection strategies
- Enhanced diagnostics

(Provide license section here if needed, e.g. MIT.)

---

## 🖼 Screenshots

Below are example screenshots (as provided):

<img width="972" height="705" alt="Screenshot 2025-10-26 at 16 11 16" src="https://github.com/user-attachments/assets/0c212234-0508-4e5e-9f1b-92c298642fbe" />
<img width="469" height="578" alt="Screenshot 2025-10-26 at 16 09 24" src="https://github.com/user-attachments/assets/16784e39-fc4b-4cbe-b3c9-ede6a024961a" />
<img width="429" height="553" alt="Screenshot 2025-10-26 at 16 52 55" src="https://github.com/user-attachments/assets/6c7b9838-ba13-4f00-8def-bb926afb062b" />
<img width="560" height="799" alt="Screenshot 2025-10-26 at 16 55 00" src="https://github.com/user-attachments/assets/8f1b74a1-ef2f-4758-bd1f-0534f6345bbf" />

---

## 🔄 Quick Reference Cheat Sheet

| Task | What to send |
|------|--------------|
| Override window | `{ "start": 7, "stop": 23 }` |
| Change count | `{ "count": 12 }` |
| Enable HA | `{ "ha_enable": "on" }` |
| Disable HA | `{ "ha_enable": "off" }` |
| Full reset | `{ "reset": true }` |
| Switch to expensive mode | Set invert selection in node config (or redeploy) |

