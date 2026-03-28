import * as THREE from "three";
import type { StationData, StationRoute } from "./stationFilter";

export type { StationData, StationRoute };

// Tokyo 23 wards bounding box
const BOUNDS = {
  lat: { min: 35.53, max: 35.82 },
  lon: { min: 139.56, max: 139.92 },
  elev: { min: -40, max: 80 },
};

// Meters per degree at Tokyo's latitude (~35.68°)
const DEG_TO_M_LAT = 111_000; // 1° latitude ≈ 111km
const DEG_TO_M_LON = 111_000 * Math.cos((35.68 * Math.PI) / 180); // ≈ 90.1km

// Vertical exaggeration factor (1 = true scale, 100 = 100x exaggerated)
const VERTICAL_EXAGGERATION = 100;

// Real-world spans in meters
const SPAN_NS = (BOUNDS.lat.max - BOUNDS.lat.min) * DEG_TO_M_LAT; // ~32.2km
const SPAN_EW = (BOUNDS.lon.max - BOUNDS.lon.min) * DEG_TO_M_LON; // ~32.4km
const MAX_HORIZONTAL = Math.max(SPAN_NS, SPAN_EW);

// Operator color mapping
const OPERATOR_COLORS: Record<string, number> = {
  "JR-East": 0x21b24b,
  TokyoMetro: 0x149dd1,
  Toei: 0xe85298,
  Odakyu: 0x2b6db2,
  Keio: 0xdd0077,
  Tokyu: 0xff0000,
  Seibu: 0x009cd2,
  Tobu: 0xe44d2a,
  Keikyu: 0xe5171f,
  Keisei: 0x1a3b8a,
  TWR: 0x00a4db,
  Yurikamome: 0x00b4a2,
  TokyoMonorail: 0x00a6bf,
};

// Line-specific colors (official line colors where available)
const LINE_COLORS: Record<string, number> = {
  // Tokyo Metro
  "TokyoMetro.Ginza": 0xff9500,
  "TokyoMetro.Marunouchi": 0xf62e36,
  "TokyoMetro.MarunouchiBranch": 0xf62e36,
  "TokyoMetro.Hibiya": 0xb5b5ac,
  "TokyoMetro.Tozai": 0x009bbf,
  "TokyoMetro.Chiyoda": 0x00bb85,
  "TokyoMetro.Yurakucho": 0xc1a470,
  "TokyoMetro.Hanzomon": 0x8f76d6,
  "TokyoMetro.Namboku": 0x00ac9b,
  "TokyoMetro.Fukutoshin": 0x9c5e31,
  // Toei
  "Toei.Asakusa": 0xe85298,
  "Toei.Mita": 0x0079c2,
  "Toei.Shinjuku": 0x6cbb5a,
  "Toei.Oedo": 0xb6007a,
  "Toei.Arakawa": 0x8b7300,
  "Toei.NipporiToneri": 0xd7c447,
  // JR East
  "JR-East.Yamanote": 0x9acd32,
  "JR-East.ChuoRapid": 0xf15a22,
  "JR-East.ChuoSobuLocal": 0xffd400,
  "JR-East.KeihinTohokuNegishi": 0x00b2e5,
  "JR-East.Keiyo": 0xc9252f,
  "JR-East.SaikyoKawagoe": 0x00ac9a,
  "JR-East.ShonanShinjuku": 0xe86922,
  "JR-East.JobanRapid": 0x007f48,
  "JR-East.JobanLocal": 0x88bf8b,
  "JR-East.Tokaido": 0xf68b1e,
  "JR-East.Yokosuka": 0x0075c2,
  "JR-East.SobuRapid": 0x0075c2,
  "JR-East.Nambu": 0xffd400,
  "JR-East.Musashino": 0xf15a22,
  // Private railways
  "Odakyu.Odawara": 0x2b6db2,
  "Keio.Keio": 0xdd0077,
  "Keio.Inokashira": 0x1d2088,
  "Tokyu.Toyoko": 0xff0000,
  "Tokyu.DenEnToshi": 0x00a040,
  "Seibu.Ikebukuro": 0x009cd2,
  "Seibu.Shinjuku": 0x009cd2,
  "Tobu.TobuSkytree": 0xe44d2a,
  "Tobu.Tojo": 0xe44d2a,
  "TWR.Rinkai": 0x00a4db,
  "Yurikamome.Yurikamome": 0x00b4a2,
  "Keikyu.Main": 0xe5171f,
  "Keikyu.Airport": 0xe5171f,
  "Keisei.Main": 0x1a3b8a,
  "Keisei.Oshiage": 0x1a3b8a,
};

// Line name mapping (Japanese display names)
export const LINE_NAMES: Record<string, string> = {
  "TokyoMetro.Ginza": "銀座線",
  "TokyoMetro.Marunouchi": "丸ノ内線",
  "TokyoMetro.MarunouchiBranch": "丸ノ内線支線",
  "TokyoMetro.Hibiya": "日比谷線",
  "TokyoMetro.Tozai": "東西線",
  "TokyoMetro.Chiyoda": "千代田線",
  "TokyoMetro.Yurakucho": "有楽町線",
  "TokyoMetro.Hanzomon": "半蔵門線",
  "TokyoMetro.Namboku": "南北線",
  "TokyoMetro.Fukutoshin": "副都心線",
  "Toei.Asakusa": "都営浅草線",
  "Toei.Mita": "都営三田線",
  "Toei.Shinjuku": "都営新宿線",
  "Toei.Oedo": "都営大江戸線",
  "Toei.Arakawa": "都電荒川線",
  "Toei.NipporiToneri": "日暮里・舎人ライナー",
  "JR-East.Yamanote": "山手線",
  "JR-East.ChuoRapid": "中央快速線",
  "JR-East.ChuoSobuLocal": "中央・総武各停",
  "JR-East.KeihinTohokuNegishi": "京浜東北・根岸線",
  "JR-East.Keiyo": "京葉線",
  "JR-East.SaikyoKawagoe": "埼京・川越線",
  "JR-East.ShonanShinjuku": "湘南新宿ライン",
  "JR-East.JobanRapid": "常磐快速線",
  "JR-East.JobanLocal": "常磐各停",
  "JR-East.Tokaido": "東海道線",
  "JR-East.Yokosuka": "横須賀線",
  "JR-East.SobuRapid": "総武快速線",
  "JR-East.Nambu": "南武線",
  "JR-East.Musashino": "武蔵野線",
  "Odakyu.Odawara": "小田急小田原線",
  "Keio.Keio": "京王線",
  "Keio.Inokashira": "京王井の頭線",
  "Tokyu.Toyoko": "東急東横線",
  "Tokyu.DenEnToshi": "東急田園都市線",
  "Seibu.Ikebukuro": "西武池袋線",
  "Seibu.Shinjuku": "西武新宿線",
  "Tobu.TobuSkytree": "東武スカイツリーライン",
  "Tobu.Tojo": "東武東上線",
  "TWR.Rinkai": "りんかい線",
  "Yurikamome.Yurikamome": "ゆりかもめ",
  "Keikyu.Main": "京急本線",
  "Keikyu.Airport": "京急空港線",
  "Keisei.Main": "京成本線",
  "Keisei.Oshiage": "京成押上線",
};

export { LINE_COLORS };

// Lines that form a loop (last station connects back to first)
const LOOP_LINES = new Set([
  "JR-East.Yamanote",
  "Toei.Oedo", // 6-shape: E-01 connects to E-28 (都庁前)
]);

function getOperatorColor(routes: StationRoute[]): number {
  for (const r of routes) {
    if (r.operator_code && r.operator_code in OPERATOR_COLORS) {
      return OPERATOR_COLORS[r.operator_code];
    }
  }
  return 0xaaaaaa;
}

function getLineColor(lineCode: string, operatorCode: string | null): number {
  if (lineCode in LINE_COLORS) return LINE_COLORS[lineCode];
  if (operatorCode && operatorCode in OPERATOR_COLORS)
    return OPERATOR_COLORS[operatorCode];
  return 0xaaaaaa;
}

/** Extract numeric sort key from short_code like "M17", "JY01", "E-28", "Mb03" */
function shortCodeSortKey(code: string): number {
  const match = code.match(/(\d+)\s*$/);
  return match ? parseInt(match[1], 10) : 9999;
}

/**
 * Map a station's lat/lon/elevation into the おり's local coordinate space.
 * Coordinates are converted to meters first, then normalized so that the
 * longer horizontal axis spans [-1, 1] and the shorter axis is proportionally
 * smaller, preserving the real aspect ratio.
 * Y (elevation) keeps its own exaggerated scale to remain visible.
 */
function mapToOri(lat: number, lon: number, elev: number): THREE.Vector3 {
  // Convert to meters relative to bounding box center
  const centerLat = (BOUNDS.lat.min + BOUNDS.lat.max) / 2;
  const centerLon = (BOUNDS.lon.min + BOUNDS.lon.max) / 2;
  const mx = (lon - centerLon) * DEG_TO_M_LON;
  const mz = (lat - centerLat) * DEG_TO_M_LAT;

  // Normalize to [-1, 1] using the longer horizontal span
  const x = (mx / MAX_HORIZONTAL) * 2;
  const z = -(mz / MAX_HORIZONTAL) * 2;

  // Elevation: same meter-based scale as horizontal, then exaggerated
  const y = (elev * VERTICAL_EXAGGERATION / MAX_HORIZONTAL) * 2;

  return new THREE.Vector3(x, y, z);
}

function isIn23Wards(station: StationData): boolean {
  const { lat, lon } = station.center_point;
  return (
    lat >= BOUNDS.lat.min &&
    lat <= BOUNDS.lat.max &&
    lon >= BOUNDS.lon.min &&
    lon <= BOUNDS.lon.max
  );
}

export interface RailLineStation {
  shortCode: string;
  pos: THREE.Vector3;
  stationName: string;
}

export interface RailLine {
  lineCode: string;
  color: number;
  stations: RailLineStation[];
  isLoop: boolean;
}

interface StationOnLine {
  shortCode: string;
  pos: THREE.Vector3;
  stationName: string;
}

/**
 * Build railway line geometries by grouping stations per line_code,
 * sorting by short_code number, and connecting adjacent stations.
 * Returns RailLine[] for use by the train renderer.
 */
function buildAndRenderRailLines(
  ward23: StationData[],
  parent: THREE.Object3D
): RailLine[] {
  // Collect stations per line
  const lineStations = new Map<
    string,
    { operator: string | null; stations: StationOnLine[] }
  >();

  for (const st of ward23) {
    const elev = st.station_elevation_m ?? st.elevation_m ?? 0;
    const pos = mapToOri(st.center_point.lat, st.center_point.lon, elev);

    for (const route of st.routes) {
      if (!route.line_code || !route.short_code) continue;

      if (!lineStations.has(route.line_code)) {
        lineStations.set(route.line_code, {
          operator: route.operator_code,
          stations: [],
        });
      }
      lineStations.get(route.line_code)!.stations.push({
        shortCode: route.short_code,
        pos,
        stationName: st.station_name,
      });
    }
  }

  const railLines: RailLine[] = [];

  for (const [lineCode, { operator, stations }] of lineStations) {
    if (stations.length < 2) continue;

    // Sort by short_code numeric part
    stations.sort((a, b) => shortCodeSortKey(a.shortCode) - shortCodeSortKey(b.shortCode));

    // Deduplicate by short_code
    const deduped: StationOnLine[] = [];
    for (const s of stations) {
      if (deduped.length === 0 || deduped[deduped.length - 1].shortCode !== s.shortCode) {
        deduped.push(s);
      }
    }
    if (deduped.length < 2) continue;

    const color = getLineColor(lineCode, operator);
    const isLoop = LOOP_LINES.has(lineCode);

    railLines.push({
      lineCode,
      color,
      stations: deduped.map((s) => ({
        shortCode: s.shortCode,
        pos: s.pos,
        stationName: s.stationName,
      })),
      isLoop,
    });

    // Render the line geometry
    const points = deduped.map((s) => s.pos);
    if (isLoop) points.push(points[0]);

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color,
      opacity: 0.7,
      transparent: true,
    });
    const line = new THREE.Line(geometry, material);
    parent.add(line);
  }

  return railLines;
}

// --- Cached data fetching ---

let cachedStations: StationData[] | null = null;

export async function fetchStations(): Promise<StationData[]> {
  if (cachedStations) return cachedStations;
  const resp = await fetch("/data/tokyo_rail_stations_centerpoints.json");
  cachedStations = await resp.json();
  return cachedStations!;
}

// --- Re-renderable station rendering ---

const RENDER_GROUP_NAME = "station-render-group";

export function renderStations(
  stations: StationData[],
  parent: THREE.Object3D
): RailLine[] {
  // Remove previous render group if it exists
  const existing = parent.getObjectByName(RENDER_GROUP_NAME);
  if (existing) {
    parent.remove(existing);
    existing.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.InstancedMesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
      if (obj instanceof THREE.Line) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
  }

  const group = new THREE.Group();
  group.name = RENDER_GROUP_NAME;

  const ward23 = stations.filter(isIn23Wards);

  // Instanced station dots
  const colorGroups = new Map<number, THREE.Vector3[]>();
  for (const st of ward23) {
    const elev = st.station_elevation_m ?? st.elevation_m ?? 0;
    const pos = mapToOri(st.center_point.lat, st.center_point.lon, elev);
    const color = getOperatorColor(st.routes);
    if (!colorGroups.has(color)) colorGroups.set(color, []);
    colorGroups.get(color)!.push(pos);
  }
  const sphereGeo = new THREE.SphereGeometry(0.012, 6, 6);
  for (const [color, positions] of colorGroups) {
    const mat = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.InstancedMesh(sphereGeo, mat, positions.length);
    const dummy = new THREE.Object3D();
    positions.forEach((pos, i) => {
      dummy.position.copy(pos);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    group.add(mesh);
  }

  // Railway lines
  const railLines = buildAndRenderRailLines(ward23, group);

  parent.add(group);

  return railLines;
}

// --- Legacy entry point ---

export async function loadStations(parent: THREE.Object3D): Promise<RailLine[]> {
  const stations = await fetchStations();
  return renderStations(stations, parent);
}
