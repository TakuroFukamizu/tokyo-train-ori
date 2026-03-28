import * as THREE from "three";

interface StationRoute {
  line_code: string | null;
  line_name: string | null;
  operator_code: string | null;
  operator_name: string | null;
  station_code: string | null;
  short_code: string | null;
}

interface StationData {
  station_group_code: string;
  station_name: string;
  station_name_kana: string | null;
  station_name_romaji: string | null;
  prefecture_code: string;
  center_point: { lat: number; lon: number };
  elevation_m: number | null;
  routes: StationRoute[];
}

// Tokyo 23 wards bounding box
const BOUNDS = {
  lat: { min: 35.53, max: 35.82 },
  lon: { min: 139.56, max: 139.92 },
  elev: { min: 0, max: 80 },
};

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

function getOperatorColor(routes: StationRoute[]): number {
  for (const r of routes) {
    if (r.operator_code && r.operator_code in OPERATOR_COLORS) {
      return OPERATOR_COLORS[r.operator_code];
    }
  }
  return 0xaaaaaa;
}

/**
 * Map a station's lat/lon/elevation into the おり's local coordinate space.
 * おり is 2x2x2 centered at origin (0,0,0) in local space → spans [-1,1] on each axis.
 * X = longitude (east-west), Y = elevation, Z = -latitude (north-south, north=negative Z)
 */
function mapToOri(lat: number, lon: number, elev: number): THREE.Vector3 {
  const x = ((lon - BOUNDS.lon.min) / (BOUNDS.lon.max - BOUNDS.lon.min)) * 2 - 1;
  const y = ((elev - BOUNDS.elev.min) / (BOUNDS.elev.max - BOUNDS.elev.min)) * 2 - 1;
  const z = -(((lat - BOUNDS.lat.min) / (BOUNDS.lat.max - BOUNDS.lat.min)) * 2 - 1);
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

export async function loadStations(parent: THREE.Object3D): Promise<void> {
  const resp = await fetch("/data/tokyo_rail_stations_centerpoints.json");
  const stations: StationData[] = await resp.json();
  const ward23 = stations.filter(isIn23Wards);

  // Group by operator color for instanced rendering
  const colorGroups = new Map<number, THREE.Vector3[]>();

  for (const st of ward23) {
    const elev = st.elevation_m ?? 0;
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

    parent.add(mesh);
  }
}
