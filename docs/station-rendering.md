# 駅データ 3D 描画仕様

## 概要

東京23区の鉄道駅を、おり（3D ワイヤーフレームキューブ）の内部に描画する。各駅は緯度・経度・海抜標高に基づいて3D空間に配置され、事業者・路線ごとに色分けされる。

## データソース

| ファイル | 内容 |
|---|---|
| `public/data/tokyo_rail_stations_centerpoints.json` | 描画用JSON（619駅） |
| `scripts/railway_lines/tokyo_rail_stations_centerpoints.json` | マスターJSON |
| `scripts/railway_lines/build_tokyo_station_json.py` | 駅データ生成スクリプト |
| `scripts/railway_lines/enrich_depth.py` | 地下深度付与スクリプト |

## データ構造

```json
{
  "station_name": "銀座",
  "center_point": { "lat": 35.6717, "lon": 139.7640 },
  "elevation_m": 5.2,
  "depth_m": 10.0,
  "station_elevation_m": -4.8,
  "routes": [
    {
      "line_code": "TokyoMetro.Ginza",
      "line_name": "銀座線",
      "operator_code": "TokyoMetro",
      "operator_name": "東京地下鉄 (東京メトロ)",
      "station_code": "TokyoMetro.Ginza.Ginza",
      "short_code": "G09"
    }
  ]
}
```

| フィールド | 説明 |
|---|---|
| `elevation_m` | 地表標高（国土地理院5mメッシュ / open-meteo API） |
| `depth_m` | 地下深度（地表からホームまでの深さ。地上駅は0） |
| `station_elevation_m` | 実際の駅標高 = `elevation_m - depth_m`（海抜基準） |

## 地下深度データ

`enrich_depth.py` が深度を計算する。

### 深度の決定ロジック

1. **既知の深度** — 主要駅の公開データ（Wikipedia・防災資料等）から個別設定
2. **路線別デフォルト深度** — 建設時期・工法に基づく路線ごとの標準深度
3. **地上駅** — JR・私鉄等の地上路線は深度0

### 路線別デフォルト深度

| 路線 | デフォルト深度 | 備考 |
|---|---|---|
| 銀座線 | 12m | 最古の路線、最も浅い |
| 丸ノ内線 | 14m | |
| 日比谷線 | 16m | |
| 浅草線 | 16m | |
| 東西線 | 18m | |
| 千代田線 | 22m | |
| 三田線 | 22m | |
| 有楽町線 | 25m | |
| 半蔵門線 | 25m | |
| 新宿線 | 26m | |
| 副都心線 | 28m | |
| 南北線 | 30m | |
| 大江戸線 | 40m | 最も深い |

## 座標系マッピング

駅の緯度・経度・標高を、おりのローカル座標系にマッピングする。

### おりの座標空間

- おりは 2×2×2 のワイヤーフレームキューブ（ローカル座標 [-1, 1] × [-1, 1] × [-1, 1]）
- ワールド座標では `position.y = 1` に配置（中心が (0, 1, 0)）

### 軸の対応

| おり軸 | 地理的意味 | 方向 |
|---|---|---|
| X | 経度（東西） | 東 → +X |
| Y | 標高 | 上 → +Y |
| Z | 緯度（南北） | 北 → -Z |

### 水平軸（X・Z）のマッピング

緯度・経度をメートルに変換してから正規化する。

```
DEG_TO_M_LAT = 111,000 m/°
DEG_TO_M_LON = 111,000 × cos(35.68°) ≈ 90,100 m/°

水平スパン:
  南北: 0.29° × 111km ≈ 32.2km
  東西: 0.36° × 90.1km ≈ 32.4km

正規化: 長い方のスパン (MAX_HORIZONTAL) で割り、[-1, 1] にマッピング
→ 短い方の軸は少し縮み、実際の地形アスペクト比が保持される
```

### 垂直軸（Y）のマッピング

標高はメートル単位で水平軸と同じスケールに変換した上で、`VERTICAL_EXAGGERATION` 倍する。

```
y = (elevation_m × VERTICAL_EXAGGERATION / MAX_HORIZONTAL) × 2
```

- `VERTICAL_EXAGGERATION = 100`（現在値）
- 海抜0m → y = 0（おりの中心）
- 真のスケール（1倍）では標高差が微小すぎて視認不可のため、誇張が必要

### 具体的な高さの例（VERTICAL_EXAGGERATION = 100 の場合）

| 標高 | y座標 | 備考 |
|---|---|---|
| 80m | ≈ +0.49 | 地表で最も高い駅 |
| 0m | 0 | 海面（青いライン） |
| -29m | ≈ -0.18 | 最も深い地下駅 |

### 海抜0mライン

おり内部に青い四角形のラインとして表示。`y = 0` に固定。

```typescript
color: 0x4488ff, opacity: 0.6, transparent: true
```

## 描画の実装

### 駅の描画

- `THREE.InstancedMesh` を使用（パフォーマンス最適化）
- 事業者ごとに色分けしてグループ化
- 球ジオメトリ: `SphereGeometry(0.012, 6, 6)`

### 路線の描画

- 同一路線の駅を `short_code` の番号順にソート
- 隣接する駅を `THREE.Line` で接続
- 環状線（山手線・大江戸線）は始点と終点を接続

### 色分け

路線固有色（`LINE_COLORS`）→ 事業者色（`OPERATOR_COLORS`）の順でフォールバック。

主要な事業者色:

| 事業者 | 色 |
|---|---|
| JR東日本 | `#21b24b`（緑） |
| 東京メトロ | `#149dd1`（水色） |
| 都営 | `#e85298`（ピンク） |
| 小田急 | `#2b6db2`（青） |
| 京王 | `#dd0077`（マゼンタ） |
| 東急 | `#ff0000`（赤） |

## ファイル構成

```
src/
  stationRenderer.ts   # 駅データの読み込み・座標変換・描画
  main.ts              # おり生成・海抜0mライン・loadStations() 呼び出し
```
