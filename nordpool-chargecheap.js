module.exports = function (RED) {
    function NordpoolChargeCheapNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // === Manual configuration ===
        node.manualStart = Number(config.start) || null;
        node.manualStop = Number(config.stop) || null;
        node.manualCount = Number(config.count) || null;
        node.payloadOn = config.payload_on || "on";
        node.payloadOff = config.payload_off || "off";
        node.forceValue = Number(config.force_value) || -600;
        node.haEntity = config.ha_entity || "";
        node.invert_selection = config.invert_selection || false;
        node.contiguous_mode = config.contiguous_mode || false;

        node.on("input", function (msg) {
            const context = node.context();

            // --- Reset context ---
            if (msg.reset !== undefined) {
                [
                    "today_data",
                    "yesterday_data",
                    "tomorrow_data",
                    "selected_for_period",
                    "start_time",
                    "stop_time",
                    "count_hour"
                ].forEach(k => context.set(k, null));
                node.status({ fill: "blue", shape: "dot", text: "Context reset" });
                node.send([null, null, { payload: "context reset" }, null]);
                return;
            }

            // --- Normalize input values (start/stop/count) ---
            function normalizeInput(value) {
                if (value === undefined || value === null) return null;
                let num = Number(value);
                if (isNaN(num)) {
                    const match = String(value).match(/\d+/);
                    if (match) num = Number(match[0]);
                }
                if (isNaN(num)) return null;
                num = Math.floor(num);
                if (num < 0) num = 0;
                if (num > 95) num = 95; // ändrat till 95 (kvartslogik)
                return num;
            }

            const startIn = normalizeInput(msg.start);
            const stopIn = normalizeInput(msg.stop);
            const countIn = normalizeInput(msg.count);

            if (startIn !== null) context.set("start_time", startIn);
            if (stopIn !== null) context.set("stop_time", stopIn);
            if (countIn !== null) context.set("count_hour", countIn);

            const flowStart = context.get("start_time") ?? node.manualStart;
            const flowStop = context.get("stop_time") ?? node.manualStop;
            const flowCount = context.get("count_hour") ?? node.manualCount;

            if (
                flowStart === null ||
                flowStop === null ||
                flowCount === null ||
                isNaN(flowStart) ||
                isNaN(flowStop) ||
                isNaN(flowCount)
            ) {
                node.status({ fill: "red", shape: "dot", text: "Missing start/stop/count" });
                node.send([null, null, { payload: { error: "start/stop/count missing" } }, null]);
                return;
            }

            try {
                node.status({ fill: "blue", shape: "ring", text: "Startar analys..." });

                var newMsg = {};
                const data = (msg.data?.attributes || msg.data?.new_state?.attributes) || {};
                const isNight = flowStart > flowStop;

                const valuesAreInOres =
                    data.price_in_cents === true ||
                    (typeof data.unit_of_measurement === "string" &&
                        data.unit_of_measurement.toLowerCase().includes("öre"));

                function toOres(v) {
                    if (v === undefined || v === null || isNaN(Number(v))) return NaN;
                    const num = Number(v);
                    return valuesAreInOres ? num : num;
                }

                function toLocalLabel(dateObj) {
                    return dateObj
                        .toLocaleString("sv-SE", {
                            timeZone: "Europe/Stockholm",
                            year: "numeric",
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit"
                        })
                        .replace(",", "");
                }

                // === FIXAD buildPeriod() ===
                function buildPeriod(baseDate, fromHour, toHour) {
                    const start = new Date(baseDate);
                    start.setHours(fromHour, 0, 0, 0);
                    const end = new Date(baseDate);

                    // Specialfall: 0–0 = hela dygnet
                    if (fromHour === 0 && toHour === 0) {
                        end.setDate(start.getDate() + 1);
                        end.setHours(0, 0, 0, 0);
                        return { start, end };
                    }

                    // Natt (t.ex. 22→06)
                    if (fromHour > toHour) {
                        end.setDate(end.getDate() + 1);
                    }

                    // Vanlig dag
                    end.setHours(toHour + 1, 0, 0, 0);
                    return { start, end };
                }

                function merge(source) {
                    if (!Array.isArray(source)) return [];
                    return source
                        .map((obj) => ({
                            start: obj.start || obj.start_time || obj.startTime || obj.date,
                            value: toOres(
                                obj.value !== undefined
                                    ? obj.value
                                    : obj.price !== undefined
                                        ? obj.price
                                        : NaN
                            )
                        }))
                        .filter((x) => x.start && !isNaN(x.value));
                }

                // === Context handling ===
                let todayStore = context.get("today_data") || {};
                let yesterdayStore = context.get("yesterday_data") || {};

                let dataDate = null;
                if (Array.isArray(data.raw_today) && data.raw_today.length > 0) {
                    try { dataDate = new Date(data.raw_today[0].start).toISOString().slice(0, 10); } catch (e) { }
                }

                const existingToday = context.get("today_data");
                if (existingToday && existingToday.date && dataDate && existingToday.date !== dataDate) {
                    const prev = existingToday.date;
                    if (new Date(prev) < new Date(dataDate)) {
                        context.set("yesterday_data", existingToday);
                        yesterdayStore = existingToday;
                        context.set("today_data", null);
                    }
                }

                if (dataDate && Array.isArray(data.raw_today) && data.raw_today.length > 0) {
                    todayStore = { date: dataDate, data: data.raw_today };
                    context.set("today_data", todayStore);
                } else if (existingToday) {
                    todayStore = existingToday;
                }

                let storedTomorrow = context.get("tomorrow_data");
                let raw_tomorrow = [];

                if (Array.isArray(data.raw_tomorrow) && data.raw_tomorrow.length > 0) {
                    raw_tomorrow = data.raw_tomorrow;
                    context.set("tomorrow_data", raw_tomorrow);
                } else if (Array.isArray(storedTomorrow) && storedTomorrow.length > 0) {
                    raw_tomorrow = storedTomorrow;
                }

                let all = [];
                let sourceLabel = "";

                const nowHour = new Date().getHours();

                // specialfall: 0–0 = hela dagen från todayStore
                const forceTodayOnly = (flowStart === 0 && flowStop === 0);
                if (forceTodayOnly) {
                    all = merge(todayStore.data);
                    sourceLabel = "today (forced)";
                } else if (isNight && nowHour < flowStop) {
                    all = merge(yesterdayStore.data).concat(merge(todayStore.data));
                    sourceLabel = "yesterday + today";
                } else if (isNight && (!Array.isArray(raw_tomorrow) || raw_tomorrow.length === 0)) {
                    all = merge(yesterdayStore.data).concat(merge(todayStore.data));
                    sourceLabel = "yesterday + today";
                } else {
                    all = merge(todayStore.data).concat(merge(raw_tomorrow));
                    sourceLabel = "today + tomorrow";
                }

                const seen = new Set();
                all = all.filter((entry) => {
                    const key = new Date(entry.start).toISOString();
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });

                let baseDate = new Date();
                const nowHourFixed = baseDate.getHours();

                if (!forceTodayOnly) {
                    if (isNight && nowHourFixed < flowStop) {
                        baseDate.setDate(baseDate.getDate() - 1);
                    } else if (!isNight && nowHourFixed >= flowStop) {
                        baseDate.setDate(baseDate.getDate() + 1);
                    }
                }

                const { start: startDate, end: endDate } = buildPeriod(baseDate, flowStart, flowStop);
                const periodLabel = `${toLocalLabel(startDate)} → ${toLocalLabel(endDate)}`;

                const inPeriod = all.filter((entry) => {
                    const entryDate = new Date(entry.start);
                    return entryDate >= startDate && entryDate < endDate;
                });

                if (inPeriod.length === 0) {
                    node.status({ fill: "yellow", shape: "ring", text: "Waiting for Nordpool data" });
                    newMsg.payload = { state: null, attributes: { info: "No valid times, waiting for data" } };
                    node.send([null, null, newMsg, null]);
                    return;
                }

                // === Urval av billigaste/dyraste ===
                let selected = [];
                if (node.contiguous_mode) {
                    let bestAvg = Infinity;
                    let bestStartIdx = 0;
                    for (let i = 0; i <= inPeriod.length - flowCount; i++) {
                        const block = inPeriod.slice(i, i + flowCount);
                        const avg = block.reduce((sum, v) => sum + v.value, 0) / block.length;
                        if (avg < bestAvg) {
                            bestAvg = avg;
                            bestStartIdx = i;
                        }
                    }
                    selected = inPeriod.slice(bestStartIdx, bestStartIdx + flowCount);
                    selected.sort((a, b) => new Date(a.start) - new Date(b.start));
                } else {
                    if (node.invert_selection) {
                        inPeriod.sort((a, b) => b.value - a.value);
                    } else {
                        inPeriod.sort((a, b) => a.value - b.value);
                    }
                    selected = inPeriod.slice(0, flowCount);
                    selected.sort((a, b) => new Date(a.start) - new Date(b.start));
                }

                let refPrice = node.invert_selection
                    ? Math.min(...selected.map(v => v.value))
                    : Math.max(...selected.map(v => v.value));

                let attr = {};
                selected.forEach((v, i) => {
                    const dt = new Date(v.start);
                    attr[`time_${String(i + 1).padStart(2, "0")}`] = `${toLocalLabel(dt)} :: ${v.value.toFixed(2)}Öre`;
                });

                attr.count = selected.length;
                attr.mode = isNight ? "natt" : "dag";
                attr.search_period = periodLabel;
                attr.reference_price = `${refPrice.toFixed(2)}Öre`;
                attr.selection_mode = node.invert_selection ? "dyraste" : "billigaste";
                attr.data_source = sourceLabel;

                newMsg.payload = { state: refPrice, attributes: attr };

                const now = new Date();
                let active = selected.some(v => {
                    const entryStart = new Date(v.start);
                    const entryEnd = new Date(entryStart.getTime() + 60 * 60 * 1000);
                    return now >= entryStart && now < entryEnd;
                });

                node.status({
                    fill: active ? "green" : "grey",
                    shape: "dot",
                    text: `${String(flowStart).padStart(2, "0")}→${String(flowStop).padStart(2, "0")} (${flowCount}x ${node.invert_selection ? "dyraste" : "billigaste"})`
                });

                if (active) node.send([{ payload: node.payloadOn }, null, newMsg, null]);
                else node.send([null, { payload: node.payloadOff }, newMsg, null]);

            } catch (err) {
                node.error(`Error in Nordpool analysis: ${err.message}`);
                node.status({ fill: "red", shape: "ring", text: "Error" });
                node.send([null, null, { payload: { error: err.message } }, null]);
            }
        });
    }

    RED.nodes.registerType("nordpool-chargecheap", NordpoolChargeCheapNode, {
        outputs: 4,
        defaults: {
            name: { value: "" },
            start: { value: "", required: false },
            stop: { value: "", required: false },
            count: { value: "", required: false },
            payload_on: { value: "on", required: false },
            payload_off: { value: "off", required: false },
            force_value: { value: -600, required: false },
            ha_entity: { value: "", required: false },
            invert_selection: { value: false, required: false },
            contiguous_mode: { value: false, required: false }
        },
        label: function () {
            return this.name || "Nordpool ChargeCheap";
        }
    });
};

