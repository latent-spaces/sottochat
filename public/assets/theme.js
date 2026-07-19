(() => {
  const STORAGE_KEY = "sottochatColorSystem";
  const DEFAULT_ID = "quiet-berry";
  const systems = [
    { id: "quiet-berry", label: "Quiet Berry", description: "warm paper, strawberry action, plum agent", swatches: ["oklch(98% 0.008 350)", "oklch(57% 0.205 354)", "oklch(58% 0.15 310)"] },
    { id: "ink-ember", label: "Ink and Ember", description: "warm mineral neutrals with a coral signal", swatches: ["oklch(97.5% 0.008 45)", "oklch(56% 0.17 34)", "oklch(48% 0.09 255)"] },
    { id: "session-spectrum", label: "Session Spectrum", description: "cool shell with per-session identity colors", swatches: ["oklch(97% 0.009 265)", "oklch(52% 0.19 273)", "oklch(56% 0.15 190)"] },
    { id: "radix-ruby", label: "Radix Ruby", description: "published Radix Mauve, Ruby, and Plum", swatches: ["#fdfcfd", "#e54666", "#ab4aba"] },
  ];
  const known = new Set(systems.map((system) => system.id));

  function normalize(id) {
    return known.has(id) ? id : DEFAULT_ID;
  }

  function current() {
    try { return normalize(localStorage.getItem(STORAGE_KEY)); }
    catch { return DEFAULT_ID; }
  }

  function apply(id, persist = false) {
    const next = normalize(id);
    document.documentElement.dataset.colorSystem = next;
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, next); } catch {}
    }
    window.dispatchEvent(new CustomEvent("sottochat:color-system", { detail: { id: next } }));
    return next;
  }

  window.SottochatTheme = { STORAGE_KEY, DEFAULT_ID, systems, current, apply };
  apply(current());

  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) apply(event.newValue);
  });
})();
