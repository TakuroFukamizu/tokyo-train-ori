"""
地下鉄駅の深度データを付与し、海抜基準の駅標高を計算するスクリプト。

計算式: station_elevation = surface_elevation - depth

深度データソース:
- 路線ごとの標準的な深度（建設時期・工法による）
- 主要駅の既知の深度（Wikipedia・防災資料・構造図等の公開情報）
"""

from __future__ import annotations

import json
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
INPUT = SCRIPT_DIR / "tokyo_rail_stations_centerpoints.json"
OUTPUT = SCRIPT_DIR / "tokyo_rail_stations_centerpoints.json"
PUBLIC_OUTPUT = SCRIPT_DIR / ".." / ".." / "public" / "data" / "tokyo_rail_stations_centerpoints.json"

# --- 路線別デフォルト深度 (m) ---
# 浅い順: 銀座線(1927)→丸ノ内線(1954)→日比谷線(1961)→浅草線(1960)
#         →東西線(1964)→千代田線(1969)→有楽町線(1974)→半蔵門線(1978)
#         →三田線(1968)→新宿線(1978)→南北線(1991)→副都心線(2008)→大江戸線(1991)
# 後発路線ほど既存路線の下を通るため深い
LINE_DEFAULT_DEPTH: dict[str, float] = {
    # 東京メトロ
    "TokyoMetro.Ginza": 12,
    "TokyoMetro.Marunouchi": 14,
    "TokyoMetro.MarunouchiBranch": 14,
    "TokyoMetro.Hibiya": 16,
    "TokyoMetro.Tozai": 18,
    "TokyoMetro.Chiyoda": 22,
    "TokyoMetro.Yurakucho": 25,
    "TokyoMetro.Hanzomon": 25,
    "TokyoMetro.Namboku": 30,
    "TokyoMetro.Fukutoshin": 28,
    # 都営
    "Toei.Asakusa": 16,
    "Toei.Mita": 22,
    "Toei.Shinjuku": 26,
    "Toei.Oedo": 40,
    # 地上路線（深度なし）
    "Toei.Arakawa": 0,        # 都電荒川線（地上）
    "Toei.NipporiToneri": 0,  # 日暮里・舎人ライナー（高架）
}

# --- 個別駅の既知の深度 (m) ---
# キー: station_name (station_group_code でも可)
# 出典: Wikipedia「○○駅」記事、東京都交通局防災資料、各社公開資料
KNOWN_DEPTHS: dict[str, float] = {
    # === 大江戸線（日本最深級） ===
    "六本木": 42.3,
    "新宿": 36.4,
    "都庁前": 34.2,
    "飯田橋": 33.8,
    "春日": 35.4,
    "麻布十番": 32.3,
    "青山一丁目": 32.8,
    "国立競技場": 36.0,
    "中野坂上": 33.0,
    "東新宿": 35.0,
    "中井": 34.0,
    "落合南長崎": 36.0,
    "練馬": 38.4,
    "光が丘": 27.5,
    "汐留": 30.5,
    "大門": 28.6,
    "月島": 28.0,
    "勝どき": 31.0,
    "築地市場": 28.0,
    "蔵前": 33.5,
    "本郷三丁目": 26.0,
    "上野御徒町": 27.5,
    "新御徒町": 25.0,
    "両国": 28.0,
    "門前仲町": 27.0,
    "清澄白河": 26.0,
    "森下": 25.5,

    # === 南北線（深い） ===
    "後楽園": 37.5,
    "永田町": 36.0,
    "溜池山王": 35.5,
    "四ツ谷": 30.0,
    "市ケ谷": 31.0,
    "東大前": 26.5,
    "王子": 23.5,
    "赤羽岩淵": 21.0,
    "白金台": 33.0,
    "白金高輪": 28.0,
    "目黒": 26.0,

    # === 副都心線 ===
    "渋谷": 25.0,     # 副都心線ホーム（地下5階）
    "明治神宮前〈原宿〉": 22.0,
    "北参道": 23.0,
    "西早稲田": 30.0,
    "雑司が谷": 26.0,
    "千川": 20.0,
    "要町": 22.0,
    "小竹向原": 23.0,
    "氷川台": 20.0,
    "平和台": 20.0,
    "地下鉄赤塚": 18.0,
    "地下鉄成増": 18.0,

    # === 千代田線 ===
    "国会議事堂前": 37.9,
    "霞ケ関": 28.0,
    "表参道": 22.0,
    "乃木坂": 21.0,
    "赤坂": 26.0,
    "大手町": 18.0,
    "新御茶ノ水": 20.0,
    "湯島": 18.0,
    "根津": 15.0,
    "千駄木": 14.0,
    "西日暮里": 12.0,
    "町屋": 10.0,
    "北千住": 8.0,
    "綾瀬": 8.0,
    "北綾瀬": 8.0,
    "代々木上原": 8.0,
    "代々木公園": 18.0,

    # === 半蔵門線 ===
    "半蔵門": 22.0,
    "九段下": 22.0,
    "神保町": 20.0,
    "三越前": 22.0,
    "水天宮前": 24.0,
    "住吉": 22.0,
    "錦糸町": 16.0,
    "押上〈スカイツリー前〉": 18.0,

    # === 有楽町線 ===
    "有楽町": 22.0,
    "桜田門": 20.0,
    "麹町": 22.0,
    "池袋": 18.0,
    "護国寺": 25.0,
    "江戸川橋": 22.0,
    "東池袋": 30.0,
    "豊洲": 20.0,
    "辰巳": 22.0,
    "新木場": 12.0,

    # === 銀座線（最も浅い） ===
    "銀座": 10.0,
    "日本橋": 10.0,
    "京橋": 10.0,
    "浅草": 8.0,
    "田原町": 8.0,
    "稲荷町": 8.0,
    "上野": 10.0,
    "上野広小路": 10.0,
    "末広町": 10.0,
    "神田": 10.0,
    "三越前": 10.0,
    "新橋": 12.0,
    "虎ノ門": 12.0,
    "赤坂見附": 12.0,
    "青山一丁目": 14.0,  # 銀座線は浅いが大江戸線は深い→大江戸線優先
    "外苑前": 12.0,

    # === 丸ノ内線 ===
    "東京": 12.0,
    "淡路町": 12.0,
    "御茶ノ水": 10.0,
    "本郷三丁目": 12.0,  # 丸ノ内線のほうが浅い、大江戸線は深い
    "茗荷谷": 8.0,
    "新大塚": 12.0,
    "荻窪": 8.0,
    "南阿佐ケ谷": 12.0,
    "新高円寺": 14.0,
    "東高円寺": 14.0,
    "新中野": 14.0,
    "中野坂上": 16.0,
    "西新宿": 18.0,
    "新宿三丁目": 16.0,
    "新宿御苑前": 14.0,
    "四谷三丁目": 14.0,
    "赤坂見附": 12.0,
    "国会議事堂前": 20.0,  # 丸ノ内線は千代田線より浅い
    "中野富士見町": 10.0,
    "中野新橋": 12.0,
    "方南町": 14.0,

    # === 日比谷線 ===
    "恵比寿": 15.0,
    "広尾": 18.0,
    "六本木": 18.0,  # 日比谷線（大江戸線は42m）
    "神谷町": 16.0,
    "虎ノ門ヒルズ": 30.0,
    "茅場町": 14.0,
    "人形町": 14.0,
    "小伝馬町": 12.0,
    "秋葉原": 12.0,
    "仲御徒町": 12.0,
    "入谷": 10.0,
    "三ノ輪": 10.0,
    "南千住": 8.0,

    # === 東西線 ===
    "中野": 10.0,
    "落合": 16.0,
    "高田馬場": 18.0,
    "早稲田": 20.0,
    "神楽坂": 18.0,
    "竹橋": 18.0,
    "木場": 16.0,
    "東陽町": 14.0,
    "南砂町": 12.0,
    "西葛西": 10.0,
    "葛西": 8.0,
    "浦安": 8.0,
    "西船橋": 0.0,

    # === 都営浅草線 ===
    "西馬込": 15.0,
    "馬込": 18.0,
    "中延": 15.0,
    "戸越": 14.0,
    "五反田": 18.0,
    "高輪台": 26.0,
    "泉岳寺": 15.0,
    "三田": 14.0,
    "東銀座": 12.0,
    "宝町": 12.0,
    "日本橋": 14.0,
    "人形町": 14.0,
    "浅草橋": 10.0,
    "押上〈スカイツリー前〉": 10.0,

    # === 都営三田線 ===
    "目黒": 22.0,
    "白金台": 28.0,
    "白金高輪": 24.0,
    "三田": 20.0,
    "芝公園": 18.0,
    "御成門": 16.0,
    "内幸町": 16.0,
    "日比谷": 14.0,
    "大手町": 20.0,
    "神保町": 18.0,
    "水道橋": 16.0,
    "巣鴨": 14.0,
    "千石": 16.0,
    "白山": 18.0,
    "本蓮沼": 15.0,
    "志村坂上": 12.0,
    "志村三丁目": 10.0,
    "蓮根": 10.0,
    "西台": 10.0,
    "高島平": 0.0,
    "新高島平": 0.0,
    "西高島平": 0.0,

    # === 都営新宿線 ===
    "新宿三丁目": 25.0,
    "曙橋": 22.0,
    "市ヶ谷": 24.0,
    "九段下": 20.0,
    "岩本町": 18.0,
    "馬喰横山": 20.0,
    "浜町": 18.0,
    "森下": 16.0,
    "菊川": 16.0,
    "住吉": 18.0,
    "西大島": 14.0,
    "大島": 12.0,
    "東大島": 0.0,  # 地上駅
    "船堀": 0.0,    # 地上駅
    "一之江": 14.0,
    "瑞江": 14.0,
    "篠崎": 16.0,
    "本八幡": 20.0,
}

# 地上路線のline_codeプレフィックス（深度0）
SURFACE_LINE_PREFIXES = [
    "JR-East",
    "Odakyu",
    "Keio",
    "Tokyu",
    "Seibu",
    "Tobu",
    "Keikyu",
    "Keisei",
    "TWR",           # りんかい線（一部地下だが地上扱い）
    "Yurikamome",
    "TokyoMonorail",
    "TamaMonorail",
    "Hokuso",
    "SaitamaRailway",
    "MIR",            # つくばエクスプレス
    "Toei.Arakawa",
    "Toei.NipporiToneri",
]


def get_primary_subway_line(station: dict) -> str | None:
    """駅の地下鉄路線コードを返す。複数ある場合はより深い路線を優先。"""
    subway_lines = []
    for r in station["routes"]:
        lc = r.get("line_code") or ""
        if lc in LINE_DEFAULT_DEPTH and LINE_DEFAULT_DEPTH[lc] > 0:
            subway_lines.append(lc)
    if not subway_lines:
        return None
    # より深い路線を優先（深い路線のホームが駅の代表深度になることが多い）
    return max(subway_lines, key=lambda lc: LINE_DEFAULT_DEPTH.get(lc, 0))


def compute_depth(station: dict) -> float:
    """駅の地下深度を返す。地上駅は0。"""
    name = station["station_name"]

    # 既知の深度がある場合はそれを使う
    if name in KNOWN_DEPTHS:
        return KNOWN_DEPTHS[name]

    # 地下鉄路線に属するか判定
    line = get_primary_subway_line(station)
    if line:
        return LINE_DEFAULT_DEPTH[line]

    return 0.0


def main():
    with open(INPUT, encoding="utf-8") as f:
        stations = json.load(f)

    underground_count = 0
    for st in stations:
        depth = compute_depth(st)
        st["depth_m"] = depth
        surface = st["elevation_m"] or 0
        st["station_elevation_m"] = round(surface - depth, 1)
        if depth > 0:
            underground_count += 1

    print(f"Total: {len(stations)} stations")
    print(f"Underground: {underground_count}")
    print(f"Surface: {len(stations) - underground_count}")

    # 最も深い駅 TOP 10
    by_elev = sorted(stations, key=lambda s: s["station_elevation_m"])
    print("\n--- Deepest stations (sea level) ---")
    for s in by_elev[:10]:
        print(f"  {s['station_name']}: surface={s['elevation_m']}m, "
              f"depth={s['depth_m']}m, station_elev={s['station_elevation_m']}m")

    # 保存
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(stations, f, ensure_ascii=False, indent=2)
    print(f"\nSaved: {OUTPUT}")

    with open(PUBLIC_OUTPUT, "w", encoding="utf-8") as f:
        json.dump(stations, f, ensure_ascii=False, indent=2)
    print(f"Saved: {PUBLIC_OUTPUT}")


if __name__ == "__main__":
    main()
