/**
 * R20ImportDialog — ApplicationV2 диалог импорта Roll20 кампании.
 */

import { R20Importer } from "../importer.js";
import { R20ProgressDialog } from "./progress-dialog.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class R20ImportDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "r20-import-dialog",
    classes: ["r20-import-dialog"],
    window: {
      title: "R20Import.Dialog.Title",
      resizable: false,
    },
    position: { width: 530 },
    actions: {
      startImport: R20ImportDialog.#startImport,
      close: R20ImportDialog.#closeDialog,
    },
  };

  static PARTS = {
    form: {
      template: "modules/r20-to-fvtt/templates/import-dialog.hbs",
    },
  };

  /** Подготовить контекст для шаблона */
  async _prepareContext(options) {
    const lastOptions = game.settings.get("r20-to-fvtt", "lastOptions") ?? {};
    return { lastOptions };
  }

  /** Запуск импорта */
  static async #startImport(event, _target) {
    const form = this.element.querySelector("form") ?? this.element;
    const fileInput = this.element.querySelector('input[name="zipFile"]');
    const file = fileInput?.files?.[0];

    if (!file) {
      ui.notifications.warn(game.i18n.localize("R20Import.Notify.NoFile"));
      return;
    }

    // Собрать опции из формы
    const opts = {
      importActors:    this.element.querySelector('[name="importActors"]')?.checked    ?? true,
      importJournal:   this.element.querySelector('[name="importJournal"]')?.checked   ?? true,
      importScenes:    this.element.querySelector('[name="importScenes"]')?.checked    ?? true,
      importTables:    this.element.querySelector('[name="importTables"]')?.checked    ?? true,
      importPlaylists: this.element.querySelector('[name="importPlaylists"]')?.checked ?? true,
      importMacros:    this.element.querySelector('[name="importMacros"]')?.checked    ?? true,
      autoDoors:       this.element.querySelector('[name="autoDoors"]')?.checked       ?? false,
      doorColor:       this.element.querySelector('[name="doorColor"]')?.value         ?? "#6600cc",
      secretDoorColor: this.element.querySelector('[name="secretDoorColor"]')?.value   ?? "#ff0000",
    };

    // Сохранить для следующего запуска
    await game.settings.set("r20-to-fvtt", "lastOptions", opts);
    await this.close();

    // Показать прогресс
    const progress = new R20ProgressDialog();
    await progress.render(true);

    try {
      const importer = new R20Importer(opts);
      const result   = await importer.run(file, (p) => progress.update(p));

      progress.close();

      if (result.errors.length > 0) {
        ui.notifications.error(
          game.i18n.format("R20Import.Notify.Errors", { n: result.errors.length })
        );
      } else {
        ui.notifications.info(game.i18n.localize("R20Import.Notify.Success"));
      }
    } catch (err) {
      progress.close();
      console.error("R20Import | Critical error:", err);
      ui.notifications.error(`R20Import: ${err.message}`);
    }
  }

  /** Закрыть диалог */
  static #closeDialog() {
    this.close();
  }
}
