"""Add or replace one vehicle in game/src/vehicles/catalogue.json, under a file lock.

Several car-modelling agents work at once and the catalogue is one file: without a lock the last
writer silently drops everyone else's car. Usage: python3 tools/catalogue_put.py <entry.json>"""
import fcntl
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "game", "src", "vehicles", "catalogue.json")


def put(entry):
    with open(PATH + ".lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        data = json.load(open(PATH, encoding="utf-8"))
        data["vehicles"] = [v for v in data["vehicles"] if v["id"] != entry["id"]] + [entry]
        with open(PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        fcntl.flock(lock, fcntl.LOCK_UN)


if __name__ == "__main__":
    put(json.load(open(sys.argv[1], encoding="utf-8")))
    print("catalogue: put", json.load(open(sys.argv[1]))["id"])
