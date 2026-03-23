# R20 → FoundryVTT Importer — Developer Reference

> **RULES**: Читай этот файл первым делом перед любой работой над кодом.
> Здесь описано текущее состояние модуля, структуры данных и известные ограничения.

---

## Статус функциональности

| Функция | Статус | Заметки |
|---|---|---|
| Сцены (Pages) | ✅ Работает | Тайлы, стены, двери, токены, освещение |
| Папки | ✅ Работает | journalfolder → Actor + JournalEntry folders |
| НПС Акторы | ✅ Работает | Изображения, HP, атрибуты, способности |
| ПК Акторы | ⚠️ Частично | Базовые атрибуты, без library enrichment |
| Журналы (Handouts) | ✅ Работает | Текст, GM Notes, аватар как image-page |
| Картинки в журналах | ⚠️ Ограничено | Внешние Roll20 S3 URL вставляются как есть (CORS блокирует скачивание) |
| Таблицы броска | ✅ Работает | |
| Плейлист Jukebox | ✅ Работает | |
| Макросы | ✅ Работает | |

---

## Структура ZIP (R20Exporter)

```
campaign.json               ← главный файл, все данные
characters/
  NNN - Имя персонажа/
    character.json          ← дублирует данные из campaign.json
    avatar.png|jpg          ← изображение актёра
    token.png|jpg|webm      ← токен актёра
pages/
  NNN - Название сцены/
    graphics/
      *.png|jpg|webm        ← тайлы и токены сцены
      thumbnail.png
journal/
  NNN - Название хандаута/
    handout.json            ← метаданные (НЕ картинка!)
    notes.html              ← HTML контент (может содержать внешние <img>)
jukebox/                    ← аудиофайлы
tables/                     ← медиа таблиц
decks/                      ← медиа колод
```

### campaign.json структура

```
campaign.json
├── version             "1.0.0"
├── release             "legacy" | "jumpgate"
├── campaign_title      string
├── characters[]        → Actors
├── handouts[]          → JournalEntry
├── pages[]             → Scenes
├── jukebox[]           → Playlist
├── tables[]            → RollTable
├── macros[]            → Macro
├── players[]           → Users (только метаданные)
├── journalfolder[]     → Folder (рекурсивное дерево)
└── jukeboxfolder[]     → Folder (рекурсивное дерево)
```

---

## Roll20 → Foundry: ключевые маппинги атрибутов

### HP (NPC)
```js
// Roll20: attrs["hp"].current (часто пусто у NPC!) + attrs["hp"].max
r20char.attrMax("hp")   // hp.max — используй attrMax, не num("hp_max")!
r20char.num("hp")       // hp.current — часто 0 у NPC, по умолчанию = max
```

### Foundry v13 dnd5e 4.x — критичные отличия от старых версий
```
prototypeToken.texture.src     (НЕ prototypeToken.img!)
resources.legact.spent         (НЕ .value!)
resources.legres.spent         (НЕ .value!)
attributes.senses = { darkvision: 60, blindsight: 0, ... }  (НЕ строка в traits.senses)
hp: { value, min, max, formula }  (нет min: 0 в NPC, min не нужен)
```

### AC (NPC)
```js
// Roll20: npc_ac (число) → Foundry: attributes.ac.flat (с calc: "natural")
{ flat: parseAC(r20char.attr("npc_ac")), calc: "natural" }
```

### Senses (NPC)
```js
// Roll20: npc_senses = "darkvision 60 ft., tremorsense 30 ft."
// Foundry: system.attributes.senses = { darkvision: 60, blindsight: 0, tremorsense: 30, truesight: 0, units: "ft", special: "" }
```

### Resources (NPC)
```js
// Foundry v13 формат:
resources: {
  legact: { spent: 0, max: parseInt(r20char.attr("npc_legendary_actions")) || 0 },
  legres: { spent: 0, max: parseInt(r20char.attr("npc_legendary_resistance_uses")) || 0 },
  lair:   { value: false, initiative: 20 },
}
```

---

## Foundry NPC Data Structure (dnd5e 4.x)

```json
{
  "_id": "...",
  "name": "Имя НПС",
  "type": "npc",
  "img": "worlds/.../actors/xxx_avatar.png",
  "system": {
    "abilities": {
      "str": { "value": 18, "proficient": 0, "bonuses": { "check": "", "save": "" } },
      "dex": { "value": 12, "proficient": 0 },
      "con": { "value": 14, "proficient": 0 },
      "int": { "value": 10, "proficient": 0 },
      "wis": { "value": 12, "proficient": 1 },
      "cha": { "value": 8,  "proficient": 0 }
    },
    "attributes": {
      "ac":  { "flat": 17, "calc": "natural" },
      "hp":  { "value": 163, "max": 163, "formula": "18d8+72", "temp": null, "tempmax": null },
      "init": { "ability": "", "bonus": 0 },
      "movement": { "burrow": 0, "climb": 0, "fly": 60, "swim": 0, "walk": 30, "units": "ft", "hover": false },
      "senses": { "darkvision": 60, "blindsight": 0, "tremorsense": 0, "truesight": 0, "units": "ft", "special": "" },
      "spellcasting": "int"
    },
    "details": {
      "biography": { "value": "" },
      "alignment":  "neutral evil",
      "race":       "",
      "type": { "value": "undead", "subtype": "", "swarm": "", "custom": "" },
      "cr":    5,
      "xp":    { "value": 1800 },
      "source": { "book": "", "page": "" }
    },
    "traits": {
      "size":  "lg",
      "di":    { "value": ["poison"], "bypasses": [] },
      "dr":    { "value": ["bludgeoning"], "bypasses": [] },
      "dv":    { "value": [], "bypasses": [] },
      "ci":    { "value": ["charmed", "frightened"] },
      "languages": { "value": ["common", "elvish"], "custom": "" }
    },
    "resources": {
      "legact": { "spent": 0, "max": 3 },
      "legres": { "spent": 0, "max": 0 },
      "lair":   { "value": false, "initiative": 20 }
    },
    "skills": {},
    "spells": {
      "spell1": { "value": 0, "override": null },
      "spell2": { "value": 0, "override": null }
    },
    "currency": { "pp": 0, "gp": 0, "ep": 0, "sp": 0, "cp": 0 }
  },
  "prototypeToken": {
    "name": "Имя НПС",
    "displayName": 20,
    "actorLink": false,
    "disposition": -1,
    "displayBars": 40,
    "bar1": { "attribute": "attributes.hp" },
    "bar2": { "attribute": null },
    "texture": {
      "src": "worlds/.../actors/xxx_token.png",
      "scaleX": 1,
      "scaleY": 1,
      "tint": null,
      "anchorX": 0.5,
      "anchorY": 0.5
    },
    "sight":  { "enabled": false, "range": 0, "angle": 360, "visionMode": "basic", "brightness": 0, "saturation": 0, "contrast": 0 },
    "light":  { "alpha": 0.5, "angle": 360, "bright": 0, "color": null, "coloration": 1, "dim": 0, "luminosity": 0.5 },
    "width":  1,
    "height": 1
  }
}
```

---

## Архитектура модуля

```
scripts/
  importer.js              ← Оркестратор (R20Importer class)
  asset-manager.js         ← AssetManager: upload/fetchExternal/localizeHtmlImages
  core/
    r20-document.js        ← R20Character, R20Page, R20Handout (data wrappers)
    utils.js               ← buildOwnership, parseAC/Speed/CR, sanitizeFilename...
    folder-builder.js      ← buildFolderTree
    journal-parser.js      ← handoutToJournalEntry
    scene-parser.js        ← buildSceneBase, graphicToToken...
    id-mapper.js           ← R20 ID → Foundry ID
    table-parser.js
    playlist-parser.js
    macro-parser.js
  systems/
    base-system.js         ← BaseSystemAdapter interface
    dnd5e/
      ogl5e-parser.js      ← OGL5eAdapter (главный: PC + NPC)
      items.js             ← buildSpellItems, buildNPCActionItems...
      field-maps.js        ← ABILITIES, SKILL_MAP, SPELL_LEVELS
      sheet-detector.js    ← определение типа листа
      index.js
    generic/
      index.js             ← GenericAdapter (fallback)
  ui/
    import-dialog.js
    progress-dialog.js
```

### Поток данных

```
ZIP → campaign.json
  → R20Character.from(raw) → OGL5eAdapter.toActorData() → Actor.create()
  → R20Handout.from(raw)   → handoutToJournalEntry()   → JournalEntry.create()
  → R20Page.from(raw)      → buildSceneBase()           → Scene.create()
```

---

## AssetManager API

```js
// Загрузить файл из ZIP
assets.upload(zip, zipPath, filename, subdir)
// → "worlds/worldId/assets/r20/subdir/filename"

// Скачать внешний URL (CORS fallback: возвращает оригинальный URL)
assets.fetchExternal(url, subdir)

// Заменить все <img src="https://..."> в HTML на локальные пути
assets.localizeHtmlImages(html, subdir)

// Получить закешированный путь
assets.resolve(key)

// Загрузить пачку параллельно
assets.uploadBatch(tasks, concurrency=4)
```

---

## Известные ограничения

1. **Картинки в журналах**: Roll20 CDN (s3.amazonaws.com) блокирует CORS-запросы из браузера.
   `fetchExternal` пытается скачать, при неудаче оставляет оригинальный URL.
   Foundry сам может загружать эти URL если нет CSP блокировки.

2. **ПК Акторы**: импортируются базовые данные, но инвентарь/заклинания не enriched из библиотеки.
   Следующий этап — library-based reconstruction через компендиум Laaru.

3. **activities в items**: Foundry v13 dnd5e 4.x требует `activities` массив для атак/заклинаний.
   Текущий код создаёт items без `activities` — они показываются но без roll integration.

---

## Следующий этап: Library-based Actor Reconstruction

**Идея**: После базового импорта НПС — обогатить их данные из компендиума Foundry.
- Найти matching item по имени в компендиуме (Laaru или другом)
- Заменить сырые items из Roll20 на enriched compendium items
- Перенести только кастомные данные (описания, модификации)

**Статус**: Не начат. Сначала нужно стабилизировать прямой импорт.
