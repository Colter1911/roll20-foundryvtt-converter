/**
 * scene-parser.js — Pages → Scene конвертация.
 * Стены, двери, токены, тайлы, текст.
 */

import { parseAC } from "./utils.js";

/**
 * Хелпер для парсинга цветов Foundry (принимает hex, иначе fallback).
 * Исключает пустые строки ('') и 'transparent', из-за которых падает валидация.
 */
function parseColor(val, defaultColor = null) {
  if (!val || typeof val !== "string") return defaultColor;
  const t = val.trim();
  if (t === "" || t.toLowerCase() === "transparent") return defaultColor;
  if (t.startsWith("#")) return t;
  return defaultColor; // игнорирует rgb() и другие не-hex форматы
}

/* ═══════════════════════════════════════════════
   Page → Scene base data
═══════════════════════════════════════════════ */

/**
 * Из R20Page создать базовые данные сцены Foundry.
 * @param {import("./r20-document.js").R20Page} r20page
 * @param {string} bgPath — путь к фоновому изображению
 * @returns {{ sceneData: Object, gridMultiplier: number, marginX: number, marginY: number, gridSize: number }}
 */
export function buildSceneBase(r20page, bgPath) {
  const GRID_TYPE = { square: 1, hex: 2, hexr: 4 };

  const gridSize       = Math.max(50, Math.round(70 * r20page.gridSnap));
  const gridMultiplier = gridSize / 70;

  const widthPx  = Math.round(r20page.width  * 70 * gridMultiplier);
  const heightPx = Math.round(r20page.height * 70 * gridMultiplier);

  // Foundry v13 padding: margin = 25% grid
  const padding  = 0.25;
  const marginX  = Math.round(widthPx  * padding);
  const marginY  = Math.round(heightPx * padding);

  const sceneData = {
    name:   r20page.name,
    width:  widthPx,
    height: heightPx,
    padding: padding,
    backgroundColor: parseColor(r20page.bgColor, "#999999"),
    background: { src: bgPath || null },
    grid: {
      type:     r20page.showGrid ? (GRID_TYPE[r20page.gridType] ?? 1) : 0,
      size:     gridSize,
      distance: r20page.scaleNumber,
      units:    r20page.scaleUnits,
    },
    tokenVision: r20page.dynLighting,
    fog: { exploration: r20page.fogExploration, reset: false },
    flags: { "r20-to-fvtt": { originalId: r20page.id } },
  };

  return { sceneData, gridMultiplier, marginX, marginY, gridSize };
}

/* ═══════════════════════════════════════════════
   Wall parser
═══════════════════════════════════════════════ */

/**
 * Парсировать один R20 path в массив стен Foundry.
 * Поддерживает Legacy (SVG) и Jumpgate (points) форматы.
 */
export function parseWallPath(path, gridMultiplier, marginX, marginY, options = {}) {
  const segments = [];

  // Jumpgate: points = [[dx,dy], ...] — относительно path.left/top
  let points = null;
  if (Array.isArray(path.points) && path.points.length >= 2) {
    points = path.points.map(([x, y]) => [
      (path.left ?? path.x ?? 0) + x,
      (path.top  ?? path.y ?? 0) + y,
    ]);
  } else if (Array.isArray(path.path)) {
    // Legacy SVG: [["M",x,y], ["L",x,y], ...]
    points = [];
    for (const [cmd, x, y] of path.path) {
      if (cmd === "M" || cmd === "L") {
        points.push([(path.left ?? 0) + x, (path.top ?? 0) + y]);
      }
    }
  }

  if (!points || points.length < 2) return [];

  const doorType = detectDoorType(path, options);

  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];

    segments.push({
      c: [
        Math.round(x0 * gridMultiplier + marginX),
        Math.round(y0 * gridMultiplier + marginY),
        Math.round(x1 * gridMultiplier + marginX),
        Math.round(y1 * gridMultiplier + marginY),
      ],
      move:  path.barrierType === "oneWay" ? 0 : 20,
      sight: 20,
      sound: 20,
      light: 20,
      door:  doorType.door,
      ds:    doorType.secretDoor ?? 0,
      dir:   path.oneWayReversed ? 2 : 0,
    });
  }

  return segments;
}

function detectDoorType(path, options) {
  if (!options.autoDoors) return { door: 0, secretDoor: 0 };
  if (path.stroke === options.doorColor)       return { door: 1, secretDoor: 0 };
  if (path.stroke === options.secretDoorColor) return { door: 1, secretDoor: 1 };
  return { door: 0, secretDoor: 0 };
}

/* ═══════════════════════════════════════════════
   Door objects (legacy Roll20 doors/windows)
═══════════════════════════════════════════════ */

export function parseDoorObject(door, gridMultiplier, marginX, marginY) {
  const cx = (door.left  ?? 0) * gridMultiplier + marginX;
  const cy = (door.top   ?? 0) * gridMultiplier + marginY;
  const hw = (door.width  ?? 70) * gridMultiplier / 2;
  const hh = (door.height ?? 70) * gridMultiplier / 2;

  return {
    c: [cx - hw, cy, cx + hw, cy],
    door: 1, ds: 0,
    move: 20, sight: 20, sound: 20, light: 20,
  };
}

/* ═══════════════════════════════════════════════
   Tokens
═══════════════════════════════════════════════ */

export function graphicToToken(graphic, gridMultiplier, marginX, marginY, gridSize, idMapper) {
  // Пропускаем графику, которая не является токеном (тайлы без represents)
  const representsId = graphic.represents || "";

  const x = ((graphic.left ?? graphic.x ?? 0) - (graphic.width  ?? 70) / 2);
  const y = ((graphic.top  ?? graphic.y ?? 0) - (graphic.height ?? 70) / 2);

  return {
    actorId: representsId ? idMapper.get(representsId) : null,
    img:     graphic.imgsrc || "icons/svg/mystery-man.svg",
    name:    graphic.name || "",
    x:       Math.round(x * gridMultiplier + marginX),
    y:       Math.round(y * gridMultiplier + marginY),
    width:   Math.max(0.5, Math.round((graphic.width  ?? 70) / gridSize * 2) / 2),
    height:  Math.max(0.5, Math.round((graphic.height ?? 70) / gridSize * 2) / 2),
    rotation: parseFloat(graphic.rotation) || 0,
    hidden:  graphic.layer === "gmlayer",
    locked:  graphic.locked === true || graphic.locked === "true",
    mirrorX: graphic.fliph === true  || graphic.fliph === "true",
    mirrorY: graphic.flipv === true  || graphic.flipv === "true",
    sight: {
      enabled: graphic.has_bright_light_vision === "True"
            || graphic.has_low_light_vision     === "True",
      range: parseInt(graphic.night_vision_distance) || 0,
    },
    light: {
      dim:    parseFloat(graphic.low_light_distance)    || 0,
      bright: parseFloat(graphic.bright_light_distance) || 0,
      color:  parseColor(graphic.lightColor, null),
    },
    bar1: { attribute: resolveBarLink(graphic.bar1_link, "attributes.hp") },
    displayName: graphic.showname         ? 50 : 40,
    displayBars: graphic.showplayers_bar1 ? 50 : 40,
    disposition: 0,  // NEUTRAL (будет переопределено у актора)
  };
}

function resolveBarLink(barLink, fallback) {
  if (!barLink) return fallback;
  // Roll20 bar_link обычно: "hp", "HP" → конвертируем в "attributes.hp"
  if (barLink.toLowerCase() === "hp") return "attributes.hp";
  return fallback;
}

/* ═══════════════════════════════════════════════
   Tiles
═══════════════════════════════════════════════ */

export function graphicToTile(graphic, gridMultiplier, marginX, marginY, resolvedImg) {
  const x = (graphic.left ?? 0) - (graphic.width  ?? 70) / 2;
  const y = (graphic.top  ?? 0) - (graphic.height ?? 70) / 2;

  return {
    img:    resolvedImg,
    x:      Math.round(x * gridMultiplier + marginX),
    y:      Math.round(y * gridMultiplier + marginY),
    width:  (graphic.width  ?? 70) * gridMultiplier,
    height: (graphic.height ?? 70) * gridMultiplier,
    rotation: parseFloat(graphic.rotation) || 0,
    hidden:   graphic.layer === "gmlayer",
    locked:   true,
    alpha:    parseFloat(graphic.baseOpacity) || 1,
    occlusion: { mode: 0 },
    video: { autoplay: true, loop: true, volume: 0 },
  };
}

/* ═══════════════════════════════════════════════
   Text → Drawing
═══════════════════════════════════════════════ */

export function textToDrawing(text, gridMultiplier, marginX, marginY) {
  const content = String(text.text || "").trim();
  if (!content) return null; // Игнорируем пустые тексты, чтобы не было ошибки валидации

  const strokeColor = parseColor(text.stroke, null);

  return {
    shape: { 
      type: "r", 
      width:  Math.round((parseFloat(text.width)  || 100) * gridMultiplier),
      height: Math.round((parseFloat(text.height) || 50)  * gridMultiplier) 
    },
    text: content,
    textColor:   parseColor(text.color, "#000000"), // В Foundry цвет текста — textColor
    x:           Math.round((text.left ?? 0) * gridMultiplier + marginX),
    y:           Math.round((text.top  ?? 0) * gridMultiplier + marginY),
    fontFamily:  text.font_family || "Signika",
    fontSize:    (parseFloat(text.font_size) || 20) * gridMultiplier,
    strokeColor: strokeColor,
    strokeWidth: strokeColor ? 1 : 0, // Указываем толщину обводки, если есть цвет
    fillColor:   null,                // У обычного текста в Roll20 нет фоновой заливки
    rotation:    parseFloat(text.rotation) || 0,
    hidden:      text.layer === "gmlayer",
  };
}
