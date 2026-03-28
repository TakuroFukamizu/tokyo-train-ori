#!/usr/bin/env python3
"""
Generate mock timetable JSON files for Tokyo railway lines.

Reads the station centerpoints JSON, computes inter-station distances,
and generates trains at realistic intervals with computed travel times.

Output: 5 JSON files in public/data/

For Toei subway lines (Asakusa, Mita, Shinjuku, Oedo), real timetable data is
fetched from the ODPT public API (https://api-public.odpt.org/api/v4/).
Other lines use pseudo-generated timetables.
  - tokyo_metro_timetable.json
  - toei_timetable.json
  - jr_timetable.json
  - private_railway_timetable.json
  - other_timetable.json
"""

import json
import math
import re
import sys
import urllib.request
import urllib.error
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
        "Toei.Arakawa",
        "Toei.NipporiToneri",
    ],
    "jr_timetable.json": [
        "JR-East.Yamanote",
        "JR-East.ChuoRapid",
        "JR-East.ChuoSobuLocal",
        "JR-East.KeihinTohokuNegishi",
        "JR-East.Keiyo",
        "JR-East.SaikyoKawagoe",
        "JR-East.ShonanShinjuku",
        "JR-East.JobanRapid",
        "JR-East.JobanLocal",
        "JR-East.Tokaido",
        "JR-East.Yokosuka",
        "JR-East.SobuRapid",
        "JR-East.Takasaki",
        "JR-East.Utsunomiya",
    ],
    "private_railway_timetable.json": [
        "Odakyu.Odawara",
        "Keio.Keio",
        "Keio.KeioNew",
        "Keio.Inokashira",
        "Seibu.Ikebukuro",
        "Seibu.Shinjuku",
        "Seibu.SeibuYurakucho",
        "Seibu.Toshima",
        "Tobu.TobuSkytree",
        "Tobu.TobuSkytreeBranch",
        "Tobu.Tojo",
        "Tobu.Kameido",
        "Tobu.Daishi",
        "Keikyu.Main",
        "Keikyu.Airport",
        "Keisei.Main",
        "Keisei.Oshiage",
        "Keisei.Kanamachi",
    ],
    "other_timetable.json": [
        "TWR.Rinkai",
        "Yurikamome.Yurikamome",
    ],
}

LOOP_LINES = {"JR-East.Yamanote", "Toei.Oedo"}

# Toei lines that use ODPT real timetable data
TOEI_LINES = {"Toei.Asakusa", "Toei.Mita", "Toei.Shinjuku", "Toei.Oedo"}

# ODPT API base URL (no auth required)
ODPT_API_BASE = "https://api-public.odpt.org/api/v4"

# Direction mapping: ODPT railDirection URI suffix -> direction_id
# ascending direction (Northbound, Eastbound, OuterLoop) -> direction_id 0
# descending direction (Southbound, Westbound, InnerLoop) -> direction_id 1
DIRECTION_MAP = {
    "Northbound": 0,
    "Eastbound": 0,
    "OuterLoop": 0,
    "Southbound": 1,
    "Westbound": 1,
    "InnerLoop": 1,
}

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


def fetch_odpt_json(path: str) -> list:
    """
    Fetch JSON from ODPT public API. Returns parsed list or raises on error.
    path should start with '/' e.g. '/odpt:Station?odpt:operator=...'
    """
    url = ODPT_API_BASE + path
    print(f"    Fetching: {url}")
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read().decode("utf-8")
    return json.loads(raw)


def fetch_odpt_stations() -> tuple:
    """
    Fetch all Toei station data from ODPT API.
    Returns:
        station_map: dict station_uri -> short_code
            e.g. "odpt.Station:Toei.Asakusa.Sengakuji" -> "A-02"
        station_name_map: dict short_code -> station_name (ja)
            e.g. "A-02" -> "泉岳寺"
    """
    data = fetch_odpt_json("/odpt:Station?odpt:operator=odpt.Operator:Toei")
    print(f"    Got {len(data)} Toei stations from ODPT")
    station_map = {}
    station_name_map = {}
    for s in data:
        uri = s.get("owl:sameAs", "")
        code = s.get("odpt:stationCode", "")
        # Prefer Japanese station title
        title = (s.get("odpt:stationTitle") or {}).get("ja") or s.get("dc:title", "")
        if uri and code:
            station_map[uri] = code
            if title and code not in station_name_map:
                station_name_map[code] = title
    return station_map, station_name_map


def fetch_odpt_railway(line_code: str) -> tuple:
    """
    Fetch station order and line name for a Toei line from ODPT Railway API.
    line_code: e.g. "Toei.Asakusa"
    Returns:
        station_uris: list of station URIs in ascending order (index 1, 2, 3, ...)
        line_name: Japanese line name from railwayTitle.ja (or line_code as fallback)
    """
    path = f"/odpt:Railway?owl:sameAs=odpt.Railway:{line_code}"
    data = fetch_odpt_json(path)
    if not data:
        print(f"    WARNING: No railway data found for {line_code}")
        return [], line_code
    railway = data[0]
    station_order = railway.get("odpt:stationOrder", [])
    # Sort by index to ensure ascending order
    station_order_sorted = sorted(station_order, key=lambda x: x.get("odpt:index", 0))
    station_uris = [s["odpt:station"] for s in station_order_sorted]
    # Extract Japanese line name
    railway_title = railway.get("odpt:railwayTitle") or {}
    line_name = railway_title.get("ja") or railway.get("dc:title") or line_code
    return station_uris, line_name


def fetch_odpt_timetable(line_code: str) -> list:
    """
    Fetch weekday train timetables for a Toei line from ODPT TrainTimetable API.
    line_code: e.g. "Toei.Asakusa"
    Returns raw list of timetable objects.
    """
    path = (
        f"/odpt:TrainTimetable"
        f"?odpt:operator=odpt.Operator:Toei"
        f"&odpt:railway=odpt.Railway:{line_code}"
        f"&odpt:calendar=odpt.Calendar:Weekday"
    )
    data = fetch_odpt_json(path)
    print(f"    Got {len(data)} trains for {line_code} (Weekday)")
    return data


def parse_time_sec(time_str: str) -> int:
    """
    Parse ODPT time string "HH:MM" to seconds since midnight.
    Handles times >= 24:00 (e.g. "24:30" = next day 00:30).
    """
    parts = time_str.split(":")
    hour = int(parts[0])
    minute = int(parts[1])
    return hour * 3600 + minute * 60


def get_direction_id(rail_direction_uri: str) -> int:
    """
    Map ODPT railDirection URI to direction_id (0 or 1).
    URI format: "odpt.RailDirection:Southbound" or "odpt.RailDirection:OuterLoop"
    Unrecognized directions default to 0.
    """
    # Extract the suffix after the last colon
    suffix = rail_direction_uri.split(":")[-1] if ":" in rail_direction_uri else rail_direction_uri
    return DIRECTION_MAP.get(suffix, 0)


def convert_odpt_timetable(
    line_code: str,
    line_name: str,
    timetable_data: list,
    station_map: dict,
    station_name_map: dict,
    station_order_ascending: list,
    existing_stations_data: list,
) -> dict:
    """
    Convert ODPT TrainTimetable data to the app's timetable format.

    line_name: Japanese line name (e.g. "都営浅草線")
    station_name_map: dict short_code -> station_name (ja) for terminal lookup
    existing_stations_data: raw station data from tokyo_rail_stations_centerpoints.json
    Used to filter short_codes to only those present in existing data (Tokyo 23-ward stations).
    Stations outside 23 wards (e.g. S-21 Motoyawata) are excluded.

    Returns dict matching the existing timetable JSON format:
    {
        "line_code": "Toei.Asakusa",
        "line_name": "都営浅草線",
        "directions": [
            {
                "direction_id": 0,
                "station_sequence": ["A-01", ...],
                "trains": [{"train_id": "...", "terminal": "...", "stops": [...]}]
            },
            ...
        ]
    }
    """
    # Build set of valid short_codes from existing station data (only 23-ward stations)
    valid_short_codes = set()
    for st in existing_stations_data:
        lat, lon = st["center_point"]["lat"], st["center_point"]["lon"]
        if not (BOUNDS_LAT[0] <= lat <= BOUNDS_LAT[1] and
                BOUNDS_LON[0] <= lon <= BOUNDS_LON[1]):
            continue
        for route in st.get("routes", []):
            code = route.get("short_code")
            if code:
                valid_short_codes.add(code)
    print(f"    Valid short_codes from existing data: {len(valid_short_codes)} stations")

    # Convert station_order URIs to short_codes (filtering unknowns)
    def uri_list_to_codes(uri_list):
        codes = []
        for uri in uri_list:
            code = station_map.get(uri)
            if code and code in valid_short_codes:
                codes.append(code)
        return codes

    seq_ascending = uri_list_to_codes(station_order_ascending)
    seq_descending = list(reversed(seq_ascending))

    print(f"    {line_code}: ascending={len(seq_ascending)} stations, descending={len(seq_descending)} stations")

    # Group trains by direction
    trains_by_dir = {0: [], 1: []}

    for train_data in timetable_data:
        rail_dir = train_data.get("odpt:railDirection", "")
        direction_id = get_direction_id(rail_dir)
        train_number = train_data.get("odpt:trainNumber", "unknown")
        train_id = f"{train_number}-D{direction_id}"

        timetable_obj = train_data.get("odpt:trainTimetableObject", [])
        stops = []

        for stop in timetable_obj:
            # Determine station URI: prefer departureStation, fall back to arrivalStation
            station_uri = stop.get("odpt:departureStation") or stop.get("odpt:arrivalStation")
            if not station_uri:
                continue

            short_code = station_map.get(station_uri)
            if not short_code:
                continue
            if short_code not in valid_short_codes:
                # Station outside 23 wards (e.g. S-21 Motoyawata)
                continue

            # Determine time: prefer departureTime, fall back to arrivalTime
            time_str = stop.get("odpt:departureTime") or stop.get("odpt:arrivalTime")
            if not time_str:
                continue

            departure_sec = parse_time_sec(time_str)
            stops.append({
                "short_code": short_code,
                "departure_sec": departure_sec,
            })

        # Fix midnight crossing: if departure_sec decreases, add 86400 (next day)
        for i in range(1, len(stops)):
            if stops[i]["departure_sec"] < stops[i - 1]["departure_sec"]:
                for j in range(i, len(stops)):
                    stops[j]["departure_sec"] += 86400

        if len(stops) >= 2:
            # Determine terminal: use odpt:destinationStation if available,
            # else use the last stop in this train's stop list
            dest_uris = train_data.get("odpt:destinationStation") or []
            terminal_name = None
            for dest_uri in dest_uris:
                dest_code = station_map.get(dest_uri)
                if dest_code and dest_code in station_name_map:
                    terminal_name = station_name_map[dest_code]
                    break
            if terminal_name is None:
                # Fall back to last stop's station name
                last_code = stops[-1]["short_code"]
                terminal_name = station_name_map.get(last_code, last_code)

            trains_by_dir[direction_id].append({
                "train_id": train_id,
                "terminal": terminal_name,
                "stops": stops,
            })

    # Sort trains within each direction by first stop departure_sec
    for direction_id in trains_by_dir:
        trains_by_dir[direction_id].sort(
            key=lambda t: t["stops"][0]["departure_sec"] if t["stops"] else 0
        )

    directions = []
    for direction_id in [0, 1]:
        seq = seq_ascending if direction_id == 0 else seq_descending
        trains = trains_by_dir[direction_id]
        print(f"    direction {direction_id}: {len(trains)} trains, {len(seq)} stations in sequence")
        directions.append({
            "direction_id": direction_id,
            "station_sequence": seq,
            "trains": trains,
        })

    return {
        "line_code": line_code,
        "line_name": line_name,
        "directions": directions,
    }


def generate_toei_line_timetable(stations_data, line_code: str, station_map: dict, station_name_map: dict) -> dict:
    """
    Generate timetable for a Toei line using ODPT real data.
    Falls back to pseudo-generation on API error.
    """
    try:
        station_order, odpt_line_name = fetch_odpt_railway(line_code)
        if not station_order:
            raise ValueError(f"Empty station order for {line_code}")

        timetable_data = fetch_odpt_timetable(line_code)
        if not timetable_data:
            raise ValueError(f"Empty timetable for {line_code}")

        result = convert_odpt_timetable(
            line_code, odpt_line_name, timetable_data, station_map, station_name_map,
            station_order, stations_data
        )

        # Validate that we have trains in at least one direction
        total_trains = sum(len(d["trains"]) for d in result["directions"])
        if total_trains == 0:
            raise ValueError(f"No trains converted for {line_code}")

        return result

    except (urllib.error.URLError, ValueError, KeyError, json.JSONDecodeError) as e:
        print(f"  WARNING: ODPT API failed for {line_code}: {e}")
        print(f"  Falling back to pseudo-generated timetable for {line_code}")
        return generate_line_timetable(stations_data, line_code)


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
    Returns (line_name, list of {short_code, station_name, lat, lon, elev}).
    """
    raw = []
    line_name = None
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
            if line_name is None and route.get("line_name"):
                line_name = route["line_name"]
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

    return line_name or target_line_code, deduped


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


def generate_trains_for_direction(station_sequence, stations, travel_times, direction_id):
    """
    Generate trains for one direction of a line.
    Returns list of train dicts.
    """
    trains = []
    train_counter = 0
    total_travel = travel_times[-1]
    terminal_name = stations[-1]["station_name"]

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
                "terminal": terminal_name,
                "stops": stops,
            })

        current_sec += headway

    return trains


def generate_line_timetable(stations_data, line_code):
    """Generate timetable for a single line (both directions)."""
    line_name, stations = build_line_stations(stations_data, line_code)
    if len(stations) < 2:
        print(f"  WARNING: {line_code} has <2 stations, skipping")
        return None

    station_sequence = [s["short_code"] for s in stations]
    travel_times = compute_travel_times(stations)

    directions = []

    # Direction 0: ascending order (as sorted)
    trains_0 = generate_trains_for_direction(station_sequence, stations, travel_times, 0)
    directions.append({
        "direction_id": 0,
        "station_sequence": station_sequence,
        "trains": trains_0,
    })

    # Direction 1: reversed
    rev_sequence = list(reversed(station_sequence))
    rev_stations = list(reversed(stations))
    rev_travel_times = compute_travel_times(rev_stations)
    trains_1 = generate_trains_for_direction(rev_sequence, rev_stations, rev_travel_times, 1)
    directions.append({
        "direction_id": 1,
        "station_sequence": rev_sequence,
        "trains": trains_1,
    })

    return {
        "line_code": line_code,
        "line_name": line_name,
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

    # Pre-fetch ODPT station map for Toei lines (shared across all Toei lines)
    odpt_station_map = None
    odpt_station_name_map = {}
    has_toei_lines = any(
        lc in TOEI_LINES
        for line_codes in LINE_GROUPS.values()
        for lc in line_codes
    )
    if has_toei_lines:
        print("\nFetching Toei station map from ODPT API...")
        try:
            odpt_station_map, odpt_station_name_map = fetch_odpt_stations()
            print(f"  Station map built: {len(odpt_station_map)} entries")
            print(f"  Station name map built: {len(odpt_station_name_map)} entries")
        except (urllib.error.URLError, json.JSONDecodeError) as e:
            print(f"  WARNING: Failed to fetch ODPT station map: {e}")
            print("  Toei lines will use pseudo-generated timetables")

    # Generate timetable for each group
    for filename, line_codes in LINE_GROUPS.items():
        print(f"\nGenerating {filename}...")
        lines = []
        for lc in line_codes:
            print(f"  Processing {lc}...")
            if lc in TOEI_LINES and odpt_station_map is not None:
                print(f"    Using ODPT real timetable data for {lc}")
                result = generate_toei_line_timetable(stations_data, lc, odpt_station_map, odpt_station_name_map)
            else:
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
