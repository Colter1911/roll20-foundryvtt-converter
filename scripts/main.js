/**
 * Roll20 → Foundry VTT Import Module
 * main.js — инициализация, хуки, регистрация UI
 */

import { R20ImportDialog }   from "./ui/import-dialog.js";
import { R20ProgressDialog } from "./ui/progress-dialog.js";

// Экспортировать классы диалогов в глобальный неймспейс для удобства отладки
globalThis.R20ImportDialog   = R20ImportDialog;
globalThis.R20ProgressDialog = R20ProgressDialog;

/* ──────────────────────────────────────────────
   INIT: регистрация настроек модуля
─────────────────────────────────────────────── */
Hooks.once("init", () => {
  console.log("R20Import | Initialising Roll20 → Foundry VTT module");

  game.settings.register("r20-to-fvtt", "lastOptions", {
    name: game.i18n.localize("R20Import.Setting.LastOptions"),
    scope: "client",
    config: false,
    type: Object,
    default: {
      importActors:    true,
      importJournal:   true,
      importScenes:    true,
      importTables:    true,
      importPlaylists: true,
      importMacros:    true,
      autoDoors:       false,
      doorColor:       "#6600cc",
      secretDoorColor: "#ff0000",
    },
  });
});

/* ──────────────────────────────────────────────
   READY: загрузка шаблонов
─────────────────────────────────────────────── */
Hooks.once("ready", async () => {
  await loadTemplates([
    "modules/r20-to-fvtt/templates/import-dialog.hbs",
    "modules/r20-to-fvtt/templates/progress-dialog.hbs",
  ]);
  console.log("R20Import | Templates loaded");
});

/* ──────────────────────────────────────────────
   UI: кнопка в секции Game Settings сайдбара
─────────────────────────────────────────────── */
Hooks.on("renderSettings", (app, html) => {
  // Поддержка как HTMLElement так и jQuery-объектов (Foundry v13 возвращает HTMLElement)
  const root = html instanceof HTMLElement ? html : html[0];

  const btn = document.createElement("button");
  btn.type = "button";
  btn.innerHTML = `<i class="fa-solid fa-file-import"></i> ${game.i18n.localize("R20Import.Button.Label")}`;
  btn.classList.add("r20-import-btn");
  btn.addEventListener("click", () => new R20ImportDialog().render(true));

  // Вставляем в секцию game settings или в начало окна настроек (#settings-game для v12+, .settings-list fallback)
  const gameSection = root.querySelector("#settings-game") ?? root.querySelector(".settings-list");
  if (gameSection) {
    // Вставить кнопку после заголовка или в начало
    const header = gameSection.querySelector("h2, header");
    if (header && header.nextSibling) {
      header.parentNode.insertBefore(btn, header.nextSibling);
    } else {
      gameSection.prepend(btn);
    }
  } else {
    // Fallback: просто вставить в начало контента
    const content = root.querySelector(".window-content") ?? root;
    content.prepend(btn);
  }
});
