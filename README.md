# Ori Viewer - 透景 (toukei)

東京23区の鉄道路線を3Dワイヤーフレームキューブ（おり）内にリアルタイムで可視化するWebアプリケーション。

## 必要環境

- Node.js 18+
- npm

## セットアップ

```bash
npm install
```

## デバッグ実行

```bash
npm run dev
```

ブラウザで http://localhost:5173 を開く。

ファイル変更時にHMR（Hot Module Replacement）で自動リロードされる。

## ビルド

```bash
npm run build
```

成果物は `dist/` に出力される。

## プレビュー（ビルド後の確認）

```bash
npm run preview
```

## 主な機能

- 実際の時刻表データに基づくリアルタイム電車シミュレーション
- MediaPipeによるフェイストラッキングでのカメラ操作
- 複数タブ間の同期表示（BroadcastChannel API）
- 路線遅延シミュレーション（接続路線への波及あり）
