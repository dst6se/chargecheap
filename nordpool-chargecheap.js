module.exports = function (RED) {
    function NordpoolChargeCheapNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // --- Konfiguration samlad ---
        const cfg = {
            manualStart: toInt(config.start),
            manualStop: toInt(config.stop),
            manualCount: toInt(config.count),
            payloadOn: config.payload_on || "on",
            payloadOff: config.payload_off || "off",
            forceValue: Number(config.force_value) || -600,
            haEntity: config.ha_entity || "",
            invertSelection: !!config.invert_selection,
            contiguousMode: !!config.contiguous_mode,
            debug: !!config.debug
        };

        // --- Hjälpfunktioner ---
        function toInt(v) {
            if (v === undefined || v === null || v === "") return null;
            const n = Number(v);
            return isNaN(n) ? null : Math.floor(n);
        }

        function normalizeInput(value, max = 95) {
            if (value === undefined || value === null) return null;
            let num = Number(value);
            if (isNaN(num)) {
                const match = String(value).match(/\d+/);
                if (match) num = Number(match[0]);
            }
            if (isNaN(num)) return null;
            num = Math.floor(num);
            if (num < 0) num = 0;
            if (num > max) num = max;
            return num;
        }

        function detectUnitConversion(data) {
            const um = (data.unit_of_measurement || "").toLowerCase();
            const priceInCents = data.price_in_cents === true;
            if (priceInCents || um.includes("öre") || um.includes("ore")) {
                return (v) => Number(v);
            }
            if (um.includes("eur")) {
                return (v) => Number(v) * 100;
            }
            if (um.includes("sek")) {
                return (v) => Number(v) * 100;
            }
            return (v) => Number(v);
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

        function mergeRawArray(arr, convertFn) {
            if (!Array.isArray(arr)) return [];
            return arr
                .map(obj => {
                    const start = obj.start || obj.start_time || obj.startTime || obj.date;
                    const rawVal = obj.value !== undefined
                        ? obj.value
                        : (obj.price !== undefined ? obj.price : NaN);
                    const value = convertFn(rawVal);
                    return { start, value };
                })
                .filter(x => x.start && !isNaN(x.value));
        }

        function dedupeByStart(data) {
            const seen = new Set();
            return data.filter(d => {
                let key;
                try { key = new Date(d.start).toISOString(); } catch (e) { return false; }
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        }

        function buildPeriod(baseDate, fromHour, toHour) {
            const start = new Date(baseDate);
            start.setHours(fromHour, 0, 0, 0);
            const end = new Date(baseDate);
            if (fromHour > toHour) {
                end.setDate(end.getDate() + 1);
                end.setHours(toHour, 0, 0, 0);
            } else {
                end.setHours(toHour, 0, 0, 0);
            }
            return { start, end };
        }

        function detectIntervalMinutes(series) {
            if (series.length < 2) return 60;
            const times = series
                .map(s => new Date(s.start).getTime())
                .filter(t => !isNaN(t))
                .sort((a, b) => a - b);
            let minDiff = Infinity;
            for (let i = 1; i < times.length; i++) {
                const diffMin = (times[i] - times[i - 1]) / 60000;
                if (diffMin > 0 && diffMin < minDiff) {
                    minDiff = diffMin;
                }
            }
            if (minDiff === Infinity) return 60;
            const rounded = Math.round(minDiff);
            if (![15, 30, 60].includes(rounded)) return rounded;
            return rounded;
        }

        function selectCheapOrExpensive(inPeriod, count, invertSelection, contiguousMode) {
            if (inPeriod.length === 0) return { selected: [], meta: {} };
            if (count <= 0) return { selected: [], meta: {} };
            if (count > inPeriod.length) count = inPeriod.length;

            if (contiguousMode) {
                let bestAvg = invertSelection ? -Infinity : Infinity;
                let bestStartIdx = 0;
                for (let i = 0; i <= inPeriod.length - count; i++) {
                    const block = inPeriod.slice(i, i + count);
                    const avg = block.reduce((sum, v) => sum + v.value, 0) / block.length;
                    const better = invertSelection ? (avg > bestAvg) : (avg < bestAvg);
                    if (better) {
                        bestAvg = avg;
                        bestStartIdx = i;
                    }
                }
                const selected = inPeriod.slice(bestStartIdx, bestStartIdx + count)
                    .sort((a, b) => new Date(a.start) - new Date(b.start));
                return {
                    selected,
                    meta: {
                        contiguous: true,
                        blockAverage: bestAvg,
                        blockStart: selected[0].start,
                        blockStop: selected[selected.length - 1].start
                    }
                };
            } else {
                const sorted = [...inPeriod].sort((a, b) => invertSelection ? (b.value - a.value) : (a.value - b.value));
                const selected = sorted.slice(0, count)
                    .sort((a, b) => new Date(a.start) - new Date(b.start));
                return { selected, meta: { contiguous: false } };
            }
        }

        function buildAttributes(selected, periodLabel, invertSelection, sourceLabel, contiguousMeta, intervalMinutes, rolling24h) {
            const attr = {};
            selected.forEach((v, i) => {
                const dt = new Date(v.start);
                attr[`time_${String(i + 1).padStart(2, "0")}`] = `${toLocalLabel(dt)} :: ${v.value.toFixed(2)}Öre`;
            });

            if (selected.length > 0) {
                let max = selected[0], min = selected[0];
                selected.forEach(v => {
                    if (v.value > max.value) max = v;
                    if (v.value < min.value) min = v;
                });
                attr.max_time = `${toLocalLabel(new Date(max.start))} :: ${max.value.toFixed(2)}Öre`;
                attr.min_time = `${toLocalLabel(new Date(min.start))} :: ${min.value.toFixed(2)}Öre`;
            }

            const values = selected.map(v => v.value);
            const refCheap = values.length ? Math.max(...values) : null;
            // ÅTERSTÄLLD SEMANTIK: vid expensive (invertSelection) ska referens vara LÄGSTA av de dyrt valda (nedre gräns)
            const refExpensive = values.length ? Math.min(...values) : null;
            const reference = invertSelection ? refExpensive : refCheap;

            attr.reference_price = reference !== null ? `${reference.toFixed(2)}Öre` : null;
            attr.reference_price_mode = invertSelection ? "expensive_selection_min" : "cheap_selection_max";
            attr.selection_mode = invertSelection ? "expensive" : "cheap";
            attr.count = selected.length;
            attr.search_period = periodLabel;
            attr.data_source = sourceLabel;
            attr.interval_minutes = intervalMinutes;
            attr.contiguous_mode = contiguousMeta.contiguous ? "on" : "off";
            attr.rolling_24h = rolling24h ? "on" : "off";

            if (contiguousMeta.contiguous && selected.length > 0) {
                const blockStart = new Date(contiguousMeta.blockStart);
                const lastStart = new Date(contiguousMeta.blockStop);
                const blockStop = new Date(lastStart.getTime() + intervalMinutes * 60000);
                attr.block_mode_start = toLocalLabel(blockStart);
                attr.block_mode_stop = toLocalLabel(blockStop);
                attr.block_mode_average = `${contiguousMeta.blockAverage.toFixed(2)}Öre`;
            }

            if (selected.length === 1) {
                attr.single_selection = true;
            }

            return { attributes: attr, reference };
        }

        function isActiveNow(selected, intervalMinutes) {
            const now = new Date();
            return selected.some(v => {
                const start = new Date(v.start);
                const end = new Date(start.getTime() + intervalMinutes * 60000);
                return now >= start && now < end;
            });
        }

        node.on("input", function (msg) {
            const context = node.context();

            if (msg.ha_enable !== undefined) {
                const haEnabled = String(msg.ha_enable).toLowerCase() === "on";
                context.set("ha_enabled", haEnabled);
            }
            const haEnabled = context.get("ha_enabled");

            if (haEnabled === false) {
                node.status({ fill: "yellow", shape: "ring", text: "HA disabled (manual override)" });
            }

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
                context.set("ha_enabled", null);

                node.status({ fill: "blue", shape: "dot", text: "Full context reset" });
                node.send([null, null, { payload: "context fully reset" }, null]);
                return;
            }

            const startIn = normalizeInput(msg.start);
            const stopIn = normalizeInput(msg.stop);
            const countIn = normalizeInput(msg.count, 95);

            if (startIn !== null) context.set("start_time", startIn);
            if (stopIn !== null) context.set("stop_time", stopIn);
            if (countIn !== null) context.set("count_hour", countIn);

            let flowStart = context.get("start_time") ?? cfg.manualStart;
            let flowStop = context.get("stop_time") ?? cfg.manualStop;
            let flowCount = context.get("count_hour") ?? cfg.manualCount;

            if ([flowStart, flowStop, flowCount].some(v => v === null || isNaN(v))) {
                node.status({ fill: "red", shape: "dot", text: "Missing start/stop/count" });
                node.send([null, null, { payload: { error: "start/stop/count missing" } }, null]);
                return;
            }

            try {
                const dataRoot = (msg.data?.attributes || msg.data?.new_state?.attributes) || {};
                const rolling24h = (flowStart === flowStop);
                const isNight = !rolling24h && (flowStart > flowStop);

                const convertFn = detectUnitConversion(dataRoot);

                let dataDate = null;
                if (Array.isArray(dataRoot.raw_today) && dataRoot.raw_today.length > 0) {
                    try { dataDate = new Date(dataRoot.raw_today[0].start).toISOString().slice(0, 10); } catch (e) { }
                }

                const existingToday = context.get("today_data");
                if (existingToday && existingToday.date && dataDate && existingToday.date !== dataDate) {
                    const prev = existingToday.date;
                    if (new Date(prev) < new Date(dataDate)) {
                        context.set("yesterday_data", existingToday);
                        context.set("today_data", null);
                    }
                }

                if (dataDate && Array.isArray(dataRoot.raw_today) && dataRoot.raw_today.length > 0) {
                    context.set("today_data", { date: dataDate, data: dataRoot.raw_today });
                }

                const todayStore = context.get("today_data") || {};
                const yesterdayStore = context.get("yesterday_data") || {};

                let rawTomorrow = [];
                const storedTomorrow = context.get("tomorrow_data");
                if (Array.isArray(dataRoot.raw_tomorrow) && dataRoot.raw_tomorrow.length > 0) {
                    rawTomorrow = dataRoot.raw_tomorrow;
                    context.set("tomorrow_data", rawTomorrow);
                } else if (Array.isArray(storedTomorrow) && storedTomorrow.length > 0) {
                    rawTomorrow = storedTomorrow;
                }

                let all = [];
                let sourceLabel = "";
                if (rolling24h) {
                    all = mergeRawArray(yesterdayStore.data, convertFn)
                        .concat(mergeRawArray(todayStore.data, convertFn))
                        .concat(mergeRawArray(rawTomorrow, convertFn));
                    sourceLabel = "yesterday + today + tomorrow";
                } else {
                    const nowHour = new Date().getHours();
                    if (isNight && nowHour < flowStop) {
                        all = mergeRawArray(yesterdayStore.data, convertFn).concat(mergeRawArray(todayStore.data, convertFn));
                        sourceLabel = "yesterday + today";
                    } else if (isNight && (!Array.isArray(rawTomorrow) || rawTomorrow.length === 0)) {
                        all = mergeRawArray(yesterdayStore.data, convertFn).concat(mergeRawArray(todayStore.data, convertFn));
                        sourceLabel = "yesterday + today";
                    } else {
                        all = mergeRawArray(todayStore.data, convertFn).concat(mergeRawArray(rawTomorrow, convertFn));
                        sourceLabel = "today + tomorrow";
                    }
                }

                all = dedupeByStart(all);

                let startDate, endDate;
                if (rolling24h) {
                    const now = new Date();
                    startDate = new Date(now);
                    startDate.setHours(flowStart, 0, 0, 0);
                    if (now < startDate) {
                        startDate.setDate(startDate.getDate() - 1);
                    }
                    endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000 - 1);
                } else {
                    let baseDate = new Date();
                    const nowHourFixed = baseDate.getHours();
                    if (isNight && nowHourFixed < flowStop) {
                        baseDate.setDate(baseDate.getDate() - 1);
                    } else if (!isNight && nowHourFixed >= flowStop) {
                        baseDate.setDate(baseDate.getDate() + 1);
                    }
                    const tmp = buildPeriod(baseDate, flowStart, flowStop);
                    startDate = tmp.start;
                    endDate = tmp.end;
                }

                const periodLabel = `${toLocalLabel(startDate)} → ${toLocalLabel(endDate)}`;

                const inPeriod = all.filter(entry => {
                    const entryDate = new Date(entry.start);
                    return entryDate >= startDate && entryDate <= endDate;
                });

                if (inPeriod.length === 0) {
                    node.status({ fill: "yellow", shape: "ring", text: "Waiting for Nordpool data" });
                    const infoMsg = {
                        payload: {
                            state: null,
                            attributes: {
                                info: "No valid times, waiting for data",
                                rolling_24h: rolling24h ? "on" : "off"
                            }
                        }
                    };
                    const haMsg = (cfg.haEntity && cfg.haEntity.trim() !== "")
                        ? {
                            payload: {
                                action: "input_number.set_value",
                                data: { entity_id: cfg.haEntity, value: cfg.forceValue }
                            }
                        }
                        : null;
                    node.send([null, { payload: cfg.payloadOff }, infoMsg, haMsg]);
                    return;
                }

                const intervalMinutes = detectIntervalMinutes(inPeriod);
                if (intervalMinutes >= 55 && flowCount > 23) {
                    flowCount = 23;
                }

                const { selected, meta } = selectCheapOrExpensive(inPeriod, flowCount, cfg.invertSelection, cfg.contiguousMode);

                const expectedPoints = Math.round((endDate - startDate) / (intervalMinutes * 60000));
                const missingPoints = expectedPoints - inPeriod.length;

                const { attributes: attr, reference } = buildAttributes(
                    selected,
                    periodLabel,
                    cfg.invertSelection,
                    sourceLabel,
                    meta,
                    intervalMinutes,
                    rolling24h
                );

                const totalHours = (endDate - startDate) / 3600000;
                attr.total_hours_span = Number(totalHours.toFixed(2));
                attr.expected_points = expectedPoints;
                attr.actual_points = inPeriod.length;
                if (missingPoints > 0) {
                    attr.missing_points = missingPoints;
                    attr.partial_period = true;
                }

                const newMsg = { payload: { state: reference, attributes: attr } };

                const active = isActiveNow(selected, intervalMinutes);
                let outsidePeriod = !(new Date() >= startDate && new Date() <= endDate);

                let haMsgInside, haMsgOutside;
                if (haEnabled === false) {
                    haMsgInside = haMsgOutside = (cfg.haEntity && cfg.haEntity.trim() !== "")
                        ? {
                            payload: {
                                action: "input_number.set_value",
                                data: { entity_id: cfg.haEntity, value: cfg.forceValue }
                            }
                        }
                        : null;
                } else {
                    haMsgInside = (cfg.haEntity && cfg.haEntity.trim() !== "")
                        ? {
                            payload: {
                                action: "input_number.set_value",
                                data: { entity_id: cfg.haEntity, value: reference ?? cfg.forceValue }
                            }
                        }
                        : null;
                    haMsgOutside = (cfg.haEntity && cfg.haEntity.trim() !== "")
                        ? {
                            payload: {
                                action: "input_number.set_value",
                                data: { entity_id: cfg.haEntity, value: cfg.forceValue }
                            }
                        }
                        : null;
                }

                if (haEnabled !== false) {
                    node.status({
                        fill: active ? "green" : "grey",
                        shape: "dot",
                        text: `${String(flowStart).padStart(2, "0")}→${String(flowStop).padStart(2, "0")} (${flowCount}x ${cfg.invertSelection ? "expensive" : "cheap"})${rolling24h ? " 24h" : ""}`
                    });
                }

                if (outsidePeriod || reference === null || isNaN(reference)) {
                    node.send([null, { payload: cfg.payloadOff }, newMsg, haMsgOutside]);
                } else if (active) {
                    node.send([{ payload: cfg.payloadOn }, null, newMsg, haMsgInside]);
                } else {
                    node.send([null, { payload: cfg.payloadOff }, newMsg, haMsgInside]);
                }

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
            contiguous_mode: { value: false, required: false },
            debug: { value: false, required: false }
        },
        label: function () {
            return this.name || "Nordpool ChargeCheap";
        }
    });
};
