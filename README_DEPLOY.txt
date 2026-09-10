# RAKSHA-SCAN Flask Prototype

## Run locally

PowerShell / CMD:

python -m pip install -r requirements.txt
python app.py

Open:
http://127.0.0.1:5000

## Main features

- Handheld + Quadruped concept dashboard
- Narcotics + Explosives detection target
- Railway modes: Platform, Luggage, Coach, Yard, Under-Coach
- Selectable NORMAL / SUSPICIOUS / HIGH-RISK demo outcomes
- Real Leaflet/OpenStreetMap map
- GPS + timestamp + device ID event details
- Today's Scans modal with clickable details
- Threats Flagged modal with clickable details
- Active Devices modal
- Quadruped verification
- Offline-first localStorage demo mode
- Server SQLite event log
- Render deployment files included

## Prototype boundary

The sensing values and risk scores are demonstration/surrogate values.
They do not claim certified identification of real explosives or narcotics.
For operational deployment, the modular sensing bay should use certified
trace-detection modules and validated models.

## Render

Push this folder to GitHub and create a Render Web Service.
The included Procfile/render.yaml use:

gunicorn app:app

SQLite is suitable for the prototype/demo only. Render's default filesystem
is not a durable database across all restarts/redeployments.
