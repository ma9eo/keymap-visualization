#!/usr/bin/env node
// キーマップ可視化 デザインルール v0.3 の参照実装
// 中間データ（JSON）とテーマ（JSON）から SVG を描く。外部ライブラリは使わない。
//
//   node renderer/render.mjs <中間データ.json> [--theme <名前|パス>] [-o <出力.svg>]
//
// --theme を省略すると既定テーマ（themes/clay.json）を使う。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const THEMES = path.resolve(HERE, '../themes');

// ---------------------------------------------------------------- 定数
const PITCH = 100; // 座標の単位。1u = 100
const KS = 92; // キーの一辺（1u からキー間隔を引いた大きさ）
const IN = (PITCH - KS) / 2;
const PAD = 6; // キー内側の余白
const COL_GAP = 3; // セル同士の間隔
const ENLARGE = [1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35, 1.4, 1.45, 1.5]; // 第10.4節：キー拡大の段階（最大1.5倍）
const SHRINK = [0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5]; // 第10.4節：文字縮小の段階（読める範囲として50%まで）
const COMBO_R = 0.5; // Comboのラベルと識別子の角丸の半径（高さに対する比）。両者で揃え、両端を半円にする（第6章）
const LABEL_MIN_W = 3; // 境界上のComboラベルの最小幅（ラベルの文字の大きさに対する比）
const LABEL_PAD = 0.9; // 境界上のComboラベルの左右の余白の合計（ラベルの文字の大きさに対する比）
const ONE_SHOT = { size: 1.2, gap: 0.1 }; // ワンショットアイコンの大きさと間隔（文字の大きさに対する比）
const SPLIT_GAP = 100; // 第10.1節：分割型の左右の間隔（1u）
const ICON_FILES = { 'tap-2': 'tap-2.svg', 'tap-3': 'tap-3.svg', toggle: 'toggle.svg', to: 'to.svg', 'one-shot': 'one-shot.svg' };
const WORDS = {
  ja: { keymap: 'キーマップ', source: '出典', spec: '仕様', notes: '注釈', combo: 'Combo', and: '＋', dash: ' — ', colon: '：', stop: '。', goTo: (n) => `${n}レイヤーへ切り替える`, holdIn: (n, t) => `${n}で長押し：${t}`, viaGo: { toggle: (n) => `${n}レイヤーをトグルで切り替える`, to: (n) => `${n}レイヤーへ移動する`, 'one-shot': (n) => `次の1キーだけ${n}レイヤーにする` } },
  en: { keymap: 'Keymap', source: 'Source', spec: 'Spec', notes: 'Notes', combo: 'Combos', and: '+', dash: ' — ', colon: ': ', stop: '. ', goTo: (n) => `Switches to the ${n} layer`, holdIn: (n, t) => `Hold in ${n}: ${t}`, viaGo: { toggle: (n) => `Toggles the ${n} layer`, to: (n) => `Moves to the ${n} layer`, 'one-shot': (n) => `Activates the ${n} layer for the next key` } },
};

// ---------------------------------------------------------------- 色
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (a) => '#' + a.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => toHex(hex(a).map((v, i) => v * t + hex(b)[i] * (1 - t))); // t は a の割合
const lum = (h) => {
  const c = hex(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// 背景に対して min を満たすまで、色相を保ったまま toward へ寄せる
function readable(fg, bg, toward, min = 4.5) {
  let c = fg;
  for (let t = 1; contrast(c, bg) < min && t > 0; ) { t -= 0.05; c = mix(fg, toward, t); }
  return c;
}

// ---------------------------------------------------------------- 文字
const cjk = (ch) => /[　-鿿＀-￯]/.test(ch);
const textWidth = (s, fs) => [...s].reduce((w, ch) => w + (cjk(ch) ? fs : fs * 0.62), 0);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const text = (s, attrs) => `<text ${attrs}>${esc(s)}</text>`;
const r1 = (v) => Math.round(v * 100) / 100;
// 幅 max に収まるよう折り返す。英数字の連なりは途中で切らず（1行に収まらないものだけ1文字ずつ切る）、句読点や閉じ括弧は行頭に置かない
function wrap(s, max, fs) {
  const tokens = (s.match(/[\x21-\x7e]+ *| +|./gu) || []).flatMap((t) => (textWidth(t.trimEnd(), fs) > max ? [...t] : [t]));
  const lines = [];
  let cur = '';
  for (const t of tokens) {
    if (cur && textWidth(cur + t.trimEnd(), fs) > max && !/^[、。，．・：；！？）」』】〕,.:;!?)\]]/u.test(t)) { lines.push(cur.trimEnd()); cur = t.trimStart(); }
    else cur += t;
  }
  if (cur.trim()) lines.push(cur.trimEnd());
  return lines.length ? lines : [''];
}

// ---------------------------------------------------------------- 入力
// 記号1文字だけの短縮表記は、キーの出力と取り違えるので使わない（第10.4節）
const oneSymbol = (t) => typeof t === 'string' && /^[^\p{L}\p{N}]$/u.test(t.trim());
function fail(msg) { console.error(`エラー: ${msg}`); process.exit(1); }

function parseArgs(argv) {
  const a = { theme: 'clay' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--theme') a.theme = argv[++i];
    else if (argv[i] === '-o' || argv[i] === '--out') a.out = argv[++i];
    else if (argv[i] === '-h' || argv[i] === '--help') a.help = true;
    else a.data = argv[i];
  }
  return a;
}

function loadJSON(p, what) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { fail(`${what}を読めません（${p}）: ${e.message}`); }
}

function loadTheme(name) {
  const p = fs.existsSync(name) ? name : path.join(THEMES, `${name}.json`);
  if (!fs.existsSync(p)) fail(`テーマが見つかりません: ${name}`);
  return loadJSON(p, 'テーマ');
}

function loadIcons() {
  const dir = path.resolve(HERE, '../icons');
  const out = {};
  for (const [id, file] of Object.entries(ICON_FILES)) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    const open = src.match(/<svg\b([^>]*)>/);
    out[id] = { attrs: open[1], inner: src.slice(open.index + open[0].length, src.lastIndexOf('</svg>')) };
  }
  return out;
}

// 描くのに必要な項目だけを確認する（厳密な検証は schema.json で行う）
function validate(d) {
  const errs = [];
  if (!d.meta?.keyboard) errs.push('meta.keyboard がありません');
  if (!d.meta?.os) errs.push('meta.os がありません');
  if (typeof d.meta?.split !== 'boolean') errs.push('meta.split がありません。分割型なら true、一体型なら false にしてください（第10.0節）');
  if (!d.meta?.source?.repo || !d.meta?.source?.commit) errs.push('meta.source（repo と commit）がありません');
  if (!Array.isArray(d.layers)) errs.push('layers がありません');
  else if (d.layers.filter((l) => l.show !== false).length > 6) errs.push('この図に表示する追加レイヤーは6つまでです。図を分け、ほかの図のレイヤーには show: false を付けてください（第3.2節）');
  if (!Array.isArray(d.keys) || !d.keys.length) errs.push('keys がありません');
  const layerIds = new Set((d.layers || []).map((l) => l.id));
  const keyIds = new Set();
  for (const k of d.keys || []) {
    if (!k.id || typeof k.x !== 'number' || typeof k.y !== 'number') { errs.push(`キーに id・x・y がありません: ${JSON.stringify(k)}`); continue; }
    if (keyIds.has(k.id)) errs.push(`キーの id が重複しています: ${k.id}`);
    keyIds.add(k.id);
    for (const [l, v] of Object.entries(k.cells || {})) {
      if (!layerIds.has(l)) errs.push(`${k.id}: 未定義のレイヤー ${l}`);
      else if (d.layers.find((x) => x.id === l).show === false) errs.push(`${k.id}: レイヤー ${l} はこの図に表示しない（show: false）ので、セルを書けません`);
      if (typeof v !== 'string' && typeof v?.text !== 'string') errs.push(`${k.id}: レイヤー ${l} のセルは文字列か { text, short } にしてください`);
      if (v?.hold !== undefined && typeof v.hold !== 'string') errs.push(`${k.id}: レイヤー ${l} のセルの hold は機能名（文字列）にしてください`);
      if (oneSymbol(v?.short)) errs.push(`${k.id}: レイヤー ${l} の短縮表記「${v.short}」は記号1文字だけです。キーの出力と取り違えるので使えません（第10.4節）`);
    }
    if (k.base !== undefined && typeof k.base !== 'string' && typeof k.base?.text !== 'string') errs.push(`${k.id}: base は文字列か { text, icon } にしてください`);
    for (const v of [k.base, ...Object.values(k.cells || {})]) if (v?.icon !== undefined && v.icon !== 'one-shot') errs.push(`${k.id}: 出力に付けられるアイコンは one-shot だけです: ${v.icon}`);
    if (k.note !== undefined && typeof k.note !== 'string') errs.push(`${k.id}: note は注釈の本文（文字列）にしてください。番号は描画プログラムが振ります`);
    for (const sw of switches(k)) if (!layerIds.has(sw.layer)) errs.push(`${k.id}: 未定義のレイヤー ${sw.layer}`);
    for (const op of [...(k.taps || []), ...switches(k)]) {
      const icon = op.via ?? op.icon;
      if (icon && icon !== 'hold' && !ICON_FILES[icon]) errs.push(`${k.id}: 未知の操作 ${icon}`);
    }
  }
  if (d.aux) errs.push('aux は廃止しました。Comboの補足は combos[].note に、キーに属さない情報は notes に書いてください');
  for (const n of d.notes || []) {
    if (typeof n !== 'string') errs.push('notes はキーに属さない注釈の本文（文字列）の配列にしてください。キーの注釈は keys[].note に書きます');
    else if (/[。.．](?!$)/.test(n.trim().replace(/\d\.\d/g, ''))) console.error(`警告: 番号なしの注釈は1項目1文にしてください（第8.2節）: ${n}`);
  }
  for (const c of d.combos || []) {
    if (!Array.isArray(c.keys) || c.keys.length < 2) errs.push(`Combo の keys は2つ以上必要です: ${c.text}`);
    for (const id of c.keys || []) if (!keyIds.has(id)) errs.push(`Combo「${c.text}」: 未定義のキー ${id}`);
    if (oneSymbol(c.short)) errs.push(`Combo「${c.text}」: 短縮表記「${c.short}」は記号1文字だけです。キーの出力と取り違えるので使えません（第10.4節）`);
    if (c.kind === 'go' && !layerIds.has(c.layer)) errs.push(`Combo「${c.text}」: layer がありません`);
    if (c.via !== undefined && (c.kind !== 'go' || !['hold', 'toggle', 'to', 'one-shot'].includes(c.via))) errs.push(`Combo「${c.text}」: via は kind が go のときに hold・toggle・to・one-shot のいずれかで書いてください`);
    if (c.kind === 'layer' && ![].concat(c.layer ?? []).length) errs.push(`Combo「${c.text}」: layer がありません`);
    if (c.kind === 'layer') for (const l of [].concat(c.layer ?? [])) if (!layerIds.has(l)) errs.push(`Combo「${c.text}」: 未定義のレイヤー ${l}`);
  }
  if (errs.length) fail('中間データに誤りがあります\n- ' + errs.join('\n- '));
}

// ---------------------------------------------------------------- 寸法（テーマの寸法から全キー共通の配分を作る）
function layout(theme, data, k = 1) {
  const dm = theme.dims;
  const n = data._nSlots; // 表示スロットの数（第3.2節）
  const rows = Math.ceil(n / 2);
  const cellH = dm.cellHeight * KS / k;
  const barH = dm.barHeight * KS / k;
  const fs = { base: dm.baseText * KS / k, cell: dm.cellText * KS / k, op: dm.opText * KS / k, label: dm.labelText * KS / k };
  const rowY = [...Array(rows)].map((_, i) => PAD + i * (cellH + COL_GAP));
  const topEnd = rows ? rowY[rows - 1] + cellH : PAD;
  // 下部の行数は、全キーの中で最も多い操作表示の数（第10.2節）
  const opLines = Math.max(0, ...data.keys.map((k) => opRows(k).length));
  const lineH = Math.max(barH, fs.op * 1.35);
  const opY = [...Array(opLines)].map((_, i) => KS - PAD - lineH * (opLines - i) + lineH / 2); // 各行の中心
  const bottomStart = opLines ? KS - PAD - lineH * opLines : KS - PAD;
  const baseY = (topEnd + bottomStart) / 2;
  return { k, n, rows, cellH, barH, fs, rowY, topEnd, opY, lineH, baseY, cellW: (KS - PAD * 2 - COL_GAP) / 2, mark: 13 / k, longBase: dm.baseTextLong, radius: (theme.key?.radius ?? 0.15) * KS };
}

// ---------------------------------------------------------------- キーの描き方
function keyDefs(t) {
  const k = t.key, s = t.shadow;
  const shadow = s ? `<filter id="kv-sh" x="-25%" y="-25%" width="150%" height="160%">${(s.layers || []).map((l) => `<feDropShadow dx="0" dy="${l.dy}" stdDeviation="${l.blur}" flood-color="${s.color}" flood-opacity="${l.opacity}"/>`).join('')}</filter>` : '';
  const grad = (id, stops, x2 = 1, y2 = 1) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map((c, i) => `<stop offset="${stops.length === 1 ? 0 : r1(i / (stops.length - 1))}" stop-color="${c}"/>`).join('')}</linearGradient>`;
  let defs = shadow;
  if (k.style === 'clay') {
    defs += grad('kv-body', k.body) + grad('kv-face', k.face)
      + `<linearGradient id="kv-rim-light" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${k.rimLight}" stop-opacity=".95"/><stop offset=".45" stop-color="${k.rimLight}" stop-opacity="0"/></linearGradient>`
      + `<linearGradient id="kv-rim-shade" x1="0" y1="0" x2="1" y2="1"><stop offset=".55" stop-color="${k.rimShade}" stop-opacity="0"/><stop offset="1" stop-color="${k.rimShade}" stop-opacity=".55"/></linearGradient>`;
  }
  const g = t.ground;
  if (g?.type === 'linear') defs += grad('kv-ground', [g.from, g.to], 0, 1);
  return defs;
}

function keyShape(t) {
  const k = t.key, r = (k.radius ?? 0.15) * KS, f = t.shadow ? ' filter="url(#kv-sh)"' : '';
  if (k.style === 'clay') {
    const fr = r - 3.5;
    return `<g${f}><rect width="${KS}" height="${KS}" rx="${r1(r)}" fill="url(#kv-body)"/>`
      + `<rect x=".6" y=".6" width="${KS - 1.2}" height="${KS - 1.2}" rx="${r1(r - 0.6)}" fill="none" stroke="url(#kv-rim-shade)" stroke-width="1.2"/>`
      + `<rect x="4" y="3.2" width="${KS - 8}" height="${KS - 8.6}" rx="${r1(fr)}" fill="url(#kv-face)"/>`
      + `<rect x="4" y="3.2" width="${KS - 8}" height="${KS - 8.6}" rx="${r1(fr)}" fill="none" stroke="url(#kv-rim-light)" stroke-width="1.4"/></g>`;
  }
  // flat：平面に枠線
  return `<rect width="${KS}" height="${KS}" rx="${r1(r)}" fill="${k.surface}" stroke="${k.border || mix(t.text.base, k.surface, 0.25)}" stroke-width="1"${f}/>`;
}

// ---------------------------------------------------------------- 配色（第3.1節「色の濃淡の意味」）
// この図に表示する追加レイヤー（第3.2節）。show: false のレイヤーはセルと凡例を持たない
const shown = (data) => data.layers.filter((l) => l.show !== false);

function palette(t, data) {
  // 図を分けても同じレイヤーは同じ色にするため、全レイヤーの並び順で色を割り当てる。テーマの色が足りなければ color の指定を求める
  const auto = data.layers.filter((l) => !l.color);
  if (data.layers.length > t.layers.length && auto.length) fail(`追加レイヤーが ${data.layers.length} つあり、テーマのレイヤー色（${t.layers.length} 色）より多いため、color を指定してください: ${auto.map((l) => l.id).join(', ')}`);
  const surface = t.key.surface;
  const C = {};
  data.layers.forEach((l, i) => {
    const col = l.color || t.layers[i % t.layers.length];
    const tint = mix(col, surface, t.tintRatio ?? 0.35);
    C[l.id] = {
      solid: readable(col, '#ffffff', '#000000'), // 濃い色＝行く（白抜き文字が読める濃さ）
      tint, // 淡い色＝いる間だけ
      text: readable(col, tint, '#000000'),
      name: l.name,
    };
  });
  return {
    C,
    neutral: readable(t.neutral, '#ffffff', '#000000'),
    op: readable(mix(t.text.base, surface, 0.62), surface, t.text.base),
    sub: t.text.sub,
    base: t.text.base,
  };
}

// ---------------------------------------------------------------- Combo（第6章）
// 注釈マーカーが付きうるキー。セルの短縮表記を使う可能性があるキーにも付く（第8.2節）
const hasMark = (k, opts = {}) => !!(k.note || (opts.short && Object.values(k.cells || {}).some((v) => v?.short)));
// 1キーに複数ある識別子の縦のずれ（第6.4節）。基本入力の高さから下へ積み、キーの下端（マーカーがあればその上端）を越える分は上へ積む
const identDy = (k, n, s, opts, L) => {
  const limit = hasMark(k, opts) ? KS - markInset(L) - 1 : KS;
  const down = Math.max(0, Math.floor((limit - (L.baseY + s / 2)) / (s + 2)));
  return (n <= down ? n : -(n - down)) * (s + 2);
};
const keyBox = (k) => [k.x + IN, k.y + IN, KS, KS];
function isHorizontalPair(a, b) {
  if (a.rot || b.rot) return false;
  const [l, r] = a.x <= b.x ? [a, b] : [b, a];
  const dx = r.x - l.x;
  const overlap = Math.min(l.y, r.y) + PITCH - Math.max(l.y, r.y);
  return Math.abs(dx - PITCH) < PITCH * 0.25 && overlap > PITCH * 0.3;
}
// 上下に隣接する2キー。ラベルは2キーの共有する横の境界上に置く（第6.1節）
function isVerticalPair(a, b) {
  if (a.rot || b.rot) return false;
  const [t, u] = a.y <= b.y ? [a, b] : [b, a];
  const overlap = Math.min(t.x, u.x) + PITCH - Math.max(t.x, u.x);
  return Math.abs(u.y - t.y - PITCH) < PITCH * 0.25 && overlap > PITCH * 0.3;
}
// 境界上のComboラベルの幅。1文字のラベルが小さな丸に見えて読みにくくならないよう、最小幅を設ける（第5章）
// Comboの識別子。英大文字で、26個を超えたら27個目から AA、AB…の2文字にする（第6.2節）
const identLetter = (i) => (i < 26 ? String.fromCharCode(65 + i) : identLetter(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
// 識別子の幅。1文字は高さと同じ幅、2文字は文字に合わせて横に広げる
const identWidth = (t, fsz) => Math.max(fsz + 4, [...t].length > 1 ? textWidth(t, fsz) + fsz * 0.6 : 0);
const labelWidth = (t, fsz, icon = false) => Math.max(textWidth(t, fsz) + fsz * LABEL_PAD + (icon ? fsz * (ONE_SHOT.size + ONE_SHOT.gap) : 0), fsz * LABEL_MIN_W);
// レイヤー切り替えのComboで、長押し以外の操作で切り替えるものは、ラベルに操作記号を付ける（第6章）
const comboIcon = (c) => (c.kind === 'go' && c.via && c.via !== 'hold' ? c.via : null);

function obstacles(k, L, iconSize, opts = {}) {
  const [x0, y0] = keyBox(k);
  const o = [];
  const bfs = baseSize(k, L), bw = baseWidth(k, bfs);
  if (k.base) o.push([x0 + KS / 2 - bw / 2, y0 + L.baseY - bfs * 0.42, bw, bfs * 0.84]);
  Object.keys(k.cells || {}).forEach((id) => { const c = cellRect(L, k._layerIndex[id]); o.push([x0 + c[0], y0 + c[1], c[2], c[3]]); });
  opRows(k).forEach((op, i) => {
    const y = L.opY[L.opY.length - opRows(k).length + i];
    if (op.kind === 'switch' || op.kind === 'lhold') o.push([x0 + PAD, y0 + y - L.barH / 2, KS - PAD * 2, L.barH]);
    else { const w = textWidth(op.text, L.fs.op) + (op.icon ? iconSize + 2.5 : 0); o.push([x0 + KS / 2 - w / 2, y0 + y - L.fs.op * 0.6, w, L.fs.op * 1.2]); }
  });
  if (hasMark(k, opts)) { const [mx, my] = markPos(k, L); o.push([mx - 1, my - 1, L.mark + 2, L.mark + 2]); }
  return o;
}
// 注釈マーカーは、中心をキーの右下の角の縁（角丸なら丸みの縁）に合わせて置く（第8.1節）。外へのはみ出しはキー間隔までにする
const markInset = (L) => Math.max(L.mark / 2 + L.radius * (1 - Math.SQRT1_2), L.mark - (PITCH - KS));
function markPos(k, L) {
  const inside = markInset(L);
  return [k.x + IN + KS - inside, k.y + IN + KS - inside];
}
const hit = (r, s) => r[0] < s[0] + s[2] && s[0] < r[0] + r[2] && r[1] < s[1] + s[3] && s[1] < r[1] + r[3];

function cellRect(L, i) {
  const row = Math.floor(i / 2), col = i % 2;
  const wide = L.n % 2 === 1 && i === L.n - 1; // 奇数個目は幅いっぱい（第3.2節）
  if (L.n === 1 || wide) return [PAD, L.rowY[row], KS - PAD * 2, L.cellH];
  return [PAD + col * (L.cellW + COL_GAP), L.rowY[row], L.cellW, L.cellH];
}

function opRows(k) {
  const rows = [];
  if (k.hold) rows.push({ kind: 'hold', text: k.hold });
  // 追加レイヤー内の Hold は、Base の Hold の下に、表示スロットの順で並べる（第4.5節）
  const lh = Object.entries(k.cells || {}).filter(([, v]) => v?.hold).sort(([a], [b]) => (k._layerIndex?.[a] ?? 0) - (k._layerIndex?.[b] ?? 0));
  for (const [layer, v] of lh) rows.push({ kind: 'lhold', layer, text: v.hold });
  for (const t of k.taps || []) rows.push({ kind: 'tap', icon: t.icon, text: t.text });
  for (const sw of switches(k)) rows.push({ kind: 'switch', layer: sw.layer, icon: sw.via && sw.via !== 'hold' ? sw.via : null });
  return rows;
}

// 基本入力の大きさ。キーの内側の幅に収まらなければ縮める（第10.4節）。下限でも収まらないものは over にして警告の対象にする
const baseFull = (k, L) => ([...(k.base || '')].length > 1 ? L.fs.base * (L.longBase ?? 0.71) : L.fs.base);
const baseWidth = (k, fs) => textWidth(k.base || '', fs) + (k.baseIcon ? fs * (ONE_SHOT.size + ONE_SHOT.gap) : 0);
function baseFit(k, L) {
  const fs = baseFull(k, L);
  const f = [1, ...SHRINK].find((x) => baseWidth(k, fs * x) <= KS - PAD * 2);
  return { fs: fs * (f ?? SHRINK.at(-1)), over: f === undefined };
}
const baseSize = (k, L) => baseFit(k, L).fs;

// 試す表記：正式名（文字縮小を含む）→ 短縮表記（文字縮小を含む）（第10.4節）
function variants(c, opts) {
  const fs = [1, ...(opts.shrink ? SHRINK : [])], v = fs.map((f) => ({ text: c.text, f }));
  if (opts.short && c.short) v.push(...fs.map((f) => ({ text: c.short, f, short: true })));
  return v;
}

// セルは文字列か { text, short }（第10.10節）
// レイヤー切り替えは1つか配列で書ける（第4.3節）
const switches = (k) => [].concat(k.switch ?? []);
const cellOf = (v) => (typeof v === 'string' ? { text: v } : v);

// セルの表記を決める（第10.4節）。どれでも収まらなければ下限の大きさで描き、警告の対象にする
function placeCells(data, L, opts = {}) {
  const out = new Map();
  let failed = 0;
  for (const k of data.keys) {
    const m = {};
    for (const [id, raw] of Object.entries(k.cells || {})) {
      const c = cellOf(raw), cw = cellRect(L, k._layerIndex[id])[2];
      const v = variants(c, opts);
      const iw = (f) => (c.icon ? L.fs.cell * f * (ONE_SHOT.size + ONE_SHOT.gap) : 0);
      const ok = v.find((x) => textWidth(x.text, L.fs.cell * x.f) + iw(x.f) <= cw - 4);
      if (!ok) failed++;
      m[id] = { ...(ok || { text: c.short || c.text, f: SHRINK.at(-1), short: !!c.short, over: true }), full: c.text, icon: c.icon };
    }
    out.set(k, m);
  }
  return { cells: out, failed };
}

function placeCombos(data, L, iconSize, opts = {}) {
  const K = Object.fromEntries(data.keys.map((k) => [k.id, k]));
  const labels = [], idents = [];
  for (const c of data.combos || []) {
    const ks = c.keys.map((id) => K[id]);
    if (ks.length === 2 && isHorizontalPair(ks[0], ks[1])) labels.push({ ...c, a: ks[0].x <= ks[1].x ? ks[0] : ks[1], b: ks[0].x <= ks[1].x ? ks[1] : ks[0] });
    else if (ks.length === 2 && isVerticalPair(ks[0], ks[1])) labels.push({ ...c, dir: 'v', a: ks[0].y <= ks[1].y ? ks[0] : ks[1], b: ks[0].y <= ks[1].y ? ks[1] : ks[0] });
    else idents.push({ ...c, members: ks });
  }
  // 候補位置：基準 → 上方向（近い行から）→ 下方向（近い行から）
  const cands = [{ name: 'base', y: L.baseY }];
  for (let i = L.rows - 1; i >= 0; i--) cands.push({ name: `top${i + 1}`, y: L.rowY[i] + L.cellH / 2 });
  L.opY.forEach((y, i) => cands.push({ name: `bottom${i + 1}`, y }));
  // 上下の2キーは、共有する横の境界の中央に置く。位置の候補はこの1つだけ
  const vSpan = (c) => [Math.max(c.a.x, c.b.x) + IN, Math.min(c.a.x, c.b.x) + IN + KS];
  const rect = (c, cand, v = { text: c.text, f: 1 }) => {
    const fsz = L.fs.label * v.f, h = fsz + 4;
    const w = labelWidth(v.text, fsz, !!comboIcon(c));
    if (c.dir === 'v') { const [l, r] = vSpan(c); return [(l + r) / 2 - w / 2, (c.a.y + IN + KS + c.b.y + IN) / 2 - h / 2, w, h]; }
    const cx = (c.a.x + IN + KS + c.b.x + IN) / 2;
    const ay = c.a.y + IN + cand.y, by = c.b.y + IN + cand.y;
    const top = Math.max(c.a.y, c.b.y) + IN, bottom = Math.min(c.a.y, c.b.y) + IN + KS;
    const cy = Math.min(Math.max((ay + by) / 2, top + h / 2), bottom - h / 2); // 2キーの共通範囲に収める
    return [cx - w / 2, cy - h / 2, w, h];
  };
  // 識別子（右枠線上、基本入力の高さ）も避ける対象にする
  const identRects = [];
  const cnt = {};
  for (const c of idents) for (const k of c.members) {
    const n = (cnt[k.id] = (cnt[k.id] || 0) + 1) - 1, sz = L.fs.label + 4, w = identWidth((data.combos || []).length > 26 ? 'AA' : 'A', L.fs.label);
    identRects.push([k.x + IN + KS - w / 2, k.y + IN + L.baseY - sz / 2 + identDy(k, n, sz, opts, L), w, sz]);
  }
  // 配置済みのComboラベルも避ける（第6.1節）
  const placedRects = [];
  const fits = (c, cand, v) => {
    const r = rect(c, cand, v);
    if (c.dir === 'v') { const [l, rr] = vSpan(c); if (r[2] > rr - l) return false; } // 2キーの共通の幅に収める
    return [...obstacles(c.a, L, iconSize, opts), ...obstacles(c.b, L, iconSize, opts), ...identRects, ...placedRects].every((o) => !hit(r, o));
  };
  // 各Comboを個別に、候補位置の順に試す
  const fallback = [];
  for (const c of labels) {
    let placed = null;
    for (const v of variants(c, opts)) { const cand = (c.dir === 'v' ? [{ name: 'border' }] : cands).find((cd) => fits(c, cd, v)); if (cand) { placed = { v, cand }; break; } }
    if (placed) { c.rect = rect(c, placed.cand, placed.v); c.cand = placed.cand.name; c.draw = placed.v; placedRects.push(c.rect); }
    else fallback.push(c); // どこにも置けなければ識別子方式へ（第6.1節）
  }
  for (const c of fallback) idents.push({ ...c, members: [c.a, c.b], fallback: true });
  // 識別子は英大文字。左半分→右半分、上の行→下の行、左→右（第6.2節・第8.2節）
  const { order, cmp } = keyOrder();
  idents.sort((p, q) => cmp(order(p.members.slice().sort((x, y) => cmp(order(x), order(y)))[0]), order(q.members.slice().sort((x, y) => cmp(order(x), order(y)))[0])));
  idents.forEach((c, i) => { c.letter = identLetter(i); });
  return { labels: labels.filter((c) => c.rect), idents, failed: fallback.length };
}

// 採番の順：左半分→右半分、上の行→下の行、左→右（第6.2節・第8.2節）。左右は compressSplit が _side に入れる
function keyOrder() {
  const order = (k) => [k._side, Math.round(k.y / PITCH), k.x];
  const cmp = (p, q) => { for (let i = 0; i < 3; i++) if (p[i] !== q[i]) return p[i] - q[i]; return 0; };
  return { order, cmp };
}

// 分割型の左右の境目。キーの横位置が最も大きく離れているところで分ける（第10.10節）
function splitX(keys) {
  const xs = [...new Set(keys.map((k) => k.x))].sort((a, b) => a - b);
  let best = { gap: 0, at: Infinity };
  for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] > best.gap) best = { gap: xs[i] - xs[i - 1], at: (xs[i] + xs[i - 1] + KS) / 2 };
  return best;
}

// 分割型は、左右の間隔を実際の距離ではなく SPLIT_GAP に詰める（第10.1節）。左右それぞれの中の配置は変えない
function keyCorners(k) {
  const [x0, y0] = keyBox(k), pts = [[x0, y0], [x0 + KS, y0], [x0, y0 + KS], [x0 + KS, y0 + KS]];
  if (!k.rot) return pts;
  const cx = k.rx ?? k.x + PITCH / 2, cy = k.ry ?? k.y + PITCH / 2, a = (k.rot * Math.PI) / 180;
  return pts.map(([x, y]) => [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)]);
}
// 分割型かどうかは入力の meta.split に従い、キーの間隔から推定しない（第10.0節）。一体型は間隔を詰めず、採番も全体を1つとして扱う
function compressSplit(data) {
  if (!data.meta.split) return { ...data, keys: data.keys.map((k) => ({ ...k, _side: 0 })) };
  const { gap, at: split } = splitX(data.keys);
  if (gap <= PITCH) fail('meta.split が true ですが、左右のキーの間が空いていません。左半分と右半分が横方向に重ならず、間が1u以上空く座標にしてください（第10.10節）');
  const right = (k) => k.x + KS / 2 >= split;
  const leftEdge = Math.max(...data.keys.filter((k) => !right(k)).flatMap((k) => keyCorners(k).map((p) => p[0])));
  const rightEdge = Math.min(...data.keys.filter(right).flatMap((k) => keyCorners(k).map((p) => p[0])));
  const dx = Math.max(0, rightEdge - leftEdge - (SPLIT_GAP - (PITCH - KS)));
  const keys = data.keys.map((k) => (right(k) ? { ...k, _side: 1, x: k.x - dx, ...(k.rx !== undefined ? { rx: k.rx - dx } : {}) } : { ...k, _side: 0 }));
  return { ...data, keys };
}

// 表示スロットの割り当て（第3.2節）。凡例の順に、同じキーに出力を持つレイヤーが使っていない最も若いスロットを選ぶ
// 同じキーに同時に出力を持たないレイヤー同士はスロットを共有する。各レイヤーの位置は全キーで同じになる
function assignSlots(data) {
  const co = Object.fromEntries(shown(data).map((l) => [l.id, new Set()]));
  for (const k of data.keys) { const ids = Object.keys(k.cells || {}); for (const a of ids) for (const b of ids) if (a !== b) co[a].add(b); }
  const slot = {};
  for (const l of shown(data)) { let i = 0; while (Object.entries(slot).some(([m, v]) => v === i && co[l.id].has(m))) i++; slot[l.id] = i; }
  data._nSlots = Math.max(0, ...Object.values(slot).map((v) => v + 1));
  data.keys.forEach((k) => { k._layerIndex = slot; });
}

// ---------------------------------------------------------------- 描画
// 第10.4節の手段を試して、全キー共通の寸法と表記を決める
function fit(theme, data) {
  // 第10.4節の順で試す：1. 文字縮小 → 2. キー拡大 → 3. 短縮表記。Comboラベル・セルの文字・基本入力を一緒に判定する
  // 全て収まる最初の組み合わせを選ぶ。どれでも残る場合は、収まらない数が最も少ない組み合わせを選び、数が同じなら基本入力の高さの不足が小さいほうを選ぶ
  // 収まらないComboは識別子方式に、収まらないセルの文字と基本入力は下限の大きさで描いて警告する
  let best = null;
  search: for (const opts of [{ shrink: true }, { shrink: true, short: true }]) {
    for (const k of ENLARGE) {
      const l = layout(theme, data, k), isz = l.fs.op * 1.2, r = placeCombos(data, l, isz, opts), cs = placeCells(data, l, opts);
      // 基本入力が中央の領域（上部と下部の間）に収まり、キーの内側の幅にも収まるか
      const bottomStart = l.opY.length ? l.opY[0] - l.lineH / 2 : KS - PAD;
      const vover = Math.max(0, l.topEnd - (l.baseY - l.fs.base * 0.42), l.baseY + l.fs.base * 0.42 - bottomStart), vfail = vover > 0 ? 1 : 0;
      const wfail = data.keys.filter((x) => x.base && baseFit(x, l).over).length;
      const failed = r.failed + cs.failed + vfail + wfail;
      if (!best || failed < best.failed || (failed === best.failed && vover < best.vover)) best = { l, isz, r, cs, failed, vover, opts };
      if (!failed) break search;
    }
  }
  return best;
}

// 追加レイヤー内の Hold をセルから外し、そのキーの注釈に移す（第4.5節）
function holdsToNotes(data, words) {
  const name = Object.fromEntries(data.layers.map((l) => [l.id, l.name]));
  const end = (t) => (/[。.．!?！？]$/.test(t) ? t : t + words.stop.trim());
  const keys = data.keys.map((k) => {
    const parts = [];
    const cells = Object.fromEntries(Object.entries(k.cells || {}).map(([id, v]) => {
      if (!v?.hold) return [id, v];
      parts.push(words.holdIn(name[id], v.hold));
      const { hold, ...rest } = v;
      return [id, rest];
    }));
    return parts.length ? { ...k, cells, note: [k.note, ...parts].filter(Boolean).map(end).join(words.stop === '。' ? '' : ' ') } : k;
  });
  return { ...data, keys };
}

function render(data, theme, icons) {
  const P = palette(theme, data);
  const W8 = theme.dims.weights || {};
  const words = WORDS[data.meta.language] || WORDS.ja;
  assignSlots(data);
  let best = fit(theme, data);
  // 追加レイヤー内の Hold を下部に描くと収まらない場合は、その図のすべてを注釈にまとめる（第4.5節）。図の中で表し方を混ぜない
  if (best.failed && data.keys.some((k) => Object.values(k.cells || {}).some((v) => v?.hold))) {
    const alt = holdsToNotes(data, words);
    assignSlots(alt);
    const b2 = fit(theme, alt);
    if (b2.failed < best.failed) { data = alt; best = b2; console.error('情報: 追加レイヤーの Hold を下部に描くと収まらないため、この図ではすべて注釈にまとめました（第4.5節）'); }
  }
  const L = best.l, iconSize = best.isz, placed = best.r, cellDraw = best.cs.cells;
  const { labels, idents } = placed;
  for (const [k, m] of cellDraw) for (const [id, c] of Object.entries(m)) {
    if (c.over) console.error(`警告: ${k.base || k.id} の ${id} セル「${c.full}」が${SHRINK.at(-1) * 100}%に縮めても収まりません。短縮表記（short）を指定してください`);
  }
  for (const k of data.keys) if (k.base && baseFit(k, L).over) console.error(`警告: ${k.id} の基本入力「${k.base}」が${SHRINK.at(-1) * 100}%に縮めても収まりません。表記を短くしてください`);

  const icon = (id, x, cy, color, size = iconSize) => {
    const ic = icons[id], s = size / 24, iconSize_ = size;
    const attrs = ic.attrs.replace(/\s(xmlns|viewBox|width|height)="[^"]*"/g, '').replace(/currentColor/g, color);
    return `<g transform="translate(${r1(x)},${r1(cy - iconSize_ / 2)}) scale(${r1(s * 1000) / 1000})" ${attrs.replace(/stroke="currentColor"/g, `stroke="${color}"`)} color="${color}">${ic.inner.replace(/currentColor/g, color)}</g>`;
  };
  // ワンショット修飾キーは、出力の前にワンショットアイコンを付ける（第4.7節）
  const withIcon = (ic, t, cx, cy, fs, attrs, color) => {
    if (!ic) return text(t, `x="${r1(cx)}" y="${r1(cy + fs * 0.36)}" ${attrs} text-anchor="middle"`);
    const sz = fs * ONE_SHOT.size, gap = fs * ONE_SHOT.gap, x = cx - (sz + gap + textWidth(t, fs)) / 2;
    return icon(ic, x, cy, color, sz) + text(t, `x="${r1(x + sz + gap)}" y="${r1(cy + fs * 0.36)}" ${attrs}`);
  };

  // キーボード領域の大きさ
  const minX = Math.min(...data.keys.map((k) => k.x)), minY = Math.min(...data.keys.map((k) => k.y));
  const maxX = Math.max(...data.keys.map((k) => k.x + PITCH)), maxY = Math.max(...data.keys.map((k) => k.y + PITCH + (k.rot ? 20 : 0)));
  const M = 70, HEAD = 190, KZ = L.k;
  const OX = -minX, OY = -minY;
  // 注釈（第8章）：キーの注釈と、短縮表記を使ったセルの正式名を1つの番号にまとめる。キーに属さない注釈は番号なしで末尾に置く
  const { order, cmp } = keyOrder();
  const end = (t) => (/[。.．!?！？]$/.test(t) ? t : t + words.stop.trim());
  const notes = data.keys
    .map((k) => {
      const parts = Object.values(cellDraw.get(k) || {}).filter((c) => c.short).map((c) => `${c.text}${words.colon}${c.full}`);
      if (k.note) parts.push(k.note);
      // 同じキーで同じ短縮表記を複数のセルに使った場合も、正式名は1回だけ書く
      return { k, text: [...new Set(parts.map(end))].join(words.stop === '。' ? '' : ' ') };
    })
    .filter((n) => n.text)
    .sort((p, q) => cmp(order(p.k), order(q.k)));
  notes.forEach((n, i) => { n.n = i + 1; n.k._noteNo = n.n; });
  notes.push(...(data.notes || []).map((t) => ({ text: t })));
  // Combo欄（第6章）：識別子の対応表、短縮表記の正式名、Comboの補足
  const K = Object.fromEntries(data.keys.map((k) => [k.id, k]));
  const keysOf = (c) => c.keys.map((id) => K[id]?.base || id).join(words.and);
  // 目的で表したレイヤー切り替えのComboは、切り替え先をCombo欄に書く（第6章）
  const layerName = Object.fromEntries(data.layers.map((l) => [l.id, l.name]));
  const goNote = (c) => (c.letter && comboIcon(c) ? words.viaGo[c.via](layerName[c.layer]) : c.kind === 'go' && c.text !== layerName[c.layer] ? words.goTo(layerName[c.layer]) : '');
  const comboLine = (c) => `${keysOf(c)}${words.dash}${[c.text, goNote(c), c.note].filter(Boolean).map((t, i, a) => (a.length > 1 ? end(t) : t)).join(words.stop === '。' ? '' : ' ')}`;
  // Combo欄の各行の頭には、キーマップ上と同じ見た目のマーク（識別子、またはラベル）を付ける
  const HEAD_FS = 9.5, HEAD_H = 13, HEAD_GAP = 9;
  const headW = (h) => (h.kind === 'ident' ? identWidth(h.text, HEAD_H - 4) : labelWidth(h.text, HEAD_FS, !!h.icon));
  const combos = [
    ...idents.map((c) => ({ c, head: { kind: 'ident', text: c.letter }, body: comboLine(c) })),
    ...labels.filter((c) => c.draw?.short || c.note || goNote(c)).map((c) => ({ c, head: { kind: 'label', text: c.draw.text, icon: comboIcon(c) }, body: comboLine(c) })),
  ];
  const kbW = (maxX - minX) * KZ, kbH = (maxY - minY) * KZ;
  const W = Math.max(kbW + M * 2, 900);
  const footTop = HEAD + kbH + 50;
  // 注釈欄とCombo欄は、欄の幅で折り返す。行が増えた分はキャンバスを縦に延ばす（第8.3節）
  const FOOT_FS = 12.5, FOOT_LH = 18, FOOT_GAP = 4, MARK_W = 22, FOOT_COL_GAP = 40;
  const colX = [M, notes.length ? Math.max(M + 520, W / 2) : M];
  // 多くのComboに共通の有効条件は、Combo欄の先頭に1回だけ書く（第10.7節）
  const comboCommon = data.comboNote && data.combos?.length ? data.comboNote : '';
  const hasCombo = combos.length > 0 || !!comboCommon;
  const noteW = (hasCombo ? colX[1] - FOOT_COL_GAP : W - M) - (M + MARK_W), comboW = W - M - colX[1];
  const commonLines = comboCommon ? wrap(comboCommon, comboW, FOOT_FS) : [];
  notes.forEach((n) => { n.lines = wrap(n.text, noteW, FOOT_FS); });
  combos.forEach((it) => { it.lines = wrap(it.body, comboW - headW(it.head) - HEAD_GAP, FOOT_FS); });
  const comboItems = combos.map((it) => it.lines);
  const colH = (items) => items.reduce((h, ls) => h + ls.length * FOOT_LH + FOOT_GAP, 0);
  const footH = Math.max(colH(notes.map((n) => n.lines)), colH(commonLines.length ? [commonLines, ...comboItems] : comboItems));
  const H = footTop + (notes.length || hasCombo ? 60 + footH : 0) + 40;

  let out = '';
  // 使っていないキー（第9.0.1節）は、実機の形を伝えるため、文字のない薄い枠として描く
  const inCombo = new Set((data.combos || []).flatMap((c) => c.keys));
  const unused = (k) => !k.base && !Object.keys(k.cells || {}).length && !k.hold && !k.taps?.length && !k.switch && !k.note && !inCombo.has(k.id);
  const groundColor = theme.ground?.type === 'linear' ? theme.ground.from : theme.ground?.color || '#ffffff';
  const unusedShape = `<rect x=".6" y=".6" width="${KS - 1.2}" height="${KS - 1.2}" rx="${r1(L.radius)}" fill="none" stroke="${mix(P.base, groundColor, 0.22)}" stroke-width="1.2"/>`;
  // キー
  for (const k of data.keys) {
    const [x0, y0] = keyBox(k);
    const tr = `translate(${r1(OX + x0)},${r1(OY + y0)})` + (k.rot ? ` rotate(${k.rot},${r1((k.rx ?? k.x + PITCH / 2) - x0)},${r1((k.ry ?? k.y + PITCH / 2) - y0)})` : '');
    if (unused(k)) { out += `<g transform="${tr}">${unusedShape}</g>`; continue; }
    let g = keyShape(theme);
    for (const [id, c] of Object.entries(cellDraw.get(k) || {})) {
      const [cx, cy, cw, ch] = cellRect(L, k._layerIndex[id]);
      const fs = L.fs.cell * c.f, v = c.text; // 縮小は下限まで（第10.4節）
      g += `<rect x="${r1(cx)}" y="${r1(cy)}" width="${r1(cw)}" height="${r1(ch)}" rx="${r1(ch * 0.3)}" fill="${P.C[id].tint}"/>`
        + withIcon(c.icon, v, cx + cw / 2, cy + ch / 2, fs, `font-size="${r1(fs)}" font-weight="${W8.cell ?? 700}" fill="${P.C[id].text}"`, P.C[id].text);
    }
    if (k.base) { const bfs = baseSize(k, L); g += withIcon(k.baseIcon, k.base, KS / 2, L.baseY, bfs, `font-size="${r1(bfs)}" font-weight="${W8.base ?? 700}" fill="${P.base}"`, P.base); }
    const rows = opRows(k);
    rows.forEach((op, i) => {
      const cy = L.opY[L.opY.length - rows.length + i];
      if (op.kind === 'switch') {
        const c = P.C[op.layer], name = c.name;
        const tw = textWidth(name, L.fs.op) + (op.icon ? iconSize + 2.5 : 0), x = KS / 2 - tw / 2;
        g += `<rect x="${PAD}" y="${r1(cy - L.barH / 2)}" width="${KS - PAD * 2}" height="${r1(L.barH)}" rx="${r1(L.barH * 0.3)}" fill="${c.solid}"/>`
          + (op.icon ? icon(op.icon, x, cy, '#ffffff') : '')
          + text(name, `x="${r1(op.icon ? x + iconSize + 2.5 : KS / 2)}" y="${r1(cy + L.fs.op * 0.36)}" font-size="${r1(L.fs.op)}" font-weight="${W8.op ?? 700}" fill="#ffffff"${op.icon ? '' : ' text-anchor="middle"'}`);
      } else if (op.kind === 'lhold') {
        // 追加レイヤー内の Hold は、そのレイヤーのセルと同じ配色の帯で描く（第4.5節）。帯に収まらなければ帯の幅まで縮める
        const c = P.C[op.layer], max = KS - PAD * 2 - 6, fs = L.fs.op * Math.max(SHRINK.at(-1), Math.min(1, max / textWidth(op.text, L.fs.op)));
        g += `<rect x="${PAD}" y="${r1(cy - L.barH / 2)}" width="${KS - PAD * 2}" height="${r1(L.barH)}" rx="${r1(L.barH * 0.3)}" fill="${c.tint}"/>`
          + text(op.text, `x="${KS / 2}" y="${r1(cy + fs * 0.36)}" font-size="${r1(fs)}" font-weight="${W8.op ?? 700}" fill="${c.text}" text-anchor="middle"`);
      } else {
        const tw = textWidth(op.text, L.fs.op) + (op.icon ? iconSize + 2.5 : 0), x = KS / 2 - tw / 2;
        g += (op.icon ? icon(op.icon, x, cy, P.op) : '')
          + text(op.text, `x="${r1(op.icon ? x + iconSize + 2.5 : KS / 2)}" y="${r1(cy + L.fs.op * 0.36)}" font-size="${r1(L.fs.op)}" font-weight="${W8.op ?? 700}" fill="${P.op}"${op.icon ? '' : ' text-anchor="middle"'}`);
      }
    });
    out += `<g transform="${tr}">${g}</g>`;
  }
  // Comboの配色（第6章）
  // 複数の追加レイヤーで有効なComboは、各レイヤーの淡い色で左右に塗り分ける（第6章）
  let gradN = 0;
  const comboColor = (c) => {
    if (c.kind === 'go') return { bg: P.C[c.layer].solid, fg: '#ffffff' };
    if (c.kind !== 'layer') return { bg: P.neutral, fg: '#ffffff' };
    const ls = [].concat(c.layer).sort((p, q) => data.layers.findIndex((l) => l.id === p) - data.layers.findIndex((l) => l.id === q)); // 凡例の順
    if (ls.length === 1) return { bg: P.C[ls[0]].tint, fg: P.C[ls[0]].text };
    const id = `kv-combo${gradN++}`, step = 100 / ls.length;
    const stops = ls.map((l, i) => `<stop offset="${r1(i * step)}%" stop-color="${P.C[l].tint}"/><stop offset="${r1((i + 1) * step)}%" stop-color="${P.C[l].tint}"/>`).join('');
    const fg = ls.every((l) => contrast(P.base, P.C[l].tint) >= 4.5) ? P.base : '#000000';
    return { bg: `url(#${id})`, fg, defs: `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">${stops}</linearGradient></defs>` };
  };
  for (const c of labels) {
    const [x, y, w, h] = c.rect, col = comboColor(c), fsz = L.fs.label * c.draw.f;
    out += (col.defs || '') + `<rect x="${r1(OX + x)}" y="${r1(OY + y)}" width="${r1(w)}" height="${r1(h)}" rx="${r1(h * COMBO_R)}" fill="${col.bg}"/>`
      + withIcon(comboIcon(c), c.draw.text, OX + x + w / 2, OY + y + h / 2, fsz, `font-size="${r1(fsz)}" font-weight="${W8.label ?? 700}" fill="${col.fg}"`, col.fg);
  }
  const stack = {};
  for (const c of idents) {
    const col = comboColor(c);
    out += col.defs || '';
    for (const k of c.members) {
      const n = (stack[k.id] = (stack[k.id] || 0) + 1) - 1;
      const s = L.fs.label + 4, w = identWidth(c.letter, L.fs.label), x = OX + k.x + IN + KS - w / 2, y = OY + k.y + IN + L.baseY - s / 2 + identDy(k, n, s, best.opts, L);
      out += `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(s)}" rx="${r1(s * COMBO_R)}" fill="${col.bg}"/>` + text(c.letter, `x="${r1(x + w / 2)}" y="${r1(y + s / 2 + L.fs.label * 0.36)}" font-size="${r1(L.fs.label)}" font-weight="${W8.label ?? 700}" fill="${col.fg}" text-anchor="middle"`);
    }
  }

  // 注釈マーカー（第8.1節）。Base の Combo（ダークグレーの地に白抜き）と見分けられるよう、白地にダークグレーの枠線と番号で描く
  const noteMark = (x, y, z, label, fsz, dy) => `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(z)}" height="${r1(z)}" rx="${r1(z * 0.23)}" fill="#ffffff" stroke="${P.neutral}" stroke-width="1.1"/>`
    + text(label, `x="${r1(x + z / 2)}" y="${r1(y + dy)}" font-size="${r1(fsz)}" font-weight="700" fill="${P.neutral}" text-anchor="middle"`);
  // 注釈マーカーは最前面に描く（第8.1節）。下部の操作表示とは重なってよい
  for (const k of data.keys.filter((k) => k._noteNo)) {
    const [mx, my] = markPos(k, L), x = OX + mx, y = OY + my, z = L.mark;
    const m = noteMark(x, y, z, String(k._noteNo), z * 0.7, z * 0.74);
    // 回転したキーでは、キーと同じ中心・角度で回して角に合わせる
    out += k.rot ? `<g transform="rotate(${k.rot},${r1(OX + (k.rx ?? k.x + PITCH / 2))},${r1(OY + (k.ry ?? k.y + PITCH / 2))})">${m}</g>` : m;
  }
  // ヘッダ・凡例（第10.7節）
  const m = data.meta;
  const sep = /[\u3000-\u9fff\uff00-\uffef]$/.test(m.keyboard) ? '' : ' ';
  const title = m.title || `${m.keyboard}${sep}${words.keymap} — ${m.os}`;
  let head = text(title, `x="${M}" y="74" font-size="30" font-weight="${W8.base ?? 700}" fill="${P.base}"`)
    + text(`${words.source}：${m.source.repo} @ ${m.source.commit}${m.source.path ? `（${m.source.path}）` : ''}　${words.spec}：${m.spec || 'キーマップ可視化 デザインルール v0.3'}`, `x="${M}" y="104" font-size="12.5" font-weight="${W8.sub ?? 500}" fill="${P.sub}"`);
  let lx = M;
  for (const l of shown(data)) {
    const c = P.C[l.id], w = textWidth(l.name, 12) + 22;
    head += `<rect x="${r1(lx)}" y="128" width="${r1(w)}" height="22" rx="6" fill="${c.solid}"/>` + text(l.name, `x="${r1(lx + w / 2)}" y="143.5" font-size="12" font-weight="${W8.op ?? 700}" fill="#ffffff" text-anchor="middle"`);
    lx += w + 10;
  }
  // 注釈・Combo欄
  let foot = '';
  if (notes.length || hasCombo) {
    foot += `<path d="M${M} ${footTop} H${W - M}" stroke="${mix(P.base, theme.ground?.to || '#ffffff', 0.15)}" stroke-width="1"/>`;
    const body = `font-size="${FOOT_FS}" font-weight="${W8.sub ?? 500}" fill="${P.base}"`;
    const lines = (ls, x, y) => ls.map((t, j) => text(t, `x="${x}" y="${y + j * FOOT_LH}" ${body}`)).join('');
    if (notes.length) {
      foot += text(words.notes, `x="${colX[0]}" y="${footTop + 32}" font-size="14" font-weight="${W8.op ?? 700}" fill="${P.base}"`);
      let y = footTop + 58;
      for (const n of notes) {
        // 番号なしの注釈は、番号の代わりにアスタリスクを付ける（第8.2節）
        foot += (n.n ? noteMark(M, y - 10.5, 13, String(n.n), 9, 9.5) : noteMark(M, y - 10.5, 13, '＊', 10, 10))
          + lines(n.lines, M + MARK_W, y);
        y += n.lines.length * FOOT_LH + FOOT_GAP;
      }
    }
    if (hasCombo) {
      const cx = colX[1];
      foot += text(words.combo, `x="${cx}" y="${footTop + 32}" font-size="14" font-weight="${W8.op ?? 700}" fill="${P.base}"`);
      let y = footTop + 58;
      if (commonLines.length) { foot += lines(commonLines, cx, y); y += commonLines.length * FOOT_LH + FOOT_GAP; }
      for (const it of combos) {
        const col = comboColor(it.c), w = headW(it.head), top = y - 10.5;
        foot += (col.defs || '') + `<rect x="${r1(cx)}" y="${r1(top)}" width="${r1(w)}" height="${HEAD_H}" rx="${r1(HEAD_H * COMBO_R)}" fill="${col.bg}"/>`
          + withIcon(it.head.icon, it.head.text, cx + w / 2, top + HEAD_H / 2, HEAD_FS, `font-size="${HEAD_FS}" font-weight="${W8.label ?? 700}" fill="${col.fg}"`, col.fg)
          + lines(it.lines, r1(cx + w + HEAD_GAP), y);
        y += it.lines.length * FOOT_LH + FOOT_GAP;
      }
    }
  }

  const g = theme.ground || {};
  const ground = g.type === 'linear' ? 'url(#kv-ground)' : g.color || '#ffffff';
  const fontImport = theme.font?.href ? `<style>@import url("${esc(theme.font.href)}");</style>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r1(W)} ${r1(H)}" width="${r1(W)}" height="${r1(H)}" font-family="${esc(theme.font?.family || 'sans-serif')}" role="img" aria-label="${esc(title)}">
${fontImport}<defs>${keyDefs(theme)}</defs><rect width="100%" height="100%" fill="${ground}"/>${head}<g transform="translate(${M},${HEAD}) scale(${KZ})">${out}</g>${foot}</svg>
`;
}

// ---------------------------------------------------------------- 実行
const args = parseArgs(process.argv.slice(2));
if (args.help || !args.data) {
  console.log('使い方: node renderer/render.mjs <中間データ.json> [--theme <名前|パス>] [-o <出力.svg>]');
  process.exit(args.help ? 0 : 1);
}
const data = loadJSON(args.data, '中間データ');
validate(data);
for (const k of data.keys) if (k.base && typeof k.base === 'object') { k.baseIcon = k.base.icon; k.base = k.base.text; }
// 基本入力と同じ出力のセルは、&trans と同じく描かない（第9.1節）
for (const k of data.keys) for (const [id, v] of Object.entries(k.cells || {})) {
  const c = cellOf(v);
  if (k.base && c.text === k.base && (c.icon ?? null) === (k.baseIcon ?? null) && !c.hold) { delete k.cells[id]; console.error(`警告: ${k.id} の ${id} セル「${c.text}」は基本入力と同じ出力なので描きません。中間データから外してください（第9.1節）`); }
}
const svg = render(compressSplit(data), loadTheme(args.theme), loadIcons());
if (args.out) fs.writeFileSync(args.out, svg); else process.stdout.write(svg);
