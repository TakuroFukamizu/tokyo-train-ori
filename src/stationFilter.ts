export interface StationRoute {
  line_code: string | null;
  line_name: string | null;
  operator_code: string | null;
  operator_name: string | null;
  station_code: string | null;
  short_code: string | null;
}

export interface StationData {
  station_group_code: string;
  station_name: string;
  station_name_kana: string | null;
  station_name_romaji: string | null;
  prefecture_code: string;
  center_point: { lat: number; lon: number };
  elevation_m: number | null;
  depth_m?: number;
  station_elevation_m?: number;
  routes: StationRoute[];
}

const BOUNDS = {
  lat: { min: 35.53, max: 35.82 },
  lon: { min: 139.56, max: 139.92 },
};

const SUBWAY_OPERATORS = new Set(["TokyoMetro", "Toei"]);

function isIn23Wards(st: StationData): boolean {
  const { lat, lon } = st.center_point;
  return (
    lat >= BOUNDS.lat.min &&
    lat <= BOUNDS.lat.max &&
    lon >= BOUNDS.lon.min &&
    lon <= BOUNDS.lon.max
  );
}

export type LineCategory = "subway" | "inner" | "connecting";

export function classifyLines(
  stations: StationData[]
): Map<string, LineCategory> {
  const lineInfo = new Map<
    string,
    { hasInside: boolean; hasOutside: boolean; isSubway: boolean }
  >();

  for (const st of stations) {
    const inside = isIn23Wards(st);
    for (const route of st.routes) {
      if (!route.line_code) continue;
      if (!lineInfo.has(route.line_code)) {
        lineInfo.set(route.line_code, {
          hasInside: false,
          hasOutside: false,
          isSubway: SUBWAY_OPERATORS.has(route.operator_code ?? ""),
        });
      }
      const info = lineInfo.get(route.line_code)!;
      if (inside) info.hasInside = true;
      else info.hasOutside = true;
    }
  }

  const result = new Map<string, LineCategory>();
  for (const [lineCode, info] of lineInfo) {
    if (info.hasInside && info.hasOutside) {
      result.set(lineCode, "connecting");
    } else if (info.hasInside) {
      result.set(lineCode, info.isSubway ? "subway" : "inner");
    }
  }
  return result;
}

export function getCategoriesForTab(
  tabCount: number,
  tabIndex: number
): Set<LineCategory> | null {
  if (tabCount <= 1) return null;

  if (tabCount === 2) {
    if (tabIndex === 0) return new Set(["subway", "inner"]);
    return new Set(["connecting"]);
  }

  // tabCount >= 3
  if (tabIndex === 0) return new Set(["subway"]);
  if (tabIndex === 1) return new Set(["inner"]);
  if (tabIndex === 2) return new Set(["connecting"]);
  return null;
}

export function filterStations(
  stations: StationData[],
  lineClassification: Map<string, LineCategory>,
  allowedCategories: Set<LineCategory>
): StationData[] {
  const allowedLines = new Set<string>();
  for (const [lineCode, category] of lineClassification) {
    if (allowedCategories.has(category)) {
      allowedLines.add(lineCode);
    }
  }

  const result: StationData[] = [];
  for (const st of stations) {
    const filteredRoutes = st.routes.filter(
      (r) => r.line_code && allowedLines.has(r.line_code)
    );
    if (filteredRoutes.length > 0) {
      result.push({ ...st, routes: filteredRoutes });
    }
  }
  return result;
}
