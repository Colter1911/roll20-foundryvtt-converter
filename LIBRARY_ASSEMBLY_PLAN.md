# Library Assembly System — План реализации

> Цель: обогащать НПС актёров из компендиума Foundry.
> Все **системные данные** (stats, saves, HP, AC, движение, иммунитеты) — из **Roll20**.
> **Items** (действия, атаки, заклинания, черты) — из **компендиума** (с fallback на R20 данные).

---

## 1. Принципы

| Источник | Что берём |
|---|---|
| **Roll20** | Ability scores, HP, AC, saves, skills, movement, senses, resistances/immunities, languages, ownership, images, folder |
| **Компендиум** | Items (actions, legendary actions, spells, features) — описания, activities, формулы |
| **Строим с нуля** | Items которых нет в компендиуме — из R20 данных + правильная dnd5e 4.x структура |

---

## 2. Два пути сборки items

### Путь A: Найден актёр в Actor-паке (основной путь)

```
НПС "Взрослый Красный Дракон" найден в Laaru
    → берём ВСЕ items из Laaru-актёра (actions, legendary, spells, traits)
    → для каждого item: ищем совпадение в R20 items по имени
        совпало → патчим описание + формулы + bonuses из R20 поверх item компендиума
        не совпало → item компендиума как есть
    → накладываем Roll20 системные данные (stats, HP, AC...) сверху
    → готово
```

Items из Roll20 без совпадения в Laaru-акторе **добавляются как buildFromScratch** — это кастомные добавления GM'а.

### Путь B: Актёр НЕ найден в Actor-паках (fallback)

```
НПС "Кастомный Страж Башни" не найден нигде
    → для каждого R20 item (action/attack/spell):
        1. ищем в Item-паках по имени
        2. нашли (точно или нечётко) → item компендиума + патч R20 значений
           (описание, формулы урона, attack bonus, save DC — если есть в R20)
        3. не найдено → buildFromScratch(r20ItemData)
    → собираем список items
```

---

## 3. Алгоритм матчинга имён

Применяется последовательно, первое совпадение побеждает:

```
normalize(name):
    1. trim() + toLowerCase()
    2. ё → е  (Russian normalization)
    3. убрать содержимое скобок:  "Укус (легендарный)" → "укус"
    4. убрать лишние пробелы

Шаг 1: exact match           normalize(r20) === normalize(compendium)
Шаг 2: fuzzy match           levenshtein_similarity > 0.80
Шаг 3: no match → fallback
```

Язык не нужно определять явно: русские имена ищутся в русском компендиуме, английские — в английском. Один и тот же индекс содержит всё.

Fuzzy matching: используем стандартный алгоритм Levenshtein distance.
Порог 80% настраивается в UI (слайдер).

---

## 3a. Политика слияния R20 + компендиум (применяется всегда при совпадении)

При **любом** совпадении (точном или нечётком) компендиум — это **шаблон структуры**, а Roll20 — **источник конкретных значений**. R20 данные всегда перезаписывают компендиум там где они есть.

| Поле | Логика |
|---|---|
| `description.value` | R20 если непустое, иначе компендиум |
| `activities[*].damage.parts[0].formula` | R20 если есть `dmgbase` / `spelldamage` |
| `activities[*].damage.parts[1].formula` | R20 если есть `dmgbase2` / `spelldamage2` |
| `activities[*].attack.bonus` | R20 если есть `attack_tohit` |
| `activities[*].save.dc.formula` | R20 если есть `savedc` |
| `activities[*].save.ability` | R20 если есть `saveattr` |
| `activities[*].range.value` | R20 если есть (для ranged атак) |
| `activities[*].activation.type` | Компендиум (структурное) |
| `system.damage.parts` (base item) | R20 если есть |
| Тип урона (`types`) | R20 если есть, иначе компендиум |
| `img` (иконка item) | Компендиум |
| Всё остальное | Компендиум |

**Правило**: если R20 поле пустое/нулевое/отсутствует — оставляем значение из компендиума.
Это означает: стандартный монстр получит правильные цифры из Roll20 кампании,
а кастомный или изменённый GM'ом — свои модифицированные значения.

---

## 4. buildFromScratch — сборка item с нуля

Когда ничего не найдено в компендиуме, строим из R20 данных.

### Определение типа item

```
Есть npcaction_attack_tohit И npcaction_dmgbase  → тип "attack"
Есть npcaction_savedc                             → тип "save"
Есть spell_level                                  → тип "spell"
Всё остальное                                     → тип "feat" (описательная черта)
```

### Структуры dnd5e 4.x activities

**Attack (melee/ranged):**
```json
{
  "type": "weapon",
  "system": {
    "description": { "value": "<p>Описание из Roll20</p>" },
    "activities": {
      "dnd5eactivity000": {
        "_id": "dnd5eactivity000",
        "type": "attack",
        "activation": { "type": "action", "value": 1, "condition": "" },
        "attack": {
          "bonus": "+7",
          "type": { "value": "melee", "classification": "natural" }
        },
        "damage": {
          "onSave": "half",
          "parts": [{ "formula": "2d6+5", "types": ["piercing"] }]
        },
        "range": { "value": 5, "units": "ft" }
      }
    }
  }
}
```

**Save-based action:**
```json
{
  "type": "feat",
  "system": {
    "activities": {
      "dnd5eactivity000": {
        "type": "save",
        "activation": { "type": "action", "value": 1 },
        "save": {
          "ability": ["dex"],
          "dc": { "formula": "15", "calculation": "flat" }
        },
        "damage": {
          "onSave": "half",
          "parts": [{ "formula": "8d6", "types": ["fire"] }]
        }
      }
    }
  }
}
```

**Feat (descriptive, no roll):**
```json
{
  "type": "feat",
  "system": {
    "description": { "value": "<p>Текст из Roll20</p>" },
    "activities": {}
  }
}
```

---

## 5. Структура новых файлов

```
scripts/library/
  compendium-index.js    — сканирует game.packs, строит name→{packId,docId} индексы
  name-matcher.js        — normalize() + levenshteinSimilarity() + findBest()
  item-factory.js        — buildFromScratch(r20item) → dnd5e 4.x item data
  item-enricher.js       — для одного R20 item: поиск → patch → fallback
  actor-assembler.js     — путь A (actor template) + путь B (item-by-item)
```

### compendium-index.js

```js
// Публичный API:
class CompendiumIndex {
  async build(actorPackIds, itemPackIds)  // один раз при старте импорта
  findActor(name)   // → { packId, docId, score } | null
  findItem(name)    // → { packId, docId, score } | null
  async loadDocument(packId, docId)       // lazy, кешируется
}
```

Индекс строится через `pack.getIndex()` — легко. Документы загружаются лениво по попаданию через `pack.getDocument(id)`.

### name-matcher.js

```js
export function normalize(name)                      // нормализация строки
export function levenshteinSimilarity(a, b)          // 0..1
export function findBest(query, candidates, threshold) // → { item, score } | null
```

### item-factory.js

```js
// Входные данные: объект из R20 repeating_npcaction / repeating_npcspell / etc.
export function buildNPCActionItem(r20action, idMapper)  // attack или save или feat
export function buildNPCSpellItem(r20spell, idMapper)    // spell с activities
```

### item-enricher.js

```js
// Для одного R20 item — полный цикл: поиск → patch → fallback
export async function enrichItem(r20item, index, idMapper)
// → dnd5e item data (из компендиума или построенный с нуля)
```

### actor-assembler.js

```js
export class ActorAssembler {
  constructor(index, options)

  // Главная точка входа
  async assemble(baseActorData, r20char, idMapper)
  // → обогащённый actorData

  // Путь A: найти актёра в Actor-паках
  async #tryActorTemplate(r20char, baseActorData)

  // Путь B: обогатить items по одному
  async #enrichItemsOneByOne(r20char, idMapper)
}
```

---

## 6. Интеграция в существующий код

### importer.js — минимальные изменения

```js
// Существующий поток:
const baseActorData = await adapter.toActorData(r20char, ...);

// НОВОЕ: если включена библиотечная сборка
if (this.options.useLibrary && this.assembler) {
  const enriched = await this.assembler.assemble(baseActorData, r20char, this.idMapper);
  actorsToCreate.push(enriched);
} else {
  actorsToCreate.push(baseActorData);
}
```

`ActorAssembler` инициализируется один раз перед циклом по актёрам:

```js
// В run() перед #importActors():
if (this.options.useLibrary) {
  const index = new CompendiumIndex();
  await index.build(this.options.actorPackIds, this.options.itemPackIds);
  this.assembler = new ActorAssembler(index, this.options);
}
```

### ogl5e-parser.js — изменения минимальны

`toActorData()` продолжает работать как сейчас и строит базовый актёр.
`AssemblerAssembler` получает этот базовый актёр и заменяет только items.

---

## 7. UI — секция в диалоге импорта

Новая секция в `import-dialog.js` и `templates/import-dialog.html`:

```
─────────────────────────────────────────────
  Библиотечная сборка НПС
─────────────────────────────────────────────
  [x] Обогащать НПС из компендиумов

  Паки актёров (источники шаблонов):
    [x] Laaru — Бестиарий         ↑ ↓
    [ ] SRD Monsters              ↑ ↓

  Паки предметов/заклинаний:
    [x] Laaru — Заклинания        ↑ ↓
    [x] Laaru — Снаряжение и черты ↑ ↓

  Порог совпадения: ──●────── 80%
                    (точнее)   (мягче)
─────────────────────────────────────────────
```

Список паков берётся из `game.packs.filter(p => ["Actor","Item"].includes(p.metadata.type))`.
Порядок = приоритет при конфликте между паками.

---

## 8. Последовательность реализации

```
Шаг 1  name-matcher.js        — normalize + levenshtein, покрыть тестами (node)
Шаг 2  compendium-index.js    — build() + findActor() + findItem() + loadDocument()
Шаг 3  item-factory.js        — buildNPCActionItem + buildNPCSpellItem (buildFromScratch)
Шаг 4  item-enricher.js       — enrichItem() с полным циклом поиска/fallback
Шаг 5  actor-assembler.js     — путь A + путь B
Шаг 6  importer.js            — интеграция (опционально, за флагом useLibrary)
Шаг 7  import-dialog.js/html  — UI выбора компендиумов
Шаг 8  Тестирование на реальном экспорте
```

Каждый шаг изолирован и тестируется независимо.

---

## 9. Открытые детали для реализации

- **Levenshtein**: написать самому (5 строк) или взять из `foundry.utils` если есть аналог.
- **Определение melee/ranged**: в R20 `npcaction_attacktype` = "melee" | "ranged" | "both". Если пусто — default melee.
- **Заклинания через актёра (Путь A)**: spell items в Laaru-акторе уже содержат `activities`. Если актёр найден — используем их как есть.
- **Legendary actions**: в R20 `repeating_npcaction` с `npcaction_legendary = "1"`. В Foundry — обычные feat items, отображение через `details.legendary`.
- **Multiattack**: R20 описание действия. В Foundry — `type: "feat"` без активности (просто текст).
