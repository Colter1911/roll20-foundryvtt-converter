# Roll20 → Foundry VTT v13 — Универсальный Import Module
## Спецификация для разработки

---

## 1. Цели и принципы

**Модуль должен:**
- Работать с **любым** Roll20 экспортом (R20Exporter), не только с конкретной кампанией
- Поддерживать оба формата Roll20: **Legacy** и **Jumpgate**
- Поддерживать несколько типов листов персонажей (OGL 5e, Shaped, и другие)
- Иметь **слой абстракции** между парсингом Roll20 и созданием Foundry-документов
- Корректно деградировать: если поле не распознано — импортировать что есть, не падать
- Быть расширяемым: новый тип листа = новый класс-парсер, без правок ядра

**Foundry VTT v13 + dnd5e v4.x**

---

## 2. Что содержит любой R20Exporter экспорт

### `campaign.json` — главный файл

```
campaign.json
├── version             "1.0.0"
├── release             "legacy" | "jumpgate"
├── campaign_title      string
├── R20Exporter_format  "1.0"
├── characters[]        → Actors
├── handouts[]          → JournalEntry
├── pages[]             → Scenes
├── jukebox[]           → Playlist.sounds
├── tables[]            → RollTable
├── macros[]            → Macro
├── decks[]             → (RollTable / Cards)
├── players[]           → User (только метаданные)
├── journalfolder[]     → Folder (рекурсивное дерево)
├── jukeboxfolder[]     → Folder (рекурсивное дерево)
└── turnorder[]         → Combat (опционально)
```

### `characters/NNN - Имя/`
```
character.json   (дублирует данные из campaign.json)
avatar.png/jpg
token.png/jpg/webm
```

### `pages/NNN - Имя/graphics/`
```
*.png/jpg/webm   (тайлы и токены сцены)
thumbnail.png
```

### `journal/`, `jukebox/`, `tables/`, `decks/`
```
Медиафайлы, привязанные к соответствующим сущностям
```

---

## 3. Структура модуля

```
r20-to-fvtt/
├── module.json
├── lib/
│   └── jszip.min.js                 # Чтение ZIP в браузере (cdnjs или bundled)
├── scripts/
│   ├── main.js                      # Инициализация, хуки, регистрация UI
│   ├── importer.js                  # Оркестратор всего процесса
│   ├── asset-manager.js             # Загрузка изображений из ZIP → Foundry Data
│   │
│   ├── ui/
│   │   ├── import-dialog.js         # ApplicationV2: главный диалог
│   │   └── progress-dialog.js       # ApplicationV2: прогресс импорта
│   │
│   ├── core/                        # УНИВЕРСАЛЬНОЕ ЯДРО (не зависит от системы)
│   │   ├── r20-document.js          # Нормализованные R20 структуры данных
│   │   ├── id-mapper.js             # Roll20 ID ↔ Foundry ID маппинг
│   │   ├── folder-builder.js        # Рекурсивное построение дерева папок
│   │   ├── scene-parser.js          # Pages → Scene (стены, токены, тайлы, свет)
│   │   ├── journal-parser.js        # Handouts → JournalEntry
│   │   ├── table-parser.js          # Tables → RollTable
│   │   ├── playlist-parser.js       # Jukebox → Playlist
│   │   └── macro-parser.js          # Macros → Macro
│   │
│   └── systems/                     # АДАПТЕРЫ ПОД КОНКРЕТНЫЕ СИСТЕМЫ
│       ├── base-system.js           # Абстрактный базовый класс (интерфейс)
│       ├── dnd5e/
│       │   ├── index.js             # Точка входа dnd5e адаптера
│       │   ├── sheet-detector.js    # Определяет тип листа по атрибутам
│       │   ├── ogl5e-parser.js      # OGL 5e (legacy + jumpgate)
│       │   ├── shaped-parser.js     # Shaped Sheet 5e
│       │   └── field-maps.js        # Таблицы маппинга полей
│       └── generic/
│           └── index.js             # Fallback: имя+тип+картинка, без системных данных
│
├── templates/
│   ├── import-dialog.hbs
│   └── progress-dialog.hbs
├── styles/
│   └── module.css
└── lang/
    ├── en.json
    └── ru.json
```

---

## 4. Ключевые абстракции

### 4.1 Нормализованные R20 структуры (`core/r20-document.js`)

Прежде чем идти в системный адаптер, все данные Roll20 нормализуются в единые структуры. Это изолирует различия Legacy/Jumpgate и разных экспортов.

```javascript
/**
 * Нормализованный Character из Roll20.
 * Создаётся из campaign.characters[i] вне зависимости от системы.
 */
class R20Character {
  constructor(raw, zipFile) {
    this.id          = raw.id;
    this.name        = raw.name || "Unnamed";
    this.bio         = raw.bio  || "";
    this.gmNotes     = raw.gmnotes || "";
    this.avatarUrl   = raw.avatar  || "";
    this.isArchived  = raw.archived === "True" || raw.archived === true;
    this.sheetName   = raw.charactersheetname || "unknown";
    this.controlledBy = raw.controlledby || [];
    this.inJournals   = raw.inplayerjournals || [];

    // Плоский словарь атрибутов: { name → { current, max } }
    this.attrs = this.#buildAttrMap(raw.attributes || []);

    // Repeating sections: { "repeating_spell-1" → [ { _id, field1, field2 } ] }
    this.repeating = this.#buildRepeatingMap(raw.attributes || []);

    // Токен по умолчанию
    this.defaultToken = raw.defaulttoken || {};

    // ZIP-ссылки на медиафайлы
    this._zipFile = zipFile;
    this._zipIndex = raw._zipIndex; // порядковый номер для путей в ZIP
  }

  attr(name, fallback = "")  { return this.attrs[name]?.current ?? fallback; }
  attrMax(name, fallback = "") { return this.attrs[name]?.max ?? fallback; }
  num(name, fallback = 0)    { return parseFloat(this.attr(name)) || fallback; }
  flag(name)                 { return this.attr(name) === "1" || this.attr(name) === true; }

  #buildAttrMap(attributes) {
    const map = {};
    for (const a of attributes) {
      if (!a.name.startsWith("repeating_")) {
        map[a.name] = { current: a.current ?? "", max: a.max ?? "" };
      }
    }
    return map;
  }

  #buildRepeatingMap(attributes) {
    const sections = {};
    const rowData  = {};

    for (const a of attributes) {
      const m = a.name.match(/^(repeating_[^_]+)_([^_]+)_(.+)$/);
      if (!m) continue;
      const [, section, rowId, field] = m;

      if (!sections[section])  sections[section]  = [];
      if (!rowData[rowId])     rowData[rowId]      = { _id: rowId, _section: section };
      rowData[rowId][field]    = a.current ?? "";

      if (!sections[section].includes(rowId)) sections[section].push(rowId);
    }

    // Превратить в массивы объектов
    const result = {};
    for (const [section, ids] of Object.entries(sections)) {
      result[section] = ids.map(id => rowData[id]);
    }
    return result;
  }
}
```

```javascript
/**
 * Нормализованная Page (сцена) из Roll20.
 */
class R20Page {
  constructor(raw, zipFile, index) {
    this.id             = raw.id;
    this.name           = raw.name || "Untitled";
    this.index          = index;
    this.width          = parseFloat(raw.width)  || 25;
    this.height         = parseFloat(raw.height) || 25;
    this.gridType       = raw.grid_type || "square";   // "square"|"hex"|"hexr"
    this.showGrid       = raw.showgrid !== "False" && raw.showgrid !== false;
    this.gridSnap       = parseFloat(raw.snapping_increment) || 1;
    this.scaleNumber    = parseFloat(raw.scale_number) || 5;
    this.scaleUnits     = raw.scale_units || "ft";
    this.bgColor        = raw.background_color || "#000000";
    this.thumbnail      = raw.thumbnail || "";
    this.isArchived     = raw.archived === "True";
    this.dynLighting    = raw.dynamic_lighting_enabled === "True";
    this.fogExploration = raw.explorer_mode !== "off";

    this.graphics = raw.graphics || [];   // токены + тайлы
    this.paths    = raw.paths    || [];   // стены + чертежи
    this.texts    = raw.texts    || [];   // надписи → Drawings
    this.doors    = raw.doors    || [];   // двери (legacy)
    this.windows  = raw.windows  || [];  // окна (legacy)
    this.zorder   = raw.zorder   || [];

    this._zipFile = zipFile;
    this._zipIndex = index;
  }
}
```

```javascript
/**
 * Нормализованный Handout из Roll20.
 */
class R20Handout {
  constructor(raw) {
    this.id           = raw.id || raw._id;
    this.name         = raw.name || "Untitled";
    this.notes        = raw.notes    || "";
    this.gmNotes      = raw.gmnotes  || "";
    this.avatarUrl    = raw.avatar   || "";
    this.isArchived   = raw.archived === "True";
    this.controlledBy = this.#parseList(raw.controlledby);
    this.inJournals   = this.#parseList(raw.inplayerjournals);
  }
  #parseList(v) {
    if (Array.isArray(v)) return v;
    try { return JSON.parse(v); } catch { return []; }
  }
}
```

---

### 4.2 Системный адаптер (`systems/base-system.js`)

Абстрактный класс — интерфейс, который должны реализовать все системные адаптеры:

```javascript
/**
 * Базовый класс системного адаптера.
 * Каждый адаптер знает КАК превратить R20Character в данные конкретной Foundry-системы.
 */
export class BaseSystemAdapter {
  /**
   * Возвращает true, если этот адаптер умеет обработать данный персонаж.
   * @param {R20Character} r20char
   * @returns {boolean}
   */
  canHandle(r20char) { return false; }

  /**
   * Конвертирует R20Character → объект для Actor.create()
   * @param {R20Character} r20char
   * @param {IdMapper} idMapper
   * @param {AssetManager} assets
   * @returns {Promise<object>} Foundry Actor data
   */
  async toActorData(r20char, idMapper, assets) {
    throw new Error("toActorData() must be implemented");
  }

  /**
   * Приоритет адаптера (выше = проверяется первым)
   */
  get priority() { return 0; }
}
```

---

### 4.3 ID Mapper (`core/id-mapper.js`)

Центральный компонент для детерминированного преобразования Roll20 ID в Foundry ID и хранения карты.

```javascript
export class IdMapper {
  #r20ToFvtt = new Map(); // r20id → fvttId
  #fvttToR20 = new Map(); // fvttId → r20id

  /**
   * Получить или создать Foundry ID для данного Roll20 ID.
   * Детерминированно: один и тот же r20id всегда даёт один и тот же fvttId.
   */
  getOrCreate(r20id) {
    if (this.#r20ToFvtt.has(r20id)) return this.#r20ToFvtt.get(r20id);
    const fvttId = this.#hashToFoundryId(String(r20id));
    this.#r20ToFvtt.set(r20id, fvttId);
    this.#fvttToR20.set(fvttId, r20id);
    return fvttId;
  }

  get(r20id) { return this.#r20ToFvtt.get(r20id) ?? null; }

  // Стабильный 16-символьный хеш → символы алфавита Foundry [a-zA-Z0-9]
  #hashToFoundryId(str) {
    const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
    let id = "";
    let tmp = n;
    for (let i = 0; i < 16; i++) {
      id += CHARS[tmp % CHARS.length];
      tmp = Math.floor(tmp / CHARS.length);
      if (tmp === 0) tmp = n ^ (i * 0x9e3779b9);
    }
    return id;
  }
}
```

---

### 4.4 Asset Manager (`asset-manager.js`)

Управляет загрузкой всех медиафайлов из ZIP в Foundry Data.

```javascript
export class AssetManager {
  #cache = new Map();         // originalUrl|zipPath → foundryPath
  #uploadBasePath = "";

  constructor(worldName) {
    this.#uploadBasePath = `worlds/${worldName}/assets/r20`;
  }

  /**
   * Загрузить файл из ZIP в Foundry Data.
   * @param {JSZip} zip
   * @param {string} zipPath   путь внутри ZIP
   * @param {string} filename  желаемое имя файла
   * @param {string} subdir    подкаталог (actors|scenes|journal|...)
   * @returns {Promise<string>} путь в Foundry Data или "" при ошибке
   */
  async upload(zip, zipPath, filename, subdir = "misc") {
    const cacheKey = zipPath;
    if (this.#cache.has(cacheKey)) return this.#cache.get(cacheKey);

    const zipEntry = zip.file(zipPath);
    if (!zipEntry) {
      console.warn(`R20Import | Asset not found in ZIP: ${zipPath}`);
      return "";
    }

    const blob = await zipEntry.async("blob");
    const safeFilename = this.#sanitizeFilename(filename);
    const file = new File([blob], safeFilename, { type: blob.type || "image/png" });
    const targetDir = `${this.#uploadBasePath}/${subdir}`;

    try {
      const result = await FilePicker.upload("data", targetDir, file, {});
      const path = result.path;
      this.#cache.set(cacheKey, path);
      return path;
    } catch (e) {
      console.error(`R20Import | Failed to upload ${zipPath}:`, e);
      return "";
    }
  }

  /**
   * Вернуть уже загруженный путь или оригинальный URL.
   * Используется когда изображение уже загружено ранее.
   */
  resolve(key) {
    return this.#cache.get(key) ?? key ?? "";
  }

  /**
   * Загрузить пачку ассетов параллельно (с ограничением concurrency).
   */
  async uploadBatch(tasks, concurrency = 4) {
    const results = [];
    for (let i = 0; i < tasks.length; i += concurrency) {
      const batch = tasks.slice(i, i + concurrency);
      results.push(...await Promise.all(batch.map(t => this.upload(t.zip, t.zipPath, t.filename, t.subdir))));
    }
    return results;
  }

  #sanitizeFilename(name) {
    return name.replace(/[^a-zA-Z0-9а-яА-ЯёЁ._\-]/g, "_").slice(0, 120);
  }
}
```

---

## 5. dnd5e Адаптер — детальная спецификация

### 5.1 Определение типа листа (`sheet-detector.js`)

```javascript
export class SheetDetector {
  /**
   * Определяет тип листа по полям персонажа.
   * Возвращает строку-идентификатор: "ogl5e" | "shaped" | "unknown"
   */
  static detect(r20char) {
    const sheet = r20char.sheetName?.toLowerCase() ?? "";

    if (sheet === "ogl5e" || sheet === "5th edition ogl by roll20")
      return "ogl5e";

    if (sheet.includes("shaped") || r20char.attrs["shaped_d20"]?.current !== undefined)
      return "shaped";

    // Fallback: эвристика по наличию ключевых атрибутов
    if (r20char.attrs["strength"]?.current !== undefined)
      return "ogl5e";

    return "unknown";
  }
}
```

### 5.2 OGL 5e Parser (`ogl5e-parser.js`) — полная таблица маппинга

#### Определение PC vs NPC
```javascript
const isNPC = r20char.flag("npc");  // attr "npc" === "1"
```

#### A. Базовая структура Actor
```javascript
{
  _id:    idMapper.getOrCreate(r20char.id),
  name:   r20char.name,
  type:   isNPC ? "npc" : "character",
  img:    await assets.upload(zip, avatarZipPath, "avatar.png", "actors"),
  ownership: buildOwnership(r20char, playerIdMap),
  folder:    folderMap.get(r20char.id) ?? null,
  flags: { "r20-to-fvtt": { originalId: r20char.id } },
}
```

#### B. system.abilities (PC и NPC)

| Roll20 атрибут | Foundry путь | Тип |
|---|---|---|
| `strength` | `system.abilities.str.value` | int |
| `dexterity` | `system.abilities.dex.value` | int |
| `constitution` | `system.abilities.con.value` | int |
| `intelligence` | `system.abilities.int.value` | int |
| `wisdom` | `system.abilities.wis.value` | int |
| `charisma` | `system.abilities.cha.value` | int |
| `strength_save_prof` | `system.abilities.str.proficient` | 0\|1 |
| `dexterity_save_prof` | `system.abilities.dex.proficient` | 0\|1 |
| `constitution_save_prof` | `system.abilities.con.proficient` | 0\|1 |
| `intelligence_save_prof` | `system.abilities.int.proficient` | 0\|1 |
| `wisdom_save_prof` | `system.abilities.wis.proficient` | 0\|1 |
| `charisma_save_prof` | `system.abilities.cha.proficient` | 0\|1 |

```javascript
// Вспомогательная функция для всех 6 способностей:
const ABILITIES = [
  ["str", "strength"],  ["dex", "dexterity"],  ["con", "constitution"],
  ["int", "intelligence"], ["wis", "wisdom"],  ["cha", "charisma"]
];
const abilities = {};
for (const [fvtt, r20] of ABILITIES) {
  abilities[fvtt] = {
    value:      r20char.num(r20, 10),
    proficient: r20char.flag(`${r20}_save_prof`) ? 1 : 0,
  };
}
```

#### C. system.attributes (PC и NPC)

| Roll20 атрибут | Foundry путь | Примечание |
|---|---|---|
| `hp` | `system.attributes.hp.value` | int |
| `hp_max` | `system.attributes.hp.max` | int |
| `hp_temp` | `system.attributes.hp.temp` | int |
| `ac` / `npc_ac` | `system.attributes.ac.flat` | parseAC() |
| — | `system.attributes.ac.calc` | `"flat"` если npc |
| `speed` / `npc_speed` | `system.attributes.movement.walk` | parseSpeed() |
| `pb` | `system.attributes.prof` | int |
| `initiative` | `system.attributes.init.bonus` | int |
| `passive_wisdom` | `system.attributes.init.value` | через wis |
| `spell_save_dc` | `system.attributes.spelldc` | int |

```javascript
// parseAC: "17+" → 17, "13 (натуральная броня)" → 13
function parseAC(v) { return parseInt(String(v).match(/(\d+)/)?.[1]) || 10; }

// parseSpeed: "30 футов", "30 ft.", "30 ft., fly 60 ft." → 30
function parseSpeed(v) { return parseInt(String(v).match(/^(\d+)/)?.[1]) || 30; }
```

#### D. system.details (PC)

| Roll20 | Foundry | Примечание |
|---|---|---|
| `class` | `system.details.class` | string |
| `race` | `system.details.race` | string |
| `background` | `system.details.background` | string |
| `alignment` | `system.details.alignment` | string |
| `xp` | `system.details.xp.value` | int |
| `level` | `system.details.level` | int |
| `age` | `system.details.age` | string |
| `height` | `system.details.height` | string |
| `weight` | `system.details.weight` | string |
| `eyes` | `system.details.eyes` | string |
| `hair` | `system.details.hair` | string |
| bio (raw.bio) | `system.details.biography.value` | HTML |

#### E. system.details (NPC)

| Roll20 | Foundry | Примечание |
|---|---|---|
| `npc_type` | `system.details.type.value` + `.subtype` | parsetype() |
| `npc_challenge` | `system.details.cr` | parseCR() — `"1/4"` → `0.25` |
| `npc_xp` | `system.details.xp.value` | int |
| bio / gmnotes | `system.details.biography.value` | HTML |
| `npc_legendary_actions` | `system.resources.legact.value` | int |
| `npc_legendary_resist` | `system.resources.legres.value` | int |

```javascript
// parseCR: "1/4" → 0.25, "1/2" → 0.5, "11" → 11, "0" → 0
function parseCR(v) {
  if (!v) return 0;
  if (String(v).includes("/")) {
    const [n, d] = String(v).split("/");
    return parseInt(n) / parseInt(d);
  }
  return parseFloat(v) || 0;
}

// parseType: "Средний Гуманоид (эльф), нейтрально-злой" → { value: "humanoid", subtype: "эльф" }
function parseNPCType(v) {
  const TYPE_MAP = {
    humanoid: "humanoid", гуманоид: "humanoid",
    undead: "undead", нежить: "undead",
    beast: "beast", зверь: "beast",
    fiend: "fiend", исчадие: "fiend",
    dragon: "dragon", дракон: "dragon",
    construct: "construct", конструкт: "construct",
    celestial: "celestial", небожитель: "celestial",
    elemental: "elemental", элементаль: "elemental",
    fey: "fey", фея: "fey",
    plant: "plant", растение: "plant",
    ooze: "ooze", слизь: "ooze",
    giant: "giant", великан: "giant",
    monstrosity: "monstrosity", чудовище: "monstrosity",
    aberration: "aberration", аберрация: "aberration",
  };
  const lower = String(v).toLowerCase();
  let foundType = "humanoid";
  for (const [key, val] of Object.entries(TYPE_MAP)) {
    if (lower.includes(key)) { foundType = val; break; }
  }
  const subtypeMatch = v.match(/\(([^)]+)\)/);
  return { value: foundType, subtype: subtypeMatch?.[1] ?? "" };
}
```

#### F. system.skills (только PC)

```javascript
const SKILL_MAP = {
  acrobatics:       "acr",  "animal-handling": "ani",  arcana:       "arc",
  athletics:        "ath",  deception:         "dec",  history:      "his",
  insight:          "ins",  intimidation:      "itm",  investigation: "inv",
  medicine:         "med",  nature:            "nat",  perception:   "per",
  performance:      "prf",  persuasion:        "prs",  religion:     "rel",
  "sleight-of-hand":"slt",  stealth:           "ste",  survival:     "sur",
};
// Roll20 значения: "" | "0.5" | "1" | "2"  →  Foundry: 0 | 0.5 | 1 | 2
const skills = {};
for (const [r20name, fvttCode] of Object.entries(SKILL_MAP)) {
  const raw = r20char.attr(`${r20name}_prof`);
  skills[fvttCode] = { value: raw === "" ? 0 : parseFloat(raw) || 0 };
}
```

#### G. system.currency (только PC)

```javascript
currency: {
  pp: r20char.num("pp"), gp: r20char.num("gp"),
  ep: r20char.num("ep"), sp: r20char.num("sp"), cp: r20char.num("cp")
}
```

#### H. system.spells (только PC — слоты)

```javascript
const SPELL_LEVELS = [0,1,2,3,4,5,6,7,8,9];
const spells = {};
for (const level of SPELL_LEVELS) {
  const key = level === 0 ? "spell0" : `spell${level}`;
  const r20key = level === 0 ? "cantrip" : String(level);
  spells[key] = {
    value: r20char.num(`lvl${r20key}_slots_expended`, 0),
    max:   r20char.num(`lvl${r20key}_slots_total`,    0),
    // Альтернативные имена в разных версиях OGL:
    // "spell_slots_level_1" (старый) vs "lvl1_slots_total" (новый)
  };
}
```

Примечание: слоты заклинаний имеют нестабильные имена атрибутов между версиями OGL.
Дополнительные кандидаты: `spell_level_1`, `spellslot1_remaining`, `lvl1_slots_total`.
Парсер должен пробовать несколько вариантов.

#### I. prototypeToken

```javascript
const dt = r20char.defaultToken;
const VISION_SENSES = {
  darkvision:    parseInt(dt.night_vision_distance)   || 0,
  brightSight:   parseInt(dt.bright_light_distance)   || 0,
};

prototypeToken: {
  name:        dt.name || r20char.name,
  img:         await assets.upload(zip, tokenZipPath, "token.png", "actors"),
  width:       Math.max(0.1, parseInt(dt.width)  / 70),
  height:      Math.max(0.1, parseInt(dt.height) / 70),
  displayName: dt.showplayers_name ? 50 : 40,  // ALWAYS | OWNER
  displayBars: 40,
  bar1: { attribute: "attributes.hp" },
  mirrorX:     dt.fliph  === "True",
  mirrorY:     dt.flipv  === "True",
  sight: {
    enabled: dt.has_bright_light_vision === "True"
          || dt.has_low_light_vision     === "True"
          || dt.has_night_vision         === "True",
    range:   VISION_SENSES.darkvision,
  },
  light: {
    dim:    parseFloat(dt.low_light_distance)    || 0,
    bright: parseFloat(dt.bright_light_distance) || 0,
    color:  dt.lightColor !== "transparent" ? dt.lightColor : null,
    angle:  360,
  },
  actorLink: !isNPC,   // PC — linked, NPC — unlinked
  disposition: isNPC ? -1 : 1,  // HOSTILE | FRIENDLY
}
```

---

### 5.3 Items Parser (`items.js`) — repeating sections → Items

#### Repeating section → Item rows
```javascript
/**
 * Извлечь все строки repeating секции в виде плоских объектов.
 * r20char.repeating["repeating_spell-1"] → [{_id, spellname, spelldescription, ...}]
 */
function getRows(r20char, section) {
  return r20char.repeating[section] ?? [];
}
```

#### Заклинания (repeating_spell-N, repeating_spell-cantrip)

```javascript
const SPELL_SECTIONS = [
  "repeating_spell-cantrip", "repeating_spell-1", "repeating_spell-2",
  "repeating_spell-3", "repeating_spell-4", "repeating_spell-5",
  "repeating_spell-6", "repeating_spell-7", "repeating_spell-8", "repeating_spell-9"
];

function spellRowToItem(row, idMapper) {
  return {
    _id:  idMapper.getOrCreate(row._id),
    name: row.spellname || "Unknown Spell",
    type: "spell",
    system: {
      level:       parseInt(row.spelllevel) || 0,
      school:      row.spellschool || "evocation",
      description: { value: row.spelldescription || "" },
      activation: {
        type: mapActivationType(row.spellcastingtime),
        cost: 1,
      },
      duration: parseDuration(row.spellduration),
      range:    parseRange(row.spellrange),
      components: {
        vocal:    row.spellcomp_v     !== "" && row.spellcomp_v !== "0",
        somatic:  row.spellcomp_s     !== "" && row.spellcomp_s !== "0",
        material: row.spellcomp_m !== 0 && row.spellcomp_m !== "0",
        materials: { value: row.spellcomp_materials || "" },
      },
      preparation: {
        mode:    "prepared",
        prepared: row.spellprepared === "1",
      },
      damage: {
        parts: buildDamageParts(row),
      },
      healing: row.spellhealing
        ? { formula: row.spellhealing }
        : undefined,
      target:  parseTarget(row.spelltarget),
      save: row.spellsave
        ? { ability: row.spellsave.toLowerCase().slice(0,3), dc: parseInt(row.roll_output_dc) || null }
        : {},
    }
  };
}
```

```javascript
// Таблица преобразования типов активации
const ACTIVATION_MAP = {
  "1 action":       "action",
  "1 bonus action": "bonus",
  "1 reaction":     "reaction",
  "1 minute":       "minute",
  "10 minutes":     "minute",
  "1 hour":         "hour",
  "8 hours":        "hour",
  "special":        "special",
};
function mapActivationType(raw) {
  return ACTIVATION_MAP[String(raw).toLowerCase()] ?? "action";
}
```

#### Атаки (repeating_attack) — деduplication с заклинаниями

```javascript
// Если у строки attack есть spellid — это атака от заклинания, пропустить
// (заклинание уже создано из repeating_spell-N)
// Если нет — создать Weapon item

function attackRowToItem(row, idMapper) {
  if (row.spellid) return null; // дублирует заклинание

  return {
    _id:  idMapper.getOrCreate(row._id),
    name: row.atkname || "Unknown Attack",
    type: "weapon",
    system: {
      damage: {
        base: {
          formula: row.dmgbase || "1",
          types:   [row.dmgtype?.toLowerCase() || ""],
        },
      },
      range:   parseRange(row.atkrange),
      equipped: true,
      identified: true,
      // Bonus attack (bab/prof-based) сохранить в description если не можем смапить
      description: { value: row.atk_desc || "" },
    }
  };
}
```

#### NPC действия (repeating_npcaction, bonusaction, reaction, trait)

```javascript
const NPC_ACTION_TYPES = {
  "repeating_npcaction":       { activation: "action" },
  "repeating_npcbonusaction":  { activation: "bonus"  },
  "repeating_npcreaction":     { activation: "reaction" },
  "repeating_npctrait":        { activation: "special" },
  "repeating_npcaction-l":     { activation: "legendary" }, // Legendary actions
};

function npcActionToItem(row, sectionKey, idMapper) {
  const config = NPC_ACTION_TYPES[sectionKey] ?? { activation: "action" };
  return {
    _id:  idMapper.getOrCreate(row._id),
    name: row.name || "Action",
    type: "feat",
    system: {
      description: { value: row.description || "" },
      activation:  { type: config.activation, cost: 1 },
    }
  };
}
```

#### Инвентарь (repeating_inventory)

```javascript
function inventoryRowToItem(row, idMapper) {
  // Определить тип: equipment если есть ac, backpack если сумка, иначе loot
  const itemType = row.itemarmor ? "equipment" : "loot";
  return {
    _id:  idMapper.getOrCreate(row._id),
    name: row.itemname || "Item",
    type: itemType,
    system: {
      quantity:    parseInt(row.itemcount)  || 1,
      weight:      { value: parseFloat(row.itemweight) || 0, units: "lb" },
      price:       { value: parseFloat(row.itemcost)   || 0, denomination: "gp" },
      description: { value: row.itemcontent || "" },
      equipped:    row.equipped === "1",
      identified:  true,
    }
  };
}
```

#### Черты / Расовые способности (repeating_traits)

```javascript
function traitRowToItem(row, idMapper) {
  return {
    _id:  idMapper.getOrCreate(row._id),
    name: row.name || "Trait",
    type: "feat",
    system: {
      description: { value: row.description || "" },
      activation:  { type: "passive", cost: null },
    }
  };
}
```

---

## 6. Scene Parser (`core/scene-parser.js`)

### 6.1 Page → Scene base data

```javascript
function pageToSceneBase(r20page, assetPath) {
  const GRID_TYPE = { square: 1, hex: 2, hexr: 4 };

  const gridSize = Math.max(50, Math.round(70 * r20page.gridSnap));
  const gridMultiplier = gridSize / 70;

  const widthPx  = Math.round(r20page.width  * 70 * gridMultiplier);
  const heightPx = Math.round(r20page.height * 70 * gridMultiplier);

  return {
    name:       r20page.name,
    width:      widthPx,
    height:     heightPx,
    padding:    0.25,
    backgroundColor: r20page.bgColor,
    background: { src: assetPath || null },
    grid: {
      type:     r20page.showGrid ? (GRID_TYPE[r20page.gridType] ?? 1) : 0,
      size:     gridSize,
      distance: r20page.scaleNumber,
      units:    r20page.scaleUnits,
    },
    tokenVision:    r20page.dynLighting,
    fog: { exploration: r20page.fogExploration, reset: false },
    _gridMultiplier: gridMultiplier,   // служебное поле, удалить перед create()
  };
}
```

### 6.2 Wall parser (пути на layer "walls")

Ключевое: Jumpgate использует `path.points = [[x,y], [x,y], ...]` (ломаная линия),
Legacy — `path.path = [["M",x,y], ["L",x,y], ...]` (SVG команды).
**Оба формата могут присутствовать одновременно** (как в тестовом экспорте).

```javascript
function parseWallPath(path, gridMultiplier, marginX, marginY, options) {
  const segments = [];

  // Определяем источник координат
  let points = null;
  if (path.points && path.points.length >= 2) {
    // Jumpgate: [[dx,dy], [dx,dy], ...] — relative offsets от path.left/top
    points = path.points.map(([x, y]) => [
      (path.left ?? path.x ?? 0) + x,
      (path.top  ?? path.y ?? 0) + y,
    ]);
  } else if (path.path) {
    // Legacy SVG commands: [["M",x,y], ["L",x,y], ...]
    points = [];
    for (const [cmd, x, y] of path.path) {
      if (cmd === "M" || cmd === "L") {
        points.push([(path.left ?? 0) + x, (path.top ?? 0) + y]);
      }
    }
  }
  if (!points || points.length < 2) return [];

  // Определяем тип стены
  const doorType = detectDoorType(path, options);

  // Каждая пара соседних точек = один сегмент Wall
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];

    const wall = {
      c: [
        Math.round((x0) * gridMultiplier + marginX),
        Math.round((y0) * gridMultiplier + marginY),
        Math.round((x1) * gridMultiplier + marginX),
        Math.round((y1) * gridMultiplier + marginY),
      ],
      // Тип барьера
      move:  path.barrierType === "oneWay" ? 0 : 20,
      sight: 20,
      sound: 20,
      light: 20,
      door:  doorType.door,
      ds:    doorType.secretDoor,
      dir:   path.oneWayReversed ? 2 : 0,
    };
    segments.push(wall);
  }
  return segments;
}

function detectDoorType(path, options) {
  // Явные двери из Roll20 (doors/windows layer) обрабатываются отдельно
  // Здесь — определение по цвету стены (auto-doors feature)
  if (!options.autoDoors) return { door: 0, secretDoor: 0 };
  if (path.stroke === options.doorColor)       return { door: 1, secretDoor: 0 };
  if (path.stroke === options.secretDoorColor) return { door: 1, secretDoor: 1 };
  return { door: 0, secretDoor: 0 };
}
```

### 6.3 Doors (Roll20 door/window objects)

```javascript
function parseDoorObject(door, gridMultiplier, marginX, marginY) {
  // Roll20 двери — отдельные объекты с left/top/width/height
  const cx = (door.left  ?? 0) * gridMultiplier + marginX;
  const cy = (door.top   ?? 0) * gridMultiplier + marginY;
  const hw = (door.width  ?? 70) * gridMultiplier / 2;
  const hh = (door.height ?? 70) * gridMultiplier / 2;

  return {
    c: [cx - hw, cy, cx + hw, cy],
    door: 1,
    ds: 0,
    move: 20, sight: 20, sound: 20, light: 20,
  };
}
```

### 6.4 Tokens на сцене

```javascript
function graphicToToken(graphic, gridMultiplier, marginX, marginY, gridSize, idMapper) {
  const representsId = graphic.represents || "";
  if (!representsId && !graphic.emits_bright_light && !graphic.name) return null;

  const x = ((graphic.left ?? graphic.x ?? 0) - (graphic.width  ?? 70) / 2);
  const y = ((graphic.top  ?? graphic.y ?? 0) - (graphic.height ?? 70) / 2);

  return {
    actorId: representsId ? idMapper.get(representsId) : null,
    img:     graphic.imgsrc || "icons/svg/mystery-man.svg",
    x:       Math.round(x * gridMultiplier + marginX),
    y:       Math.round(y * gridMultiplier + marginY),
    width:   Math.max(0.1, (graphic.width  ?? 70) / gridSize),
    height:  Math.max(0.1, (graphic.height ?? 70) / gridSize),
    rotation: parseFloat(graphic.rotation) || 0,
    hidden:  graphic.layer === "gmlayer",
    locked:  graphic.locked === true || graphic.locked === "true",
    mirrorX: graphic.fliph === true || graphic.fliph === "true",
    mirrorY: graphic.flipv === true || graphic.flipv === "true",
    // Видимость/свет токена (Jumpgate-поля)
    sight: {
      enabled: graphic.has_bright_light_vision === "True"
            || graphic.has_low_light_vision     === "True",
      range:   parseInt(graphic.night_vision_distance) || 0,
    },
    light: {
      dim:    parseFloat(graphic.low_light_distance)    || 0,
      bright: parseFloat(graphic.bright_light_distance) || 0,
      color:  graphic.lightColor !== "transparent" ? graphic.lightColor : null,
    },
    // Bar links
    bar1: { attribute: resolveBarLink(graphic.bar1_link, "attributes.hp") },
    // Отображение имени и баров
    displayName: graphic.showname     ? 50 : 40,
    displayBars: graphic.showplayers_bar1 ? 50 : 40,
    disposition: 0,  // NEUTRAL (можно улучшить через тип актора)
  };
}
```

### 6.5 Tiles (графика не-токены)

```javascript
function graphicToTile(graphic, gridMultiplier, marginX, marginY, gridSize, resolvedImg) {
  const x = (graphic.left ?? 0) - (graphic.width  ?? 70) / 2;
  const y = (graphic.top  ?? 0) - (graphic.height ?? 70) / 2;
  return {
    img:    resolvedImg,
    x:      Math.round(x * gridMultiplier + marginX),
    y:      Math.round(y * gridMultiplier + marginY),
    width:  (graphic.width  ?? 70) * gridMultiplier,
    height: (graphic.height ?? 70) * gridMultiplier,
    rotation:  parseFloat(graphic.rotation) || 0,
    hidden:    graphic.layer === "gmlayer",
    locked:    true,
    alpha:     parseFloat(graphic.baseOpacity) || 1,
    occlusion: { mode: 0 },
    // Анимация (webm)
    video: { autoplay: true, loop: true, volume: 0 },
  };
}
```

### 6.6 Text → Drawing (надписи на сцене)

```javascript
function textToDrawing(text, gridMultiplier, marginX, marginY) {
  return {
    type: "t",   // text drawing
    text: text.text,
    x:    Math.round((text.left ?? 0) * gridMultiplier + marginX),
    y:    Math.round((text.top  ?? 0) * gridMultiplier + marginY),
    fontFamily: text.font_family || "Signika",
    fontSize:   parseFloat(text.font_size) * gridMultiplier || 48,
    strokeColor: text.stroke  || "#000000",
    fillColor:   text.color   || "#ffffff",
    rotation:    parseFloat(text.rotation) || 0,
    hidden:      text.layer === "gmlayer",
  };
}
```

---

## 7. Journal Parser (`core/journal-parser.js`)

### 7.1 journalfolder → Folder дерево

Roll20 `journalfolder` — рекурсивный массив вида:
```
[ "handout-id", { "n": "Папка", "id": "...", "i": [...] }, ... ]
```

```javascript
/**
 * Рекурсивно создать Folder документы и вернуть карту r20id → folderId.
 */
async function buildFolderTree(folderData, parentId, type, idMapper) {
  const folderMap = new Map(); // r20_handout_id → foundry_folder_id

  async function processLevel(items, currentParentId) {
    for (const item of items) {
      if (typeof item === "string") {
        // Это ID handout/character — привязать к текущей папке
        folderMap.set(item, currentParentId);
        continue;
      }
      if (typeof item === "object" && item.n) {
        // Это папка
        const folderId = idMapper.getOrCreate("folder_" + item.id);
        await Folder.create({
          _id:    folderId,
          name:   item.n,
          type:   type,         // "JournalEntry" | "Actor" | "Playlist"
          folder: currentParentId,
          sorting: "m",
        });
        // Рекурсия
        await processLevel(item.i ?? [], folderId);
      }
    }
  }

  await processLevel(folderData, parentId);
  return folderMap;
}
```

### 7.2 Handout → JournalEntry

```javascript
function handoutToJournalEntry(r20handout, folderMap, idMapper, playerIdMap) {
  const pages = [];

  // Основной контент
  if (r20handout.notes) {
    pages.push({
      _id:  foundry.utils.randomID(),
      name: "Заметки",
      type: "text",
      text: { content: r20handout.notes, format: 1 },
      ownership: { default: 2 },  // OBSERVER — видят все кто имеет доступ к handout
    });
  }

  // GM Notes — отдельная страница только для GM
  if (r20handout.gmNotes?.trim()) {
    pages.push({
      _id:  foundry.utils.randomID(),
      name: "GM Notes",
      type: "text",
      text: { content: r20handout.gmNotes, format: 1 },
      ownership: { default: 0 },  // NONE — только GM видит
    });
  }

  return {
    _id:      idMapper.getOrCreate(r20handout.id),
    name:     r20handout.name,
    img:      r20handout.avatarUrl || null,
    folder:   folderMap.get(r20handout.id) ?? null,
    pages:    pages,
    ownership: buildOwnership(r20handout, playerIdMap),
    flags: { "r20-to-fvtt": { originalId: r20handout.id } },
  };
}
```

---

## 8. Вспомогательные функции (`core/utils.js`)

```javascript
/**
 * Построить объект ownership из Roll20 полей controlledby/inplayerjournals.
 * playerIdMap: { r20playerId → foundryUserId }
 */
function buildOwnership(r20entity, playerIdMap) {
  const ownership = { default: 0 }; // NONE

  // inplayerjournals → OBSERVER (видит)
  const viewers = parseR20IdList(r20entity.inJournals ?? r20entity.inplayerjournals);
  for (const pid of viewers) {
    if (pid === "all") { ownership.default = 2; break; }
    const fid = playerIdMap[pid];
    if (fid) ownership[fid] = Math.max(ownership[fid] ?? 0, 2);
  }

  // controlledby → OWNER (редактирует)
  const owners = parseR20IdList(r20entity.controlledBy ?? r20entity.controlledby);
  for (const pid of owners) {
    if (pid === "all") { ownership.default = 3; break; }
    const fid = playerIdMap[pid];
    if (fid) ownership[fid] = 3;
  }

  return ownership;
}

function parseR20IdList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean);
  try { return JSON.parse(v).filter(Boolean); } catch { return []; }
}

/** Нормализовать r20 id: убрать дефис в начале, заменить спецсимволы */
function normalizeR20Id(id) {
  return String(id ?? "").replace(/^-/, "").replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Парсить формулу дистанции в числовое значение */
function parseRange(raw) {
  if (!raw) return { value: null, units: "ft" };
  const lower = String(raw).toLowerCase().trim();
  if (lower === "self") return { value: 0, units: "self" };
  if (lower === "touch") return { value: null, units: "touch" };
  if (lower === "sight" || lower === "unlimited") return { value: null, units: "spec" };
  const m = lower.match(/^(\d+)\s*(ft|feet|foot|m|meter|км|фут|метр)?/i);
  return {
    value: m ? parseInt(m[1]) : null,
    units: (m?.[2] ?? "ft").toLowerCase().startsWith("m") ? "m" : "ft",
  };
}

/** Парсить длительность заклинания */
function parseDuration(raw) {
  if (!raw) return { value: "", units: "inst" };
  const lower = String(raw).toLowerCase();
  if (lower.includes("instantaneous") || lower.includes("мгновенно"))
    return { value: "", units: "inst" };
  if (lower.includes("concentration") || lower.includes("концентраци")) {
    const m = lower.match(/(\d+)\s*(minute|hour|round)/);
    return { value: m?.[1] ?? "1", units: m?.[2]?.startsWith("h") ? "hour" : "minute", concentration: true };
  }
  if (lower.includes("permanent") || lower.includes("until dispelled"))
    return { value: "", units: "perm" };
  const m = lower.match(/(\d+)\s*(round|minute|hour|day|month|year)/i);
  if (m) return { value: m[1], units: m[2].toLowerCase().slice(0,4) };
  return { value: raw, units: "spec" };
}

/** Собрать части урона из Row заклинания/атаки */
function buildDamageParts(row) {
  const parts = [];
  if (row.spelldamage)  parts.push({ formula: row.spelldamage,  types: [row.spelldamagetype  || ""] });
  if (row.spelldamage2) parts.push({ formula: row.spelldamage2, types: [row.spelldamagetype2 || ""] });
  if (row.dmgbase)      parts.push({ formula: row.dmgbase,      types: [row.dmgtype?.toLowerCase() || ""] });
  return parts;
}
```

---

## 9. Оркестратор (`importer.js`)

```javascript
export class R20Importer {
  constructor(options) {
    this.options  = options;
    this.idMapper = new IdMapper();
    this.assets   = new AssetManager(game.world.id);
    this.errors   = [];
    this.warnings = [];
  }

  async run(zipFile, onProgress) {
    const zip      = await JSZip.loadAsync(zipFile);
    const campaign = JSON.parse(await zip.file("campaign.json").async("string"));

    const steps = this.#buildStepList(campaign);
    onProgress?.({ total: steps.length, current: 0, label: "Подготовка..." });

    // --- Шаг 0: Построить карту игроков ---
    const playerIdMap = this.#buildPlayerMap(campaign.players);

    // --- Шаг 1: Создать структуру папок ---
    onProgress?.({ current: 1, label: "Папки..." });
    const actorFolderMap  = await buildFolderTree(campaign.journalfolder, null, "Actor",        this.idMapper);
    const journalFolderMap= await buildFolderTree(campaign.journalfolder, null, "JournalEntry", this.idMapper);

    // --- Шаг 2: Персонажи ---
    if (this.options.importActors) {
      onProgress?.({ current: 2, label: `Персонажи (${campaign.characters.length})...` });
      await this.#importActors(campaign, zip, actorFolderMap, playerIdMap);
    }

    // --- Шаг 3: Журнал ---
    if (this.options.importJournal) {
      onProgress?.({ current: 3, label: `Журнал (${campaign.handouts.length})...` });
      await this.#importJournal(campaign, zip, journalFolderMap, playerIdMap);
    }

    // --- Шаг 4: Сцены ---
    if (this.options.importScenes) {
      onProgress?.({ current: 4, label: `Сцены (${campaign.pages.length})...` });
      await this.#importScenes(campaign, zip);
    }

    // --- Шаг 5: Таблицы ---
    if (this.options.importTables) {
      onProgress?.({ current: 5, label: `Таблицы (${campaign.tables.length})...` });
      await this.#importTables(campaign);
    }

    // --- Шаг 6: Плейлисты ---
    if (this.options.importPlaylists) {
      onProgress?.({ current: 6, label: `Музыка (${campaign.jukebox.length})...` });
      await this.#importPlaylists(campaign);
    }

    // --- Шаг 7: Макросы ---
    if (this.options.importMacros) {
      onProgress?.({ current: 7, label: `Макросы (${campaign.macros.length})...` });
      await this.#importMacros(campaign);
    }

    onProgress?.({ current: steps.length, label: "Готово!" });

    // Отчёт
    if (this.errors.length)   console.error("R20 Import errors:",   this.errors);
    if (this.warnings.length) console.warn("R20 Import warnings:", this.warnings);
    return { errors: this.errors, warnings: this.warnings };
  }

  /**
   * Создать документы батчами по N штук, с обработкой ошибок на каждом.
   */
  async #createBatch(DocumentClass, dataArray, batchSize = 20) {
    for (let i = 0; i < dataArray.length; i += batchSize) {
      const batch = dataArray.slice(i, i + batchSize);
      try {
        await DocumentClass.createDocuments(batch, { keepId: true });
      } catch (e) {
        this.errors.push(`${DocumentClass.documentName} batch ${i}: ${e.message}`);
        // Попробовать по одному чтобы найти проблемный элемент
        for (const item of batch) {
          try {
            await DocumentClass.createDocuments([item], { keepId: true });
          } catch (e2) {
            this.errors.push(`  → Failed: "${item.name}": ${e2.message}`);
          }
        }
      }
    }
  }

  #buildPlayerMap(players) {
    // r20 player id → foundry user id (по совпадению имени или заглушка)
    const map = {};
    for (const p of players) {
      const foundryUser = game.users.find(u =>
        u.name.toLowerCase() === (p.displayname || "").toLowerCase()
      );
      if (foundryUser) map[p.id] = foundryUser.id;
    }
    return map;
  }
}
```

---

## 10. UI (`ui/import-dialog.js`)

```javascript
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class R20ImportDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "r20-import-dialog",
    window: { title: "Roll20 → Foundry Import", resizable: false },
    position: { width: 520 },
    actions: {
      startImport: R20ImportDialog.#startImport,
    },
  };

  static PARTS = {
    form: { template: "modules/r20-to-fvtt/templates/import-dialog.hbs" },
  };

  async _prepareContext() {
    // Предзаполнить из прошлого запуска (game.settings)
    return {
      lastOptions: game.settings.get("r20-to-fvtt", "lastOptions") ?? {},
    };
  }

  static async #startImport(event, target) {
    const form = this.element.querySelector("form");
    const fd   = new FormDataExtended(form);
    const opts = fd.object;
    const file = form.querySelector('input[name="zipFile"]').files[0];
    if (!file) return ui.notifications.warn("Выберите ZIP файл экспорта.");

    await game.settings.set("r20-to-fvtt", "lastOptions", opts);
    this.close();

    const progress = new R20ProgressDialog();
    await progress.render(true);

    const importer = new R20Importer(opts);
    const result   = await importer.run(file, (p) => progress.update(p));

    progress.close();

    if (result.errors.length > 0) {
      ui.notifications.error(
        `Импорт завершён с ${result.errors.length} ошибками. См. консоль (F12).`
      );
    } else {
      ui.notifications.info("✅ Импорт из Roll20 завершён успешно!");
    }
  }
}
```

---

## 11. Регистрация настроек и кнопки (`main.js`)

```javascript
Hooks.once("init", () => {
  game.settings.register("r20-to-fvtt", "lastOptions", {
    name: "Last import options",
    scope: "client",
    config: false,
    type: Object,
    default: {},
  });
});

Hooks.on("renderSidebarTab", (app, html) => {
  if (app.id !== "settings") return;

  const btn = document.createElement("button");
  btn.innerHTML = `<i class="fa-solid fa-file-import"></i> Roll20 Import`;
  btn.classList.add("r20-import-btn");
  btn.addEventListener("click", () => new R20ImportDialog().render(true));

  // Вставить в секцию Game Settings
  const gameSection = html.querySelector("#settings-game");
  if (gameSection) gameSection.prepend(btn);
});
```

---

## 12. Что не конвертируется (explicit out of scope)

| Элемент | Причина | Рекомендация |
|---|---|---|
| Макросы (рабочие) | Синтаксис `@{attr}` несовместим с Foundry | Импортируются как `type:"chat"` для ручной доработки |
| Активные эффекты (AE) | В R20 нет прямого аналога | Создать вручную после импорта |
| Fog of war (revealed areas) | Формат несовместим | Foundry пересоздаст при первом посещении |
| Chat log | Нет ценности | — |
| PDF handouts | Не включены в экспорт | — |
| Карты колод (механика игры) | Foundry Cards API принципиально другой | Импортируются как RollTable |
| Формулы Roll20 (`[[1d6+@{str_mod}]]`) | Синтаксис другой | Конвертируются в plain text |
| Compendium links | Зависят от конфигурации Foundry | Ссылки сохраняются как текст |

---

## 13. Порядок реализации

| # | Задача | Оценка | Критерий готовности |
|---|---|---|---|
| 1 | Scaffold: `module.json` + `main.js` + кнопка в UI | 1 ч | Модуль загружается, кнопка отображается |
| 2 | `import-dialog.js` + JSZip + чтение `campaign.json` | 2 ч | Диалог открывается, ZIP читается, campaign.json парсится |
| 3 | `r20-document.js` + `id-mapper.js` — нормализация | 2 ч | R20Character строится, все атрибуты доступны через `.attr()` |
| 4 | `systems/dnd5e/ogl5e-parser.js` — только NPC (без Items) | 3 ч | NPC актор в Foundry с верными abilities/HP/AC |
| 5 | `items.js` — NPC actions, traits, spells | 3 ч | NPC имеет actions/spells как Items |
| 6 | `ogl5e-parser.js` — PC + skills + currency + spell slots | 4 ч | PC со всеми способностями, навыками и кошельком |
| 7 | `items.js` — PC spells + attacks + inventory | 4 ч | PC имеет все заклинания, атаки, инвентарь |
| 8 | `asset-manager.js` — загрузка изображений из ZIP | 2 ч | Аватары и токены видны в Foundry |
| 9 | `scene-parser.js` — базовая сцена + фон + стены | 3 ч | Сцена с фоном и стенами создаётся |
| 10 | `scene-parser.js` — токены + тайлы + свет + текст | 3 ч | Токены и тайлы на сцене, привязаны к акторам |
| 11 | `journal-parser.js` + `folder-builder.js` | 2 ч | Handouts созданы в правильных папках |
| 12 | `table-parser.js` + `playlist-parser.js` | 1 ч | Таблицы и плейлисты созданы |
| 13 | `progress-dialog.js` + обработка ошибок + батчи | 2 ч | Прогресс-бар, ошибки не роняют весь импорт |
| 14 | `systems/generic/index.js` — fallback для других систем | 1 ч | Для не-dnd5e создаётся актор с именем/картинкой |
| 15 | Тестирование на "Из Бездны" (181 char, 80 scenes) | 3 ч | Все сущности созданы, визуальный check |

**Итого: ~36 ч разработки**

---

## 14. Тестирование в Foundry (консольные команды)

```javascript
// Полная очистка для повторного теста
await Actor.deleteDocuments(game.actors.map(a => a.id));
await Scene.deleteDocuments(game.scenes.map(s => s.id));
await JournalEntry.deleteDocuments(game.journal.map(j => j.id));
await RollTable.deleteDocuments(game.tables.map(t => t.id));
await Playlist.deleteDocuments(game.playlists.map(p => p.id));
await Folder.deleteDocuments(game.folders.map(f => f.id));

// Проверить конкретного актора
game.actors.getName("Люция Альвеариум").system.abilities

// Проверить items персонажа
game.actors.getName("Люция Альвеариум").items.map(i => `${i.type}: ${i.name}`)
```
