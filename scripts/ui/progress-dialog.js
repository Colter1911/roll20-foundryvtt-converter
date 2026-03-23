/**
 * R20ProgressDialog — ApplicationV2 диалог отображения прогресса импорта.
 * Обновляется через метод update(info) в ходе импорта.
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class R20ProgressDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "r20-progress-dialog",
    classes: ["r20-progress-dialog"],
    window: {
      title: "R20Import.Progress.Title",
      resizable: false,
      minimizable: false,
    },
    position: { width: 400 },
  };

  static PARTS = {
    progress: {
      template: "modules/r20-to-fvtt/templates/progress-dialog.hbs",
    },
  };

  /** Текущие данные прогресса */
  #progressData = { total: 1, current: 0, label: "" };

  async _prepareContext() {
    return {};
  }

  /**
   * Обновить прогресс-бар.
   * @param {{ total?: number, current: number, label: string }} info
   */
  update(info) {
    if (info.total !== undefined) this.#progressData.total   = info.total;
    this.#progressData.current = info.current ?? this.#progressData.current;
    this.#progressData.label   = info.label   ?? "";

    if (!this.rendered) return;

    const pct = Math.min(100, Math.round(
      (this.#progressData.current / Math.max(1, this.#progressData.total)) * 100
    ));

    const bar   = this.element?.querySelector("#r20-progress-bar");
    const label = this.element?.querySelector("#r20-progress-label");
    const step  = this.element?.querySelector("#r20-progress-step");

    if (bar)   bar.style.width  = `${pct}%`;
    if (label) label.textContent = this.#progressData.label;
    if (step)  step.textContent  = `${this.#progressData.current} / ${this.#progressData.total}`;
  }
}
