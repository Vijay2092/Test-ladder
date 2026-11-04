#!/usr/bin/env python3
"""Merge the per-OS qa_state.json files into results/<run_key>.json."""
import glob, json, os, sys
key, cfg = sys.argv[1], json.loads(os.environ.get("QA_CONFIG", "{}"))
devices, plays = [], []
for f in sorted(glob.glob("collected/**/*.json", recursive=True)):
    try:
        s = json.load(open(f))
    except Exception:
        continue
    devices += s.get("devices", [])
    plays += s.get("plays", [])
os.makedirs("results", exist_ok=True)
out = {"run_key": key, "config": cfg, "devices": devices, "plays": plays}
json.dump(out, open(f"results/{key}.json", "w"))
print(f"{len(devices)} device tests, {len(plays)} playback runs")
