# Face Tracking — Camera Control Tuning Guide

## Overview

MediaPipe FaceLandmarker の顔姿勢（回転 + 平行移動）を使い、おりを覗き込むようなカメラ操作を実現している。本ドキュメントでは操作感の調整で得られた知見をまとめる。

## 操作モデル: 「窓越しに覗き込む」

カメラはおりの中心 (`LOOK_AT`) を常に注視しつつ、球面座標上を移動する。ユーザーの頭の動きとカメラ移動の関係は「窓の向こうの物体を覗く」比喩に基づく:

- 頭を**上**に動かす → おりが画面の**上方**に見える（カメラが下に回り込む）
- 頭を**右**に動かす → おりが画面の**右側**に見える（カメラが左に回り込む）

これを実現するために、カメラの球面座標への入力は**反転（負の符号）**で適用する。

## 入力の合成

カメラのピッチ/ヨーは、顔の**回転**と**平行移動**の2つを合成して決定する:

```
pitchDelta = pose.pitch * SENSITIVITY_ROTATION + pose.y * SENSITIVITY_POSITION
yawDelta   = pose.yaw   * SENSITIVITY_ROTATION + pose.x * SENSITIVITY_POSITION

targetPitch = basePitch - pitchDelta   // 反転
targetYaw   = baseYaw   - yawDelta    // 反転
```

回転のみだと首を傾けないと反応しないため不自然。位置を加えることで、体ごと動いたときにも自然に追従する。

## 符号の決定（Webcam ミラーリング）

Webcam は左右反転されるため、MediaPipe の出力値の符号調整が必要:

| 値 | faceTracker.ts での処理 | 理由 |
|----|------------------------|------|
| yaw (回転) | `-(yaw - neutral)` | Webcam ミラーリング補正 |
| x (平行移動) | `+(tx - neutral)` | ミラー + 覗き込み反転で二重反転 → 正のまま |
| pitch (回転) | `+(pitch - neutral)` | 上下はミラーの影響なし |
| y (平行移動) | `-(ty - neutral)` | 覗き込み反転 |

初期実装では x を反転、y をそのままにしていたが、操作感が逆だったため符号を入れ替えた。

## パラメータ一覧 (`main.ts`)

| パラメータ | デフォルト | 説明 |
|-----------|-----------|------|
| `SENSITIVITY_ROTATION` | 2.0 | 顔の回転角度がカメラに与える影響の倍率 |
| `SENSITIVITY_POSITION` | 0.15 | 顔の平行移動がカメラに与える影響（rad/cm スケール） |
| `SMOOTHING` | 0.15 | Lerp 係数。大きいほど即応、小さいほど滑らか |

## ニュートラルキャリブレーション

フェイストラッキング開始時、最初に検出された顔の姿勢をニュートラル（基準値）として記録する。以降の入力はこの基準からの差分として処理される。これにより、カメラに対する顔の角度や位置に関係なく自然に操作できる。

## 調整のヒント

- 動きが大きすぎる → `SENSITIVITY_ROTATION` / `SENSITIVITY_POSITION` を下げる
- 動きがカクつく → `SMOOTHING` を小さくする（例: 0.08）
- 遅延が気になる → `SMOOTHING` を大きくする（例: 0.3）
- 位置の影響が強すぎて回転が目立たない → `SENSITIVITY_POSITION` を下げる
