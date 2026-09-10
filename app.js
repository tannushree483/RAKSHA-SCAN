let selectedScenario = "normal";
let latestEvent = null;
let map = null;
let mapMarker = null;
let lastMapPosition = [28.6139, 77.2090];
let offlineMode = false;

const $ = (id) => document.getElementById(id);

function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function statusClass(status) {
    return status.toLowerCase().replaceAll(" ", "-");
}

function setupMap() {
    if (!window.L) {
        $("mapStatus").textContent = "Map library unavailable.";
        return;
    }

    map = L.map("realMap", {
        zoomControl: true,
        attributionControl: true
    }).setView(lastMapPosition, 16);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    map.on("load", () => map.invalidateSize());
    setTimeout(() => map.invalidateSize(), 250);
}

function updateMap(event) {
    if (!map || !event) return;

    const lat = Number(event.latitude);
    const lon = Number(event.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    lastMapPosition = [lat, lon];

    const iconColor =
        event.status === "High-Risk" ? "#ff5d6c" :
        event.status === "Suspicious" ? "#ffc857" : "#19d3ae";

    const markerIcon = L.divIcon({
        className: "custom-map-marker",
        html: `<div style="
            width:18px;height:18px;border-radius:50%;
            background:${iconColor};
            border:3px solid #071018;
            box-shadow:0 0 0 5px ${iconColor}44,0 0 20px ${iconColor};
        "></div>`,
        iconSize: [18,18],
        iconAnchor: [9,9]
    });

    if (mapMarker) map.removeLayer(mapMarker);

    mapMarker = L.marker([lat, lon], {icon: markerIcon})
        .addTo(map)
        .bindPopup(`
            <b>RAKSHA-SCAN ALERT</b><br>
            Status: ${escapeHtml(event.status)}<br>
            Score: ${escapeHtml(event.threat_score)}<br>
            Mode: ${escapeHtml(event.mode)}<br>
            Target: ${escapeHtml(event.target)}<br>
            Time: ${escapeHtml(event.timestamp)}
        `)
        .openPopup();

    map.setView([lat, lon], 17, {animate: true});
    $("mapStatus").textContent =
        `${event.status} • ${event.mode} • ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

function setScenario(scenario) {
    selectedScenario = scenario;
    document.querySelectorAll(".scenario-btn").forEach(btn => {
        btn.classList.toggle("selected", btn.dataset.scenario === scenario);
    });
}

function updateDashboard(event) {
    latestEvent = event;
    const score = Number(event.threat_score) || 0;

    $("deviceStatus").textContent = event.status.toUpperCase();
    $("deviceScore").textContent = score.toFixed(1);
    $("deviceBar").style.width = `${Math.min(score, 100)}%`;

    $("threatScore").textContent = score.toFixed(1);
    $("threatMeter").style.width = `${Math.min(score, 100)}%`;

    $("temperature").textContent = `${event.temperature} °C`;
    $("humidity").textContent = `${event.humidity} %`;
    $("gasLevel").textContent = event.gas_level;
    $("signalLevel").textContent = event.signal_level;
    $("gpsValue").textContent =
        `${Number(event.latitude).toFixed(5)}, ${Number(event.longitude).toFixed(5)}`;

    const cls = $("classification");
    cls.querySelector("b").textContent = event.status.toUpperCase();
    cls.querySelector("small").textContent =
        event.status === "Normal"
            ? "No suspicious signature detected."
            : event.status === "Suspicious"
                ? "RPF verification recommended."
                : "Immediate RPF attention and remote verification recommended.";

    const statusDot = cls.querySelector("span");
    statusDot.textContent = "●";
    statusDot.style.color =
        event.status === "High-Risk" ? "#ff5d6c" :
        event.status === "Suspicious" ? "#ffc857" : "#19d3ae";

    $("currentRisk").textContent = event.status.toUpperCase();
    $("currentRiskScore").textContent = `Threat score ${score.toFixed(1)}`;

    $("latestContent").innerHTML = `
        <div class="latest-data">
            <div class="data-box"><span>STATUS</span><b>${escapeHtml(event.status)}</b></div>
            <div class="data-box"><span>SCORE</span><b>${score.toFixed(1)} / 100</b></div>
            <div class="data-box"><span>TARGET</span><b>${escapeHtml(event.target)}</b></div>
            <div class="data-box"><span>MODE</span><b>${escapeHtml(event.mode)}</b></div>
            <div class="data-box"><span>DEVICE</span><b>${escapeHtml(event.device_id)}</b></div>
            <div class="data-box"><span>TIME</span><b>${escapeHtml(event.timestamp)}</b></div>
            <div class="data-box"><span>GPS</span><b>${Number(event.latitude).toFixed(5)}, ${Number(event.longitude).toFixed(5)}</b></div>
            <div class="data-box"><span>SYNC</span><b>${event.synced ? "SYNCED" : "PENDING"}</b></div>
        </div>
    `;

    updateMap(event);
}

async function runScan() {
    const button = $("runScan");
    button.disabled = true;
    button.innerHTML = "<span>●</span> SCANNING...";

    const payload = {
        scenario: selectedScenario,
        mode: $("modeSelect").value,
        target: $("targetSelect").value
    };

    try {
        if (offlineMode) {
            const event = createOfflineEvent(payload);
            saveOfflineEvent(event);
            updateDashboard(event);
            await refreshAll();
            showToast(`${event.status} scan stored locally.`);
            return;
        }

        const response = await fetch("/api/scan", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error("Scan failed");
        const data = await response.json();

        updateDashboard(data.event);
        await refreshAll();

        if (data.event.status === "Normal") {
            showToast("NORMAL: No suspicious signature detected.");
        } else if (data.event.status === "Suspicious") {
            showToast("SUSPICIOUS: RPF verification recommended.");
        } else {
            showToast("HIGH-RISK: Immediate attention required.");
        }
    } catch (error) {
        showToast("Network unavailable. Switching to local mode.");
        offlineMode = true;
        setConnectionState();
        const event = createOfflineEvent(payload);
        saveOfflineEvent(event);
        updateDashboard(event);
        await refreshAll();
    } finally {
        button.disabled = false;
        button.innerHTML = "<span>▶</span> RUN SELECTED SCAN";
    }
}

function createOfflineEvent(payload) {
    const profiles = {
        normal: {
            status: "Normal", score: [8,24], temperature:[27.5,29.5],
            humidity:[58,64], gas:"LOW", signal:"LOW"
        },
        suspicious: {
            status: "Suspicious", score: [52,69], temperature:[33,36.5],
            humidity:[67,73], gas:"ELEVATED", signal:"MEDIUM"
        },
        "high-risk": {
            status: "High-Risk", score: [82,98], temperature:[42,47],
            humidity:[76,83], gas:"HIGH", signal:"HIGH"
        }
    };

    const p = profiles[payload.scenario];
    const locations = {
        Platform:[28.6139,77.2090],
        Luggage:[28.6148,77.2080],
        Coach:[28.6155,77.2070],
        Yard:[28.6170,77.2050],
        "Under-Coach":[28.6182,77.2035]
    };
    const [baseLat, baseLon] = locations[payload.mode];
    const rand = (a,b) => a + Math.random()*(b-a);
    const pad = n => n.toString().padStart(2,"0");
    const d = new Date();
    const timestamp =
        `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ` +
        `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

    return {
        id: `OFF-${Date.now()}`,
        device_id:"RS-HH-01",
        mode:payload.mode,
        target:payload.target,
        status:p.status,
        threat_score:Number(rand(...p.score).toFixed(1)),
        temperature:Number(rand(...p.temperature).toFixed(1)),
        humidity:Number(rand(...p.humidity).toFixed(1)),
        gas_level:p.gas,
        signal_level:p.signal,
        latitude:Number((baseLat+rand(-.00035,.00035)).toFixed(6)),
        longitude:Number((baseLon+rand(-.00035,.00035)).toFixed(6)),
        timestamp,
        synced:0
    };
}

function getLocalEvents() {
    try {
        return JSON.parse(localStorage.getItem("rakshaOfflineEvents") || "[]");
    } catch {
        return [];
    }
}

function saveOfflineEvent(event) {
    const events = getLocalEvents();
    events.unshift(event);
    localStorage.setItem("rakshaOfflineEvents", JSON.stringify(events.slice(0,100)));
}

function mergeEvents(serverEvents) {
    const localEvents = getLocalEvents();
    return [...localEvents, ...serverEvents].sort((a,b) => {
        return new Date(b.timestamp.replace(" ","T")) - new Date(a.timestamp.replace(" ","T"));
    });
}

function isToday(timestamp) {
    const d = new Date();
    const pad = n => String(n).padStart(2,"0");
    const today = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    return String(timestamp).slice(0,10) === today;
}

async function fetchServerEvents() {
    if (offlineMode) return [];
    const response = await fetch("/api/events");
    if (!response.ok) throw new Error("Events failed");
    return await response.json();
}

async function refreshStats() {
    if (offlineMode) {
        const events = mergeEvents([], getLocalEvents());
        const today = events.filter(e => isToday(e.timestamp));
        const threats = today.filter(e => e.status === "Suspicious" || e.status === "High-Risk");
        $("todayScans").textContent = String(today.length).padStart(2,"0");
        $("threatsFlagged").textContent = String(threats.length).padStart(2,"0");
        $("currentRisk").textContent = latestEvent ? latestEvent.status.toUpperCase() : "NORMAL";
        return;
    }

    const response = await fetch("/api/stats");
    const stats = await response.json();

    $("activeDevices").textContent = String(stats.active_devices).padStart(2,"0");
    $("todayScans").textContent = String(stats.today_scans).padStart(2,"0");
    $("threatsFlagged").textContent = String(stats.threats_flagged).padStart(2,"0");

    if (stats.current_risk) {
        $("currentRisk").textContent = stats.current_risk.status.toUpperCase();
        $("currentRiskScore").textContent =
            `Threat score ${Number(stats.current_risk.threat_score).toFixed(1)}`;
    }
}

async function refreshLog() {
    let serverEvents = [];
    try {
        serverEvents = await fetchServerEvents();
    } catch {}

    const events = mergeEvents(serverEvents, getLocalEvents());
    const tbody = $("eventTable");

    if (!events.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="table-empty">No events recorded.</td></tr>`;
        return;
    }

    tbody.innerHTML = events.slice(0,20).map(event => `
        <tr>
            <td>${escapeHtml(event.timestamp)}</td>
            <td>${escapeHtml(event.device_id)}</td>
            <td>${escapeHtml(event.mode)}</td>
            <td>${escapeHtml(event.target)}</td>
            <td class="status-cell status-${statusClass(event.status)}">${escapeHtml(event.status)}</td>
            <td>${Number(event.threat_score).toFixed(1)}</td>
            <td class="${event.synced ? "sync-ok" : "sync-pending"}">${event.synced ? "SYNCED" : "LOCAL"}</td>
        </tr>
    `).join("");
}

async function refreshHealth() {
    try {
        const response = await fetch("/api/devices");
        const devices = await response.json();

        $("deviceHealthList").innerHTML = devices.map(device => `
            <div class="health-row">
                <div><b>${escapeHtml(device.device_id)}</b><br><span>${escapeHtml(device.type)}</span></div>
                <span class="${device.status === "ONLINE" ? "online" : "standby"}">${escapeHtml(device.status)}</span>
                <span>${escapeHtml(device.battery)}% battery</span>
                <span>${escapeHtml(device.signal)}</span>
            </div>
        `).join("");
    } catch {
        $("deviceHealthList").innerHTML = `
            <div class="health-row">
                <b>LOCAL MODE</b><span class="standby">OFFLINE</span>
                <span>Cloud sync paused</span><span>LOCAL</span>
            </div>
        `;
    }
}

async function refreshAll() {
    await Promise.allSettled([refreshStats(), refreshLog(), refreshHealth()]);
}

function setConnectionState() {
    const dot = $("connectionDot");
    dot.classList.toggle("offline", offlineMode);
    $("connectionText").textContent = offlineMode ? "LOCAL / OFFLINE" : "SYSTEM ONLINE";
    $("offlineBtn").textContent = offlineMode ? "ONLINE MODE" : "OFFLINE MODE";
}

function showModal(html) {
    $("modalContent").innerHTML = html;
    $("modalBackdrop").classList.add("show");
}

function closeModal() {
    $("modalBackdrop").classList.remove("show");
}

async function showDevices() {
    try {
        const response = await fetch("/api/devices");
        const devices = await response.json();

        showModal(`
            <div class="modal-inner">
                <h2>Active Devices</h2>
                <p>RAKSHA-SCAN device fleet status.</p>
                <div class="modal-list">
                    ${devices.map(d => `
                        <div class="modal-row">
                            <div><b>${escapeHtml(d.device_id)}</b><br><span>${escapeHtml(d.type)}</span></div>
                            <div><b>${escapeHtml(d.status)}</b><br><span>${escapeHtml(d.battery)}% • ${escapeHtml(d.signal)}</span></div>
                        </div>
                    `).join("")}
                </div>
            </div>
        `);
    } catch {
        showModal(`<div class="modal-inner"><h2>Device Status</h2><p>Device information is temporarily unavailable.</p></div>`);
    }
}

function showEventDetails(event) {
    if (!event) {
        showModal(`<div class="modal-inner"><h2>No Detection</h2><p>Run a scan first to see complete event details.</p></div>`);
        return;
    }

    showModal(`
        <div class="modal-inner">
            <h2>${escapeHtml(event.status)} Detection</h2>
            <p>Complete RAKSHA-SCAN event record.</p>
            <div class="modal-list">
                <div class="modal-row"><span>Threat Score</span><b>${Number(event.threat_score).toFixed(1)} / 100</b></div>
                <div class="modal-row"><span>Target</span><b>${escapeHtml(event.target)}</b></div>
                <div class="modal-row"><span>Railway Mode</span><b>${escapeHtml(event.mode)}</b></div>
                <div class="modal-row"><span>Device ID</span><b>${escapeHtml(event.device_id)}</b></div>
                <div class="modal-row"><span>Temperature</span><b>${escapeHtml(event.temperature)} °C</b></div>
                <div class="modal-row"><span>Humidity</span><b>${escapeHtml(event.humidity)} %</b></div>
                <div class="modal-row"><span>Gas / VOC</span><b>${escapeHtml(event.gas_level)}</b></div>
                <div class="modal-row"><span>Signal</span><b>${escapeHtml(event.signal_level)}</b></div>
                <div class="modal-row"><span>GPS</span><b>${escapeHtml(event.latitude)}, ${escapeHtml(event.longitude)}</b></div>
                <div class="modal-row"><span>Timestamp</span><b>${escapeHtml(event.timestamp)}</b></div>
                <div class="modal-row"><span>Sync State</span><b>${event.synced ? "SYNCED" : "LOCAL / PENDING"}</b></div>
            </div>
        </div>
    `);
}

async function showTodayScans() {
    let serverEvents = [];
    try { serverEvents = await fetchServerEvents(); } catch {}
    const events = mergeEvents(serverEvents, getLocalEvents()).filter(e => isToday(e.timestamp));

    showModal(`
        <div class="modal-inner">
            <h2>Today's Scans</h2>
            <p>${events.length} scan event(s) recorded today.</p>
            <div class="modal-list">
                ${events.length ? events.slice(0,30).map(e => `
                    <div class="modal-row" style="cursor:pointer" data-event-id="${escapeHtml(e.id)}">
                        <div><b>${escapeHtml(e.status)}</b><br><span>${escapeHtml(e.timestamp)} • ${escapeHtml(e.mode)}</span></div>
                        <div><b>${Number(e.threat_score).toFixed(1)}</b><br><span>${escapeHtml(e.target)}</span></div>
                    </div>
                `).join("") : `<div class="modal-row"><span>No scans today.</span><b>00</b></div>`}
            </div>
        </div>
    `);

    document.querySelectorAll("[data-event-id]").forEach(row => {
        row.addEventListener("click", () => {
            const id = row.dataset.eventId;
            const event = events.find(e => String(e.id) === id);
            showEventDetails(event);
        });
    });
}

async function showThreats() {
    let serverEvents = [];
    try { serverEvents = await fetchServerEvents(); } catch {}
    const events = mergeEvents(serverEvents, getLocalEvents())
        .filter(e => isToday(e.timestamp))
        .filter(e => e.status === "Suspicious" || e.status === "High-Risk");

    showModal(`
        <div class="modal-inner">
            <h2>Threats Flagged Today</h2>
            <p>Suspicious and High-Risk events requiring attention.</p>
            <div class="modal-list">
                ${events.length ? events.slice(0,30).map(e => `
                    <div class="modal-row" style="cursor:pointer" data-threat-id="${escapeHtml(e.id)}">
                        <div><b>${escapeHtml(e.status)}</b><br><span>${escapeHtml(e.timestamp)} • ${escapeHtml(e.mode)}</span></div>
                        <div><b>${Number(e.threat_score).toFixed(1)}</b><br><span>${escapeHtml(e.target)}</span></div>
                    </div>
                `).join("") : `<div class="modal-row"><span>No threats flagged today.</span><b>00</b></div>`}
            </div>
        </div>
    `);

    document.querySelectorAll("[data-threat-id]").forEach(row => {
        row.addEventListener("click", () => {
            const id = row.dataset.threatId;
            const event = events.find(e => String(e.id) === id);
            showEventDetails(event);
        });
    });
}

async function verifyRobot() {
    const mode = $("modeSelect").value;
    const target = $("targetSelect").value;

    try {
        const response = await fetch("/api/robot", {
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({mode, target, scenario:"suspicious"})
        });
        const data = await response.json();

        if (!data.ok) throw new Error("Robot failed");

        updateDashboard(data.event);
        showToast("Quadruped verification completed.");
        await refreshAll();
    } catch {
        const event = createOfflineEvent({
            mode: "Under-Coach",
            target,
            scenario: "suspicious"
        });
        event.device_id = "RS-QD-01";
        saveOfflineEvent(event);
        updateDashboard(event);
        showToast("Quadruped verification completed in local mode.");
        await refreshAll();
    }
}

async function syncEvents() {
    if (!offlineMode) {
        try {
            const response = await fetch("/api/sync", {method:"POST"});
            const data = await response.json();
            $("offlineStatus").textContent = `${data.synced} stored server event(s) synced.`;
            showToast("Server sync complete.");
            await refreshAll();
            return;
        } catch {}
    }

    const localEvents = getLocalEvents();
    if (!localEvents.length) {
        $("offlineStatus").textContent = "No locally stored events.";
        showToast("Nothing to sync.");
        return;
    }

    if (navigator.onLine) {
        // Re-submit local events so the demo preserves the event flow.
        for (const e of localEvents) {
            try {
                await fetch("/api/scan", {
                    method:"POST",
                    headers:{"Content-Type":"application/json"},
                    body:JSON.stringify({
                        scenario: e.status === "High-Risk" ? "high-risk" :
                                  e.status === "Suspicious" ? "suspicious" : "normal",
                        mode:e.mode,
                        target:e.target
                    })
                });
            } catch {}
        }
        localStorage.removeItem("rakshaOfflineEvents");
        offlineMode = false;
        setConnectionState();
        $("offlineStatus").textContent = "Local events synced to server.";
        showToast("Offline events synced.");
        await refreshAll();
    } else {
        $("offlineStatus").textContent = "Network unavailable. Events remain safely local.";
        showToast("Still offline.");
    }
}

async function clearLog() {
    if (!confirm("Clear all server event logs and local demo events?")) return;

    try {
        await fetch("/api/clear", {method:"POST"});
    } catch {}

    localStorage.removeItem("rakshaOfflineEvents");
    latestEvent = null;

    $("latestContent").innerHTML = `
        <div class="empty-state">
            <b>No detection yet</b>
            <span>Run a scan to populate this panel.</span>
        </div>
    `;
    $("deviceStatus").textContent = "READY";
    $("deviceScore").textContent = "--";
    $("deviceBar").style.width = "0%";
    $("threatScore").textContent = "--";
    $("threatMeter").style.width = "0%";
    $("currentRisk").textContent = "NORMAL";
    $("currentRiskScore").textContent = "No active alert";
    $("gpsValue").textContent = "Waiting...";
    $("mapStatus").textContent = "Waiting for detection...";

    if (mapMarker && map) {
        map.removeLayer(mapMarker);
        mapMarker = null;
    }
    if (map) map.setView([28.6139,77.2090],16);

    await refreshAll();
    showToast("Event log cleared.");
}

function toggleOffline() {
    offlineMode = !offlineMode;
    setConnectionState();
    $("offlineStatus").textContent = offlineMode
        ? "Offline mode active. New events will be stored locally."
        : "Online mode active. Server sync available.";
    showToast(offlineMode ? "Offline-first mode ON." : "Online mode ON.");
}

$("runScan").addEventListener("click", runScan);

document.querySelectorAll(".scenario-btn").forEach(btn => {
    btn.addEventListener("click", () => setScenario(btn.dataset.scenario));
});

$("activeDevicesCard").addEventListener("click", showDevices);
$("todayScansCard").addEventListener("click", showTodayScans);
$("threatsCard").addEventListener("click", showThreats);
$("viewDevices").addEventListener("click", showDevices);
$("viewLatest").addEventListener("click", () => showEventDetails(latestEvent));
$("refreshLog").addEventListener("click", refreshAll);
$("verifyRobot").addEventListener("click", verifyRobot);
$("syncBtn").addEventListener("click", syncEvents);
$("offlineBtn").addEventListener("click", toggleOffline);
$("clearBtn").addEventListener("click", clearLog);
$("modalClose").addEventListener("click", closeModal);
$("modalBackdrop").addEventListener("click", (e) => {
    if (e.target === $("modalBackdrop")) closeModal();
});
$("centerMap").addEventListener("click", () => {
    if (map) map.setView(lastMapPosition, 17, {animate:true});
});

window.addEventListener("online", () => {
    if (offlineMode) {
        $("offlineStatus").textContent = "Connection restored. You can sync stored events.";
    }
});

window.addEventListener("offline", () => {
    offlineMode = true;
    setConnectionState();
    $("offlineStatus").textContent = "Browser is offline. Local storage mode active.";
});

setupMap();
setConnectionState();
refreshAll();
