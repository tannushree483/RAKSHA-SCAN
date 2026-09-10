import os
import random
import sqlite3
from datetime import datetime

from flask import Flask, jsonify, render_template, request

app = Flask(__name__)
DB_PATH = os.path.join(os.path.dirname(__file__), "raksha_scan.db")

LOCATION_MAP = {
    "Platform": (28.6139, 77.2090),
    "Luggage": (28.6148, 77.2080),
    "Coach": (28.6155, 77.2070),
    "Yard": (28.6170, 77.2050),
    "Under-Coach": (28.6182, 77.2035),
}

SCENARIOS = {
    "normal": {
        "label": "Normal",
        "score": (8, 24),
        "temperature": (27.5, 29.5),
        "humidity": (58, 64),
        "gas": "LOW",
        "signal": "LOW",
    },
    "suspicious": {
        "label": "Suspicious",
        "score": (52, 69),
        "temperature": (33, 36.5),
        "humidity": (67, 73),
        "gas": "ELEVATED",
        "signal": "MEDIUM",
    },
    "high-risk": {
        "label": "High-Risk",
        "score": (82, 98),
        "temperature": (42, 47),
        "humidity": (76, 83),
        "gas": "HIGH",
        "signal": "HIGH",
    },
}


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            mode TEXT NOT NULL,
            target TEXT NOT NULL,
            status TEXT NOT NULL,
            threat_score REAL NOT NULL,
            temperature REAL NOT NULL,
            humidity REAL NOT NULL,
            gas_level TEXT NOT NULL,
            signal_level TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            timestamp TEXT NOT NULL,
            synced INTEGER DEFAULT 1
        )
    """)
    conn.commit()
    conn.close()


def now_local_string():
    return datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S")


def make_event(scenario="normal", mode="Platform", target="Narcotics + Explosives"):
    scenario = scenario if scenario in SCENARIOS else "normal"
    mode = mode if mode in LOCATION_MAP else "Platform"
    profile = SCENARIOS[scenario]

    lat, lon = LOCATION_MAP[mode]
    # Small variation keeps the map realistic while remaining around the selected railway mode.
    lat += random.uniform(-0.00035, 0.00035)
    lon += random.uniform(-0.00035, 0.00035)

    return {
        "device_id": "RS-HH-01",
        "mode": mode,
        "target": target,
        "status": profile["label"],
        "threat_score": round(random.uniform(*profile["score"]), 1),
        "temperature": round(random.uniform(*profile["temperature"]), 1),
        "humidity": round(random.uniform(*profile["humidity"]), 1),
        "gas_level": profile["gas"],
        "signal_level": profile["signal"],
        "latitude": round(lat, 6),
        "longitude": round(lon, 6),
        "timestamp": now_local_string(),
        "synced": 1,
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.post("/api/scan")
def api_scan():
    data = request.get_json(silent=True) or {}
    scenario = data.get("scenario", "normal")
    mode = data.get("mode", "Platform")
    target = data.get("target", "Narcotics + Explosives")

    event = make_event(scenario, mode, target)

    conn = get_db()
    cur = conn.execute("""
        INSERT INTO events (
            device_id, mode, target, status, threat_score,
            temperature, humidity, gas_level, signal_level,
            latitude, longitude, timestamp, synced
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        event["device_id"], event["mode"], event["target"], event["status"],
        event["threat_score"], event["temperature"], event["humidity"],
        event["gas_level"], event["signal_level"], event["latitude"],
        event["longitude"], event["timestamp"], event["synced"]
    ))
    event["id"] = cur.lastrowid
    conn.commit()
    conn.close()

    return jsonify({"ok": True, "event": event})


@app.get("/api/events")
def api_events():
    conn = get_db()
    rows = conn.execute("""
        SELECT * FROM events
        ORDER BY id DESC
        LIMIT 100
    """).fetchall()
    conn.close()
    return jsonify([dict(row) for row in rows])


@app.get("/api/stats")
def api_stats():
    # Events are stored using the server's local timestamp. Render runs in UTC,
    # while the dashboard is intended for Indian Railways (IST). Calculate the
    # current IST day and convert its boundaries to UTC for reliable counting.
    from datetime import timezone, timedelta

    ist = timezone(timedelta(hours=5, minutes=30))
    now_ist = datetime.now(ist)
    start_ist = now_ist.replace(hour=0, minute=0, second=0, microsecond=0)
    next_ist = start_ist + timedelta(days=1)
    start_utc = start_ist.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    next_utc = next_ist.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    conn = get_db()
    today = conn.execute("""
        SELECT COUNT(*) AS c FROM events
        WHERE timestamp >= ? AND timestamp < ?
    """, (start_utc, next_utc)).fetchone()["c"]
    threats = conn.execute("""
        SELECT COUNT(*) AS c FROM events
        WHERE timestamp >= ? AND timestamp < ?
          AND status IN ('Suspicious', 'High-Risk')
    """, (start_utc, next_utc)).fetchone()["c"]
    high_risk = conn.execute("""
        SELECT COUNT(*) AS c FROM events
        WHERE timestamp >= ? AND timestamp < ?
          AND status = 'High-Risk'
    """, (start_utc, next_utc)).fetchone()["c"]
    latest = conn.execute("""
        SELECT * FROM events ORDER BY id DESC LIMIT 1
    """).fetchone()
    conn.close()

    return jsonify({
        "active_devices": 2,
        "today_scans": today,
        "threats_flagged": threats,
        "high_risk": high_risk,
        "current_risk": dict(latest) if latest else None
    })


@app.get("/api/devices")
def api_devices():
    return jsonify([
        {
            "device_id": "RS-HH-01",
            "type": "Handheld",
            "status": "ONLINE",
            "battery": 87,
            "signal": "GOOD",
            "location": "Platform"
        },
        {
            "device_id": "RS-QD-01",
            "type": "Quadruped",
            "status": "STANDBY",
            "battery": 76,
            "signal": "GOOD",
            "location": "Yard"
        }
    ])


@app.post("/api/robot")
def api_robot():
    data = request.get_json(silent=True) or {}
    mode = data.get("mode", "Under-Coach")
    target = data.get("target", "Narcotics + Explosives")
    scenario = data.get("scenario", "suspicious")

    if mode not in LOCATION_MAP:
        mode = "Under-Coach"

    # Robot verification is intentionally a second-stage inspection.
    event = make_event(scenario, mode, target)
    event["device_id"] = "RS-QD-01"

    return jsonify({
        "ok": True,
        "message": "Quadruped verification completed.",
        "event": event
    })


@app.post("/api/offline")
def api_offline():
    return jsonify({"ok": True, "message": "Offline-first mode acknowledged."})


@app.post("/api/sync")
def api_sync():
    conn = get_db()
    cur = conn.execute("UPDATE events SET synced = 1 WHERE synced = 0")
    synced_count = cur.rowcount
    conn.commit()
    conn.close()
    return jsonify({"ok": True, "synced": synced_count})


@app.post("/api/clear")
def api_clear():
    conn = get_db()
    conn.execute("DELETE FROM events")
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


init_db()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
