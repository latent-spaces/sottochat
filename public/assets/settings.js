(() => {
  const form = document.getElementById("settings-form");
  const root = document.getElementById("settings-root");
  const index = document.getElementById("settings-index");
  const note = document.getElementById("settings-note");
  const storage = document.getElementById("settings-storage");
  const status = document.getElementById("settings-status");
  const saveButton = document.getElementById("save-settings");
  const mobileSaveButton = document.getElementById("mobile-save-settings");
  const changeSummary = document.getElementById("change-summary");
  const mobileChangeSummary = document.getElementById("mobile-change-summary");
  const restartHint = document.getElementById("restart-hint");
  const LANG_KEY = "cutCakeLang";

  let catalog = null;
  const itemsByKey = new Map();
  const controlsByKey = new Map();
  const errorsByKey = new Map();
  const dirtyKeys = new Set();
  const resetKeys = new Set();

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatDuration(ms) {
    if (ms >= 60_000 && ms % 60_000 === 0) {
      const minutes = ms / 60_000;
      if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} h`;
      return `${minutes} min`;
    }
    if (ms >= 1000 && ms % 1000 === 0) return `${ms / 1000} s`;
    return `${ms} ms`;
  }

  function formatValue(item, value = item.value) {
    if (item.kind === "boolean") return value ? "on" : "off";
    if (value === "") return "all projects";
    if (item.unit === "milliseconds") return formatDuration(Number(value));
    if (item.unit === "minutes") {
      const minutes = Number(value);
      return minutes >= 60 && minutes % 60 === 0
        ? `${minutes} min (${minutes / 60} h)`
        : `${minutes} min`;
    }
    return item.unit && item.unit !== "port" ? `${value} ${item.unit}` : String(value);
  }

  function environmentValue(item, value) {
    if (item.kind === "boolean") return value ? "1" : "0";
    return String(value);
  }

  function showStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle("error", isError);
  }

  function controlValue(item, control) {
    if (item.kind === "boolean") return control.value === "true";
    if (item.kind === "number") return Number(control.value);
    return control.value;
  }

  function valuesEqual(a, b) {
    return typeof a === typeof b && a === b;
  }

  function setControlValue(item, control, value) {
    if (item.kind === "boolean") control.value = value ? "true" : "false";
    else control.value = String(value);
  }

  function pendingRestartCount() {
    if (!catalog) return 0;
    return catalog.groups
      .flatMap((group) => group.settings || [])
      .filter((item) => item.pendingRestart).length;
  }

  function updateSaveState() {
    const count = dirtyKeys.size;
    const summary = count === 0
      ? "no unsaved changes"
      : `${count} unsaved change${count === 1 ? "" : "s"}`;
    for (const target of [changeSummary, mobileChangeSummary]) {
      target.textContent = summary;
      target.classList.toggle("dirty", count > 0);
    }
    saveButton.disabled = count === 0;
    mobileSaveButton.disabled = count === 0;

    const pending = pendingRestartCount();
    restartHint.hidden = pending === 0;
    restartHint.textContent = pending === 1
      ? "1 saved change needs restart"
      : `${pending} saved changes need restart`;
  }

  function validateControl(item, control) {
    const error = errorsByKey.get(item.key);
    if (!control.checkValidity()) {
      error.textContent = control.validationMessage;
      return false;
    }
    error.textContent = "";
    return true;
  }

  function onControlChanged(item, control) {
    resetKeys.delete(item.key);
    validateControl(item, control);
    const value = controlValue(item, control);
    if (valuesEqual(value, item.nextValue)) dirtyKeys.delete(item.key);
    else dirtyKeys.add(item.key);
    updateSaveState();
  }

  function resetSetting(item, control) {
    setControlValue(item, control, item.defaultValue);
    validateControl(item, control);
    const alreadyDefault = item.savedValue === undefined
      && valuesEqual(item.nextValue, item.defaultValue);
    if (alreadyDefault) {
      dirtyKeys.delete(item.key);
      resetKeys.delete(item.key);
    } else {
      dirtyKeys.add(item.key);
      resetKeys.add(item.key);
    }
    updateSaveState();
    control.focus();
  }

  async function copyAssignment(item, button) {
    const control = controlsByKey.get(item.key);
    const value = control ? controlValue(item, control) : item.nextValue;
    const assignment = `${item.key}=${environmentValue(item, value)}`;
    try {
      await navigator.clipboard.writeText(assignment);
      const previous = button.textContent;
      button.textContent = "copied";
      showStatus(`${assignment} copied`);
      setTimeout(() => { button.textContent = previous; }, 1000);
    } catch {
      showStatus(`could not copy ${item.key}`, true);
    }
  }

  function makeSelect(item) {
    const select = element("select");
    const options = item.kind === "boolean"
      ? [{ value: "true", label: "on" }, { value: "false", label: "off" }]
      : (item.options || []);
    for (const option of options) {
      const optionNode = element("option", "", option.label);
      optionNode.value = option.value;
      select.appendChild(optionNode);
    }
    return select;
  }

  function makeInput(item) {
    const input = element("input");
    input.type = item.kind === "number" ? "number" : "text";
    input.spellcheck = false;
    if (item.kind === "number") {
      input.required = true;
      if (item.min !== undefined) input.min = String(item.min);
      if (item.max !== undefined) input.max = String(item.max);
      if (item.step !== undefined) input.step = String(item.step);
    } else if (item.key !== "META_PROJECT_SLUG") {
      input.required = true;
    }
    if (item.key === "META_PROJECT_SLUG") input.placeholder = "all projects";
    return input;
  }

  function renderControl(item) {
    const wrap = element("div", "setting-control");
    const line = element("div", "control-line");
    const fieldWrap = element("div", "field-wrap");
    const control = item.kind === "select" || item.kind === "boolean"
      ? makeSelect(item)
      : makeInput(item);
    control.id = `setting-${item.key}`;
    control.setAttribute("aria-label", item.label);
    control.disabled = !item.editable;
    setControlValue(item, control, item.nextValue);

    if (item.kind === "number" && item.unit && item.unit !== "port") {
      control.classList.add("has-unit");
      fieldWrap.append(control, element("span", "field-unit", item.unit));
    } else {
      fieldWrap.appendChild(control);
    }

    const reset = element("button", "reset-button", "reset");
    reset.type = "button";
    reset.disabled = !item.editable;
    reset.title = `reset ${item.label} to its default`;
    reset.addEventListener("click", () => resetSetting(item, control));

    const error = element("p", "field-error");
    error.id = `error-${item.key}`;
    control.setAttribute("aria-describedby", error.id);
    control.addEventListener("input", () => onControlChanged(item, control));
    control.addEventListener("change", () => onControlChanged(item, control));

    controlsByKey.set(item.key, control);
    errorsByKey.set(item.key, error);
    line.append(fieldWrap, reset);
    wrap.append(line, renderValueMeta(item), error);
    return wrap;
  }

  function renderValueMeta(item) {
    const meta = element("div", "value-meta");
    if (item.restartRequired) {
      meta.appendChild(element("span", item.pendingRestart ? "meta-pending" : "", item.pendingRestart ? "restart pending" : "restart required"));
    } else {
      meta.appendChild(element("span", "meta-live", "applies immediately"));
    }
    meta.appendChild(element("span", "", `current ${formatValue(item)}`));
    if (!item.editable) {
      meta.appendChild(element("span", "locked-note", `set by ${item.source}`));
    } else if (item.source !== "default") {
      meta.appendChild(element("span", "", `started from ${item.source}`));
    }
    return meta;
  }

  function renderSetting(item) {
    itemsByKey.set(item.key, item);
    const row = element("div", `setting-row${item.editable ? "" : " locked"}`);
    const info = element("div", "setting-info");
    const label = element("label", "setting-label", item.label);
    label.htmlFor = `setting-${item.key}`;
    info.append(label, element("p", "setting-description", item.description));

    const env = element("div", "setting-env");
    const envButton = element("button", "env-key", item.key);
    envButton.type = "button";
    envButton.title = `copy ${item.key} with the edited value`;
    envButton.addEventListener("click", () => copyAssignment(item, envButton));
    env.appendChild(envButton);
    const aliasText = Array.isArray(item.aliases) && item.aliases.length
      ? `also ${item.aliases.join(", ")}`
      : `source ${item.source}`;
    env.appendChild(element("span", "source-label", aliasText));
    info.appendChild(env);

    row.append(info, renderControl(item));
    return row;
  }

  function renderCatalog(nextCatalog) {
    catalog = nextCatalog;
    root.replaceChildren();
    index.replaceChildren();
    root.setAttribute("aria-busy", "false");
    itemsByKey.clear();
    controlsByKey.clear();
    errorsByKey.clear();
    dirtyKeys.clear();
    resetKeys.clear();
    if (catalog.note) note.textContent = catalog.note;
    if (catalog.storage) storage.textContent = catalog.storage;

    for (const group of catalog.groups || []) {
      const indexLink = element("a", "index-link");
      indexLink.href = `#${group.id}`;
      indexLink.append(
        element("span", "", group.label),
        element("span", "index-count", String((group.settings || []).length)),
      );
      index.appendChild(indexLink);

      const section = element("section", "settings-section");
      section.id = group.id;
      const heading = element("div", "group-head");
      heading.append(
        element("h2", "", group.label),
        element("p", "", group.description),
      );
      const list = element("div", "settings-list");
      for (const item of group.settings || []) list.appendChild(renderSetting(item));
      section.append(heading, list);
      root.appendChild(section);
    }
    updateSaveState();
  }

  function focusServerError(result) {
    if (!result.key) return;
    const control = controlsByKey.get(result.key);
    const error = errorsByKey.get(result.key);
    if (error) error.textContent = result.error || "invalid value";
    if (control) control.focus();
  }

  async function saveChanges() {
    if (dirtyKeys.size === 0) return;
    for (const key of dirtyKeys) {
      const item = itemsByKey.get(key);
      const control = controlsByKey.get(key);
      if (!item || !control || validateControl(item, control)) continue;
      control.focus();
      showStatus(`check ${item.label}`, true);
      return;
    }

    const values = {};
    for (const key of dirtyKeys) {
      const item = itemsByKey.get(key);
      const control = controlsByKey.get(key);
      if (!item || !control) continue;
      values[key] = resetKeys.has(key) ? null : controlValue(item, control);
    }

    saveButton.disabled = true;
    mobileSaveButton.disabled = true;
    saveButton.textContent = "saving…";
    mobileSaveButton.textContent = "saving…";
    showStatus("saving settings…");

    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        focusServerError(result);
        throw new Error(result.error || `settings request failed (${response.status})`);
      }
      renderCatalog(result.settings);
      const language = result.settings.groups
        .flatMap((group) => group.settings || [])
        .find((item) => item.key === "META_EXPLAIN_LANG");
      if (language) localStorage.setItem(LANG_KEY, String(language.value));
      const pending = pendingRestartCount();
      showStatus(pending > 0
        ? `saved. restart sottochat to apply ${pending} change${pending === 1 ? "" : "s"}`
        : "settings saved");
    } catch (error) {
      showStatus(error instanceof Error ? error.message : "settings could not be saved", true);
      updateSaveState();
    } finally {
      saveButton.textContent = "save changes";
      mobileSaveButton.textContent = "save";
    }
  }

  async function loadSettings() {
    try {
      const response = await fetch("/api/settings", { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`settings request failed (${response.status})`);
      renderCatalog(await response.json());
    } catch (error) {
      root.setAttribute("aria-busy", "false");
      root.replaceChildren();
      const panel = element("div", "load-error");
      panel.append(
        element("strong", "", "settings unavailable"),
        element("p", "", error instanceof Error ? error.message : "could not load settings"),
      );
      root.appendChild(panel);
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveChanges();
  });

  loadSettings();
})();
