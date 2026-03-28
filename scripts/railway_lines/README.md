# 都内鉄道駅（JR・東京メトロ・都営地下鉄・私鉄）中心点座標＋地表標高データ仕様

## 概要

本ドキュメントは、東京都内の鉄道駅について以下の情報を整理し、JSON形式で取得するための仕様をまとめたものである。

取得対象：

- JR
- 東京メトロ
- 都営地下鉄
- 私鉄（小田急・京王・東急・西武・東武・京急・京成・りんかい線・ゆりかもめ など）

対象範囲：

- 東京都内に位置する駅
- 約600駅

取得データ：

| 項目 | 内容 |
| --- | --- |
| 駅名 | station_name |
| 事業者 | operator |
| 路線名 | line |
| 駅中心点座標 | lat, lon |
| 地表標高 | elevation_m |

このデータにより以下が可能：

- 地下深度の推定
- 3D路線図作成
- GIS分析
- 浸水リスク分析
- 地形と路線設計の関係分析

---

# データ構造（JSON）

```json
{
  "generated_at": "2026-03-28T00:00:00Z",
  "area": "Tokyo",
  "station_count": 619,
  "stations": [
    {
      "station_name": "銀座",
      "center_point": {
        "lat": 35.6717,
        "lon": 139.7640
      },
      "elevation_m": 5.2,
      "routes": [
        {
          "operator": "東京メトロ",
          "line": "銀座線"
        },
        {
          "operator": "東京メトロ",
          "line": "丸ノ内線"
        },
        {
          "operator": "東京メトロ",
          "line": "日比谷線"
        }
      ]
    }
  ]
}
```

---

# データ取得方針

## 駅中心点 (lat, lon)

駅中心点は次の優先順位で取得する：

1. OpenStreetMap の駅ノード
2. OpenStreetMap の駅ポリゴン centroid
3. ODPT 公共交通オープンデータの代表座標

理由：

- 出入口座標ではなく駅全体の代表位置になる
- GIS用途で扱いやすい
- 複数路線駅の位置ブレが少ない

想定精度：

±10m程度

---

## 地表標高 (elevation)

標高は国土地理院の標高APIを使用：

5mメッシュ標高が取得可能

API：

<https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php>

パラメータ：

| parameter | description |
| --- | --- |
| lat | 緯度 |
| lon | 経度 |
| outtype | JSON |

例：

<https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php?lat=35.6717&lon=139.7640&outtype=JSON>

レスポンス：

```json
{
  "elevation": 5.2,
  "hsrc": "5m"
}
```

想定精度：

±1〜5m

---

# 対象路線

## 東京メトロ

- 銀座線
- 丸ノ内線
- 日比谷線
- 東西線
- 千代田線
- 有楽町線
- 半蔵門線
- 南北線
- 副都心線

駅数：約180

---

## 都営地下鉄

- 浅草線
- 三田線
- 新宿線
- 大江戸線

駅数：約106

---

## JR（東京都内）

- 山手線
- 中央線
- 総武線
- 京浜東北線
- 常磐線
- 埼京線
- 湘南新宿ライン
- 横須賀線
- 南武線
- 武蔵野線
- 青梅線
- 五日市線
- 八高線
- 上野東京ライン
- 東海道線

---

## 私鉄

例：

- 京王線
- 小田急線
- 東急線
- 西武線
- 東武線
- 京急線
- 京成線
- りんかい線
- ゆりかもめ
- 多摩モノレール
- 東京モノレール

---

# データ生成フロー

1. 駅一覧取得
2. 駅中心点取得
3. 標高APIから標高取得
4. JSON生成

---

# Python実装例

```python
import requests
import json
import time

def get_elevation(lat, lon):

    url = "https://cyberjapandata2.gsi.go.jp/general/dem/scripts/getelevation.php"

    params = {
        "lat": lat,
        "lon": lon,
        "outtype": "JSON"
    }

    r = requests.get(url, params=params)

    if r.status_code == 200:
        return r.json()["elevation"]

    return None


def enrich_with_elevation(stations):

    for s in stations:

        lat = s["center_point"]["lat"]
        lon = s["center_point"]["lon"]

        elevation = get_elevation(lat, lon)

        s["elevation_m"] = elevation

        time.sleep(0.2)

    return stations


with open("stations.json") as f:

    data = json.load(f)

data["stations"] = enrich_with_elevation(data["stations"])

with open("stations_with_elevation.json", "w") as f:

    json.dump(
        data,
        f,
        ensure_ascii=False,
        indent=2
    )
```

---

# 精度に関する注意

地下鉄の「ホーム深さ」は公開されていない場合が多い。

ただし：

ホーム標高 ≒ 地表標高 − 地下深度

で推定可能。

地下深度の情報は：

- 論文
- Wikipedia
- 構造図
- 防災資料

などに個別に存在する。

---

# 活用例

## 3D地下鉄マップ

- [deck.gl](http://deck.gl)
- [kepler.gl](http://kepler.gl)
- three.js

---

## 浸水リスク分析

標高の低い駅：

- 銀座
- 日本橋
- 東銀座
- 人形町
- 茅場町

---

## 地形と路線設計の分析

例：

- 大江戸線は深い
- 丸ノ内線は浅い
- 台地上の駅は標高が高い

---

# 最終JSONスキーマ

```json
{
  "station_name": "string",
  "center_point": {
    "lat": number,
    "lon": number
  },
  "elevation_m": number,
  "routes": [
    {
      "operator": "string",
      "line": "string"
    }
  ]
}
```

---

# 拡張可能

- 駅ID (odpt)
- 乗換情報
- 出入口数
- 路線カラー
- GeoJSON形式
- 3D座標
- 推定地下深度
- 駅ポリゴン
- PostGIS用schema