# 描画プログラム

キーマップ可視化 デザインルール（`spec.md`）の参照実装です。中間データ（JSON）とテーマ（JSON）から、仕様どおりのSVGを描きます。正本は仕様で、仕様とこのプログラムが食い違う場合はプログラムを直します。このプログラムを実行できる環境では、図は必ずこのプログラムで描きます（第10.10節）。

## 使い方

Node.js（18以上）だけで動きます。インストールは要りません。

```
node renderer/render.mjs renderer/examples/torabo-tsuki-lp-xs-windows.json -o keymap.svg
```

| オプション | 内容 |
|---|---|
| `--theme <名前\|パス>` | テーマ。名前なら `themes/<名前>.json` を使う。省略すると既定テーマ（`clay`） |
| `-o <パス>` | 出力先。省略すると標準出力に書く |

## 流れ

1. キーマップと設定ファイルを解析し、入力項目を質問で確定させる（仕様 第10.0節）。
2. 図の内容を中間データにまとめる。形式は `schema.json` を正本とする。例は `examples/` を参照。
3. このプログラムで SVG を描く。
4. 描いた図を、仕様 第10.8節の項目で確認する。

## ファイル

| パス | 内容 |
|---|---|
| `render.mjs` | 描画プログラム本体 |
| `schema.json` | 中間データの JSON Schema |
| `examples/torabo-tsuki-lp-xs-windows.json` | 中間データの例（torabo-tsuki LP XS、Windows） |
| `../themes/*.json` | テーマ |
| `../icons/*.svg` | 操作アイコン |

## 中間データの検証

プログラムは、描くのに必要な項目（キー・レイヤー・Comboの参照など）だけを確認します。`schema.json` での厳密な検証は、JSON Schema に対応したツールで行ってください。

```
npx ajv-cli validate --spec=draft2020 -s renderer/schema.json -d renderer/examples/torabo-tsuki-lp-xs-windows.json
```

## できないこと

- 短縮表記は作りません。隣接Comboのラベルが収まらないときは、キー拡大（最大1.3倍）→ 中間データの短縮表記（`short`）→ 文字縮小（80%まで）の順に自動で試し（仕様 第10.10節）、それでも収まらないものを識別子方式にします。短縮表記を使わせたい場合は、中間データの `short` に書いてください。
- SVGはフォントを Google Fonts から読み込みます。オフラインのときや、画像（`<img>`）として埋め込んだときは、代わりのフォントで表示されます。
