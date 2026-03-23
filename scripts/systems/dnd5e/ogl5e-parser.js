/**
 * ogl5e-parser.js — OGL 5e адаптер (основной лист дnd5e в Roll20).
 * Поддерживает Legacy и Jumpgate форматы, PC и NPC.
 */

import { BaseSystemAdapter } from "../base-system.js";
import { SheetDetector }     from "./sheet-detector.js";
import { ABILITIES, SKILL_MAP, SPELL_LEVELS } from "./field-maps.js";
import {
  buildSpellItems, buildAttackItems, buildInventoryItems,
  buildTraitItems, buildNPCActionItems, buildNPCAttackItems
} from "./items.js";
import {
  buildOwnership, parseAC, parseSpeed, parseCR, parseNPCType
} from "../../core/utils.js";

export class OGL5eAdapter extends BaseSystemAdapter {
  get priority() { return 10; }

  canHandle(r20char) {
    return SheetDetector.detect(r20char) === "ogl5e";
  }

  async toActorData(r20char, idMapper, assets, zip, playerIdMap, folderMap, avatarZipPath = "", tokenZipPath = "") {
    const isNPC = r20char.flag("npc");

    // ── Изображения ───────────────────────────────
    // Пути уже найдены в importer.js с помощью более точной логики.
    // Fallback на внутренние методы если importer ничего не передал.
    const resolvedAvatarPath = avatarZipPath || this.#resolveAvatarPath(zip, r20char);
    const resolvedTokenPath  = tokenZipPath  || this.#resolveTokenPath(zip, r20char);

    // Уникальные имена файлов: ID актёра + суффикс, чтобы не перезаписывать чужие файлы
    const actorSlug  = r20char.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24) || String(r20char._zipIndex);
    const avatarExt  = resolvedAvatarPath ? resolvedAvatarPath.split(".").pop() : "png";
    const tokenExt   = resolvedTokenPath  ? resolvedTokenPath.split(".").pop()  : "png";

    const avatarPath = resolvedAvatarPath
      ? await assets.upload(zip, resolvedAvatarPath, `${actorSlug}_avatar.${avatarExt}`, "actors")
      : "";
    const tokenPath = resolvedTokenPath
      ? await assets.upload(zip, resolvedTokenPath, `${actorSlug}_token.${tokenExt}`, "actors")
      : "";

    // ── Items ─────────────────────────────────────
    const items = isNPC
      ? [
          ...buildNPCActionItems(r20char, idMapper),
          ...buildNPCAttackItems(r20char, idMapper),
          ...buildSpellItems(r20char, idMapper),
        ]
      : [
          ...buildSpellItems(r20char, idMapper),
          ...buildAttackItems(r20char, idMapper),
          ...buildInventoryItems(r20char, idMapper),
          ...buildTraitItems(r20char, idMapper),
        ];

    // ── System data ───────────────────────────────
    const system = isNPC
      ? this.#buildNPCSystem(r20char)
      : this.#buildPCSystem(r20char);

    return {
      _id:    idMapper.getOrCreate(r20char.id),
      name:   r20char.name,
      type:   isNPC ? "npc" : "character",
      img:    avatarPath || null,
      folder: folderMap?.get(r20char.id) ?? null,
      ownership: buildOwnership(r20char, playerIdMap),
      system,
      items,
      prototypeToken: this.#buildPrototypeToken(r20char, tokenPath, isNPC),
      flags: { "r20-to-fvtt": { originalId: r20char.id, sheet: "ogl5e" } },
    };
  }

  // ── PC system data ───────────────────────────────

  #buildPCSystem(r20char) {
    return {
      abilities: this.#buildAbilities(r20char),
      attributes: this.#buildPCAttributes(r20char),
      details: {
        race:       r20char.attr("race"),
        background: r20char.attr("background"),
        alignment:  r20char.attr("alignment"),
        biography:  { value: r20char.bio || "" },
        xp:         { value: r20char.num("experience") || r20char.num("xp") },
        level:      r20char.num("level", 1),
        age:        r20char.attr("age"),
        height:     r20char.attr("height"),
        weight:     r20char.attr("weight"),
        eyes:       r20char.attr("eyes"),
        hair:       r20char.attr("hair"),
        skin:       r20char.attr("skin"),
      },
      skills:   this.#buildSkills(r20char),
      currency: {
        pp: r20char.num("pp"), gp: r20char.num("gp"),
        ep: r20char.num("ep"), sp: r20char.num("sp"), cp: r20char.num("cp"),
      },
      spells:   this.#buildSpellSlots(r20char),
      traits: {
        languages:   { value: [], custom: r20char.attr("languages") },
        di:          { value: [], custom: r20char.attr("immunities") },
        dr:          { value: [], custom: r20char.attr("resistances") },
        dv:          { value: [], custom: r20char.attr("vulnerabilities") },
        weaponProf:  { value: [], custom: r20char.attr("otherweaponprof") },
        armorProf:   { value: [], custom: r20char.attr("armortype") },
      },
    };
  }

  // ── NPC system data ──────────────────────────────

  #buildNPCSystem(r20char) {
    const npcType = parseNPCType(r20char.attr("npc_type"));
    return {
      abilities: this.#buildAbilities(r20char),
      attributes: this.#buildNPCAttributes(r20char),
      details: {
        biography: { value: r20char.bio || r20char.gmNotes || "" },
        type: {
          value:   npcType.value,
          subtype: npcType.subtype,
        },
        cr:  parseCR(r20char.attr("npc_challenge") || r20char.attr("challenge")),
        xp:  { value: r20char.num("npc_xp") },
        alignment: r20char.attr("npc_alignment") || r20char.attr("alignment"),
        environ:   r20char.attr("environment") || "",
        source:    { book: "Roll20 Import" },
      },
      resources: {
        legact: { spent: 0, max: r20char.num("npc_legendary_actions") },
        legres: { spent: 0, max: r20char.num("npc_legendary_resist")  },
        lair:   { value: false, initiative: null, inside: false },
      },
      traits: {
        size: this.#parseSize(r20char.attr("npc_type")),
        languages: { value: [], custom: r20char.attr("npc_languages") },
        di: { value: [], bypasses: [], custom: r20char.attr("npc_immunities")      || r20char.attr("damage_immunities") },
        dr: { value: [], bypasses: [], custom: r20char.attr("npc_resistances")     || r20char.attr("damage_resistances") },
        dv: { value: [], bypasses: [], custom: r20char.attr("npc_vulnerabilities") || r20char.attr("damage_vulnerabilities") },
        ci: { value: [], custom: r20char.attr("npc_condition_immunities") || r20char.attr("condition_immunities") },
      },
    };
  }

  // ── Общие части ──────────────────────────────────

  #buildAbilities(r20char) {
    const abilities = {};
    for (const [fvtt, r20] of ABILITIES) {
      abilities[fvtt] = {
        value:      r20char.num(r20, 10),
        proficient: r20char.flag(`${r20}_save_prof`) ? 1 : 0,
      };
    }
    return abilities;
  }

  #buildPCAttributes(r20char) {
    return {
      hp: {
        value: r20char.num("hp"),
        min:   0,
        max:   r20char.num("hp_max") || r20char.num("HP"),
        temp:  r20char.num("hp_temp"),
      },
      ac: { flat: parseAC(r20char.attr("ac")), calc: "default" },
      movement: {
        walk:  parseSpeed(r20char.attr("speed")),
        fly:   parseSpeed(r20char.attr("speed_fly") || r20char.attr("fly")),
        swim:  parseSpeed(r20char.attr("speed_swim") || r20char.attr("swim")),
        climb: parseSpeed(r20char.attr("speed_climb") || r20char.attr("climb")),
        burrow: 0,
        units: "ft",
      },
      prof:     r20char.num("pb", 2),
      init:     { ability: "dex", bonus: r20char.num("initiative") },
      spellcasting: this.#resolveSpellcastingAbility(r20char),
      death: {
        success: 0,
        failure: 0,
      },
      exhaustion: 0,
      inspiration: false,
    };
  }

  #buildNPCAttributes(r20char) {
    const hpMax = r20char.attrMax("hp") || r20char.num("hp_max") || r20char.num("npc_hp_max") || 0;
    const hpVal = r20char.num("hp") || r20char.num("npc_hp") || hpMax;
    return {
      hp: {
        value:   hpVal,
        max:     hpMax,
        temp:    null,
        tempmax: null,
        formula: r20char.attr("npc_hpformula") || "",
      },
      ac:  { flat: parseAC(r20char.attr("npc_ac") || r20char.attr("ac")), calc: "natural" },
      movement: {
        walk:   parseSpeed(r20char.attr("npc_speed") || r20char.attr("speed")),
        fly:    parseSpeed(r20char.attr("npc_fly")   || r20char.attr("speed_fly")),
        swim:   parseSpeed(r20char.attr("npc_swim")  || r20char.attr("speed_swim")),
        climb:  parseSpeed(r20char.attr("npc_climb") || r20char.attr("speed_climb")),
        burrow: 0,
        hover:  false,
        units:  "ft",
      },
      senses: this.#parseNPCSenses(r20char),
      prof: r20char.num("pb", 2),
    };
  }

  #buildSkills(r20char) {
    const skills = {};
    for (const [r20name, fvttCode] of Object.entries(SKILL_MAP)) {
      const raw = r20char.attr(`${r20name}_prof`);
      skills[fvttCode] = {
        value: raw === "" ? 0 : parseFloat(raw) || 0,
      };
    }
    return skills;
  }

  #buildSpellSlots(r20char) {
    const spells = {};
    for (const level of SPELL_LEVELS) {
      const key = `spell${level}`;
      // OGL хранит слоты в разных полях в разных версиях — пробуем несколько вариантов
      const r20key = level === 0 ? "cantrip" : String(level);
      const max = (
        r20char.num(`lvl${r20key}_slots_total`)     ||
        r20char.num(`spell_level_${level}`)         ||
        r20char.num(`spellslot${level}_total`)      ||
        0
      );
      const used = (
        r20char.num(`lvl${r20key}_slots_expended`)  ||
        r20char.num(`spellslot${level}_remaining`)  ||
        0
      );
      spells[key] = { value: Math.max(0, max - used), max };
    }
    return spells;
  }

  #resolveSpellcastingAbility(r20char) {
    // Попытаться определить по классу
    const cls = String(r20char.attr("class") ?? "").toLowerCase();
    const CASTER_MAP = {
      wizard: "int", sorcerer: "cha", warlock: "cha",
      bard: "cha", cleric: "wis", druid: "wis",
      paladin: "cha", ranger: "wis", artificer: "int",
    };
    for (const [c, ab] of Object.entries(CASTER_MAP)) {
      if (cls.includes(c)) return ab;
    }
    return "int";
  }

  #buildPrototypeToken(r20char, tokenPath, isNPC) {
    const dt = r20char.defaultToken;
    const nightVision = parseInt(dt.night_vision_distance) || 0;

    return {
      name:    dt.name || r20char.name,
      // Foundry v13: изображение токена хранится в texture.src, не в img
      texture: {
        src:    tokenPath || "icons/svg/mystery-man.svg",
        scaleX: (dt.fliph === "True" || dt.fliph === true) ? -1 : 1,
        scaleY: (dt.flipv === "True" || dt.flipv === true) ? -1 : 1,
        tint:   "#ffffff",
        anchorX: 0.5,
        anchorY: 0.5,
      },
      width:   Math.max(0.5, (parseInt(dt.width)  || 70) / 70),
      height:  Math.max(0.5, (parseInt(dt.height) || 70) / 70),
      displayName: (dt.showplayers_name === "True" || dt.showplayers_name === true) ? 50 : 40,
      displayBars: 40,
      bar1: { attribute: "attributes.hp" },
      bar2: { attribute: null },
      sight: {
        enabled: dt.has_bright_light_vision === "True"
              || dt.has_low_light_vision     === "True"
              || dt.has_night_vision         === "True",
        range:       nightVision,
        brightness:  1,
        visionMode:  "basic",
        color:       null,
        attenuation: 0.1,
        saturation:  0,
        contrast:    0,
        angle:       360,
      },
      light: {
        dim:        parseFloat(dt.low_light_distance)    || 0,
        bright:     parseFloat(dt.bright_light_distance) || 0,
        color:      (dt.lightColor && dt.lightColor !== "transparent") ? dt.lightColor : null,
        angle:      parseFloat(dt.light_angle) || 360,
        alpha:      1,
        coloration: 1,
        luminosity: 0.5,
        saturation: 0,
        contrast:   0,
        shadows:    0,
        animation:  { type: null, speed: 5, intensity: 5, reverse: false },
        darkness:   { min: 0, max: 1 },
        attenuation: 0.5,
        negative:   false,
        priority:   0,
      },
      actorLink:   !isNPC,
      disposition: isNPC ? -1 : 1,
      alpha:       1,
      lockRotation: false,
    };
  }

  /** Парсировать senses NPC в структурный объект Foundry v13 */
  #parseNPCSenses(r20char) {
    const raw = r20char.attr("npc_senses") || r20char.attr("senses") || "";
    const senses = {
      darkvision:  0,
      blindsight:  0,
      tremorsense: 0,
      truesight:   0,
      units:       "ft",
      special:     "",
    };
    if (!raw) return senses;

    // Парсим строки вида "darkvision 60 ft., blindsight 30 ft."
    const SENSE_MAP = {
      darkvision:  "darkvision",
      blindsight:  "blindsight",
      tremorsense: "tremorsense",
      truesight:   "truesight",
      темновидение: "darkvision",
      слепое:      "blindsight",
      вибрационное: "tremorsense",
      истинное:    "truesight",
    };
    let remainder = raw;
    for (const [keyword, field] of Object.entries(SENSE_MAP)) {
      const m = new RegExp(`${keyword}[^0-9]*([0-9]+)`, "i").exec(raw);
      if (m) {
        senses[field] = parseInt(m[1]);
        remainder = remainder.replace(m[0], "");
      }
    }
    // Всё что не распознали — в special
    const leftover = remainder.replace(/,\s*,/g, ",").replace(/^[,\s.]+|[,\s.]+$/g, "").trim();
    if (leftover) senses.special = leftover;

    return senses;
  }

  /** Парсировать размер существа из строки типа */
  #parseSize(npcTypeStr) {
    const SIZE_MAP = {
      tiny: "tiny",       крошечный: "tiny",
      small: "sm",        маленький: "sm",
      medium: "med",      средний: "med",
      large: "lg",        большой: "lg",
      huge: "huge",       огромный: "huge",
      gargantuan: "grg",  исполинский: "grg",
    };
    const lower = String(npcTypeStr ?? "").toLowerCase();
    for (const [key, val] of Object.entries(SIZE_MAP)) {
      if (lower.includes(key)) return val;
    }
    return "med";
  }

  /** Построить путь к аватару в ZIP */
  #resolveAvatarPath(zip, r20char) {
    const idx = String(r20char._zipIndex).padStart(3, "0");
    const cleanName = r20char.name.replace(/[\\/:*?"<>|]/g, "-");
    
    // Ищем во всех возможных папках и с любыми расширениями
    for (const dir of [`characters/${idx} - ${r20char.name}`, `characters/${idx} - ${cleanName}`]) {
      for (const ext of ["png", "jpg", "jpeg", "webp", "gif"]) {
        const path = `${dir}/avatar.${ext}`;
        if (zip.file(path)) return path;
      }
    }
    return "";
  }

  /** Построить путь к токену в ZIP */
  #resolveTokenPath(zip, r20char) {
    const idx = String(r20char._zipIndex).padStart(3, "0");
    const cleanName = r20char.name.replace(/[\\/:*?"<>|]/g, "-");
    
    for (const dir of [`characters/${idx} - ${r20char.name}`, `characters/${idx} - ${cleanName}`]) {
      for (const ext of ["png", "jpg", "jpeg", "webp", "gif"]) {
        const path = `${dir}/token.${ext}`;
        if (zip.file(path)) return path;
      }
    }
    return "";
  }
}
