import json
from pathlib import Path
from urllib.request import urlopen
from urllib.parse import quote

BASE = Path('/mnt/data')
stations = json.loads((BASE / 'stations.json').read_text(encoding='utf-8'))
lines = json.loads((BASE / 'lines.json').read_text(encoding='utf-8'))
operators = json.loads((BASE / 'operators.json').read_text(encoding='utf-8'))

line_map = {}
for l in lines:
    key = (l['ekidata_id'], l.get('code', ''))
    line_map[key] = l
    if l.get('code'):
        line_map[('code', l['code'])] = l

op_map = {op['code']: op for op in operators}


def line_info(st):
    code = st.get('line_code', '')
    ekid = st.get('ekidata_line_id', '')
    line = None
    if code and ('code', code) in line_map:
        line = line_map[('code', code)]
    else:
        cands = [x for x in lines if x['ekidata_id'] == ekid]
        line = cands[0] if cands else None
    if not line:
        return {
            'line_code': code or None,
            'line_name': None,
            'operator_code': None,
            'operator_name': None,
            'station_code': st.get('code') or None,
            'short_code': st.get('short_code') or None,
        }
    line_code = line.get('code') or code or None
    operator_code = line_code.split('.')[0] if line_code and '.' in line_code else None
    operator_name = op_map.get(operator_code, {}).get('name_kanji') if operator_code else None
    return {
        'line_code': line_code,
        'line_name': line.get('name_kanji'),
        'operator_code': operator_code,
        'operator_name': operator_name,
        'station_code': st.get('code') or None,
        'short_code': st.get('short_code') or None,
    }


def build_base_records():
    tokyo = [s for s in stations if s.get('prefecture') == '13']
    out = []
    for s in tokyo:
        lats = [st['lat'] for st in s['stations']]
        lons = [st['lon'] for st in s['stations']]
        entry = {
            'station_group_code': s['group_code'],
            'station_name': s['name_kanji'],
            'station_name_kana': s.get('name_kana') or None,
            'station_name_romaji': s.get('name_romaji') or None,
            'prefecture_code': s.get('prefecture'),
            'center_point': {
                'lat': round(sum(lats) / len(lats), 6),
                'lon': round(sum(lons) / len(lons), 6),
            },
            'elevation_m': None,
            'routes': [],
        }
        seen = set()
        for st in s['stations']:
            info = line_info(st)
            key = (info['operator_code'], info['line_code'], info['station_code'], info['short_code'])
            if key in seen:
                continue
            seen.add(key)
            entry['routes'].append(info)
        entry['routes'] = sorted(entry['routes'], key=lambda x: ((x['operator_name'] or ''), (x['line_name'] or ''), (x['short_code'] or '')))
        out.append(entry)
    return out


def fetch_elevations(records, batch_size=19):
    for i in range(0, len(records), batch_size):
        batch = records[i:i + batch_size]
        lats = ','.join(f"{r['center_point']['lat']:.6f}" for r in batch)
        lons = ','.join(f"{r['center_point']['lon']:.6f}" for r in batch)
        url = f'https://api.open-meteo.com/v1/elevation?latitude={quote(lats, safe=",")}&longitude={quote(lons, safe=",")}'
        with urlopen(url) as resp:
            payload = json.loads(resp.read().decode('utf-8'))
        elevations = payload['elevation']
        for rec, elev in zip(batch, elevations):
            rec['elevation_m'] = elev


if __name__ == '__main__':
    records = build_base_records()
    # Uncomment the next line to actually enrich with elevations when running in an internet-enabled environment.
    # fetch_elevations(records)
    out = BASE / 'tokyo_rail_stations_centerpoints_template.json'
    out.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')
    print(out)
