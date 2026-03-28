#!/usr/bin/env python3
"""
Generate mock timetable JSON files for Tokyo railway lines.

Reads the station centerpoints JSON, computes inter-station distances,
and generates trains at realistic intervals with computed travel times.

Output: 3 JSON files in public/data/
  - tokyo_metro_timetable.json
  - toei_timetable.json
  - jr_yamanote_timetable.json
"""

import json
import math
import re
import sys
from pathlib import Path

# Paths
SCRIPT_DIR = Path(__file__).parent
STATION_JSON = SCRIPT_DIR / "tokyo_rail_stations_centerpoints.json"
OUTPUT_DIR = SCRIPT_DIR.parent.parent / "public" / "data"

# Tokyo latitude for degree-to-meter conversion
DEG_TO_M_LAT = 111_000
DEG_TO_M_LON = 111_000 * math.cos(math.radians(35.68))

# Tokyo 23 wards bounding box
BOUNDS_LAT = (35.53, 35.82)
BOUNDS_LON = (139.56, 139.92)

# Target lines grouped by output file
LINE_GROUPS = {
    "tokyo_metro_timetable.json": [
        "TokyoMetro.Ginza",
        "TokyoMetro.Marunouchi",
        "TokyoMetro.MarunouchiBranch",
        "TokyoMetro.Hibiya",
        "TokyoMetro.Tozai",
        "TokyoMetro.Chiyoda",
        "TokyoMetro.Yurakucho",
        "TokyoMetro.Hanzomon",
        "TokyoMetro.Namboku",
        "TokyoMetro.Fukutoshin",
    ],
    "toei_timetable.json": [
        "Toei.Asakusa",
        "Toei.Mita",
        "Toei.Shinjuku",
        "Toei.Oedo",
    ],
    "jr_yamanote_timetable.json": [
        "JR-East.Yamanote",
    ],
}

LOOP_LINES = {"JR-East.Yamanote", "Toei.Oedo"}

# Headway in seconds by time-of-day period
HEADWAYS = [
    # (start_hour, end_hour, headway_sec)
    (5, 6, 8 * 60),     # early morning: 8 min
    (6, 9, 3 * 60),     # morning rush: 3 min
    (9, 17, 5 * 60),    # daytime: 5 min
    (17, 20, 3 * 60),   # evening rush: 3 min
    (20, 23, 6 * 60),   # evening: 6 min
    (23, 25, 10 * 60),  # late night: 10 min (25 = 01:00 next day)
]

# Average speed in m/s (including dwell approximation)
AVG_SPEED_MPS = 12.0  # ~43 km/h including stops
DWELL_SEC = 30  # seconds stopped at each station


def short_code_sort_key(code: str) -> int:
    """Extract trailing numeric part for sorting, matching TS shortCodeSortKey."""
    m = re.search(r"(\d+)\s*$", code)
    return int(m.group(1)) if m else 9999


def haversine_m(lat1, lon1, lat2, lon2):
    """Approximate distance in meters between two points."""
    dlat = (lat2 - lat1) * DEG_TO_M_LAT
    dlon = (lon2 - lon1) * DEG_TO_M_LON
    return math.sqrt(dlat**2 + dlon**2)


def get_headway(hour: int) -> int:
    """Get headway in seconds for a given hour (0-24+)."""
    for start, end, headway in HEADWAYS:
        if start <= hour < end:
            return headway
    return 10 * 60  # fallback


def build_line_stations(stations_data, target_line_code):
    """
    Extract ordered station list for a given line_code.
    Returns list of {short_code, station_name, lat, lon, elev}.
    """
    raw = []
    for st in stations_data:
        lat, lon = st["center_point"]["lat"], st["center_point"]["lon"]
        if not (BOUNDS_LAT[0] <= lat <= BOUNDS_LAT[1] and
                BOUNDS_LON[0] <= lon <= BOUNDS_LON[1]):
            continue

        for route in st["routes"]:
            if route.get("line_code") != target_line_code:
                continue
            if not route.get("short_code"):
                continue
            elev = st.get("station_elevation_m") or st.get("elevation_m") or 0
            raw.append({
                "short_code": route["short_code"],
                "station_name": st["station_name"],
                "lat": lat,
                "lon": lon,
                "elev": elev,
            })

    # Sort and deduplicate
    raw.sort(key=lambda x: short_code_sort_key(x["short_code"]))
    deduped = []
    for s in raw:
        if not deduped or deduped[-1]["short_code"] != s["short_code"]:
            deduped.append(s)

    return deduped


def compute_travel_times(stations):
    """
    Compute cumulative travel time from station 0 to each subsequent station.
    Returns list of cumulative seconds.
    """
    times = [0]
    for i in range(1, len(stations)):
        prev, curr = stations[i - 1], stations[i]
        dist = haversine_m(prev["lat"], prev["lon"], curr["lat"], curr["lon"])
        travel = dist / AVG_SPEED_MPS + DWELL_SEC
        times.append(times[-1] + int(travel))
    return times


def generate_trains_for_direction(station_sequence, travel_times, direction_id):
    """
    Generate trains for one direction of a line.
    Returns list of train dicts.
    """
    trains = []
    train_counter = 0
    total_travel = travel_times[-1]

    # Generate departures from 05:00 to 01:00 next day
    current_sec = 5 * 3600  # 05:00
    end_sec = 25 * 3600     # 01:00 next day

    while current_sec < end_sec:
        hour = current_sec // 3600
        headway = get_headway(hour)

        train_counter += 1
        train_id = f"D{direction_id}-{train_counter:04d}"

        stops = []
        for j, sc in enumerate(station_sequence):
            stops.append({
                "short_code": sc,
                "departure_sec": current_sec + travel_times[j],
            })

        # Only include if the train finishes within a reasonable window
        if stops[-1]["departure_sec"] < end_sec + total_travel:
            trains.append({
                "train_id": train_id,
                "stops": stops,
            })

        current_sec += headway

    return trains


def generate_line_timetable(stations_data, line_code):
    """Generate timetable for a single line (both directions)."""
    stations = build_line_stations(stations_data, line_code)
    if len(stations) < 2:
        print(f"  WARNING: {line_code} has <2 stations, skipping")
        return None

    station_sequence = [s["short_code"] for s in stations]
    travel_times = compute_travel_times(stations)

    is_loop = line_code in LOOP_LINES

    directions = []

    # Direction 0: ascending order (as sorted)
    trains_0 = generate_trains_for_direction(station_sequence, travel_times, 0)
    directions.append({
        "direction_id": 0,
        "station_sequence": station_sequence,
        "trains": trains_0,
    })

    if is_loop:
        # For loop lines, direction 1 is the same sequence in reverse
        rev_sequence = list(reversed(station_sequence))
        rev_stations = list(reversed(stations))
        rev_travel_times = compute_travel_times(rev_stations)
        trains_1 = generate_trains_for_direction(rev_sequence, rev_travel_times, 1)
        directions.append({
            "direction_id": 1,
            "station_sequence": rev_sequence,
            "trains": trains_1,
        })
    else:
        # For non-loop lines, direction 1 is reversed
        rev_sequence = list(reversed(station_sequence))
        rev_stations = list(reversed(stations))
        rev_travel_times = compute_travel_times(rev_stations)
        trains_1 = generate_trains_for_direction(rev_sequence, rev_travel_times, 1)
        directions.append({
            "direction_id": 1,
            "station_sequence": rev_sequence,
            "trains": trains_1,
        })

    return {
        "line_code": line_code,
        "directions": directions,
    }


def main():
    # Load station data
    if not STATION_JSON.exists():
        print(f"ERROR: Station JSON not found at {STATION_JSON}")
        sys.exit(1)

    with open(STATION_JSON) as f:
        stations_data = json.load(f)
    print(f"Loaded {len(stations_data)} stations")

    # Generate timetable for each group
    for filename, line_codes in LINE_GROUPS.items():
        print(f"\nGenerating {filename}...")
        lines = []
        for lc in line_codes:
            print(f"  Processing {lc}...")
            result = generate_line_timetable(stations_data, lc)
            if result:
                lines.append(result)
                total_trains = sum(len(d["trains"]) for d in result["directions"])
                n_stations = len(result["directions"][0]["station_sequence"])
                print(f"    {n_stations} stations, {total_trains} trains")

        output = {"lines": lines}
        output_path = OUTPUT_DIR / filename
        with open(output_path, "w") as f:
            json.dump(output, f, ensure_ascii=False)

        size_kb = output_path.stat().st_size / 1024
        print(f"  Written: {output_path} ({size_kb:.1f} KB)")

    print("\nDone!")


if __name__ == "__main__":
    main()
