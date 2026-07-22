    // dom
    const cardsEl = document.getElementById("cards");
    const inboxEmpty = document.getElementById("inbox-empty");
    const ambientQuiet = document.getElementById("ambient-quiet");
    const reconnectIndicator = document.getElementById("reconnect-indicator");
    const detailEmpty = document.getElementById("detail-empty");
    const detailContent = document.getElementById("detail-content");
    const dName = document.getElementById("d-name");
    const dElapsed = document.getElementById("d-elapsed");
    const dUntouched = document.getElementById("d-untouched");
    const dUntouchedMins = document.getElementById("d-untouched-mins");
    const dChart = document.getElementById("d-chart");
    const dCodeChart = document.getElementById("d-code-chart");
    const dChartsToggle = document.getElementById("d-charts-toggle");
    const dChartsBand = document.getElementById("d-charts-band");
    const dConversation = document.getElementById("d-conversation");
    const dChatThread = document.getElementById("d-chat-thread");
    const dChatInput = document.getElementById("d-chat-input");
    const langSelect = document.getElementById("lang-select");
    const themeCycle = document.getElementById("theme-cycle");
    const autoExplainWrap = document.getElementById("auto-explain-wrap");
    const autoExplainTrigger = document.getElementById("auto-explain-trigger");
    const autoExplainMenu = document.getElementById("auto-explain-menu");
    const usageWrap = document.getElementById("usage-wrap");
    const usageTrigger = document.getElementById("usage-trigger");
    const usagePanel = document.getElementById("usage-panel");
    const usageButtonTotal = document.getElementById("usage-button-total");
    const usageTodayTotal = document.getElementById("usage-today-total");
    const usageTodayDate = document.getElementById("usage-today-date");
    const usageBreakdown = document.getElementById("usage-breakdown");
    const usageHistory = document.getElementById("usage-history");
    const authSetup = document.getElementById("auth-setup");
    const authTrigger = document.getElementById("auth-trigger");
    const authKicker = document.getElementById("auth-kicker");
    const authTitle = document.getElementById("auth-title");
    const authDescription = document.getElementById("auth-description");
    const authInstructions = document.getElementById("auth-instructions");
    const authCheck = document.getElementById("auth-check");
    const authCheckResult = document.getElementById("auth-check-result");
    const LANG_KEY = "cutCakeLang";
    const AUTH_CHOICE_KEY = "sottochatAuthChoice";
    const AUTO_EXPLAIN_KEY = "sottochatAutoExplainLong";
    const AUTO_EXPLAIN_THRESHOLDS = new Set([0, 350, 700, 1200]);
    // the explanation language. localStorage is the source of truth for this
    // browser; the choice is pushed to the server (which threads it into the
    // assistant + observer prompts) and mirrored to other clients over ws.
    let explainLang = localStorage.getItem(LANG_KEY) || "zh";
    function readAutoExplainThreshold(value) {
      if (value === "1") return 350; // migrate the original boolean preference
      const parsed = Number(value);
      return AUTO_EXPLAIN_THRESHOLDS.has(parsed) ? parsed : 0;
    }
    let autoExplainThreshold = readAutoExplainThreshold(localStorage.getItem(AUTO_EXPLAIN_KEY));
    let usageState = { today: "", days: [] };

    // localized UI strings for the conversational surface. chrome elsewhere
    // stays english; only the ask box, quick-replies, and the copy card follow
    // the chosen language. the assistant answers in the language regardless.
    const UI_STRINGS = {
      he: { ask: "שאל משהו על הפלט…", toAgent: "תשובה לסוכן", copy: "העתק", copied: "הועתק", updating: "מתעדכן…", presets: ["מה כתוב פה", "תסכם בקצרה"] },
      en: { ask: "ask about the output…", toAgent: "reply to agent", copy: "copy", copied: "copied", updating: "updating…", presets: ["what does this say?", "summarize briefly"] },
      ar: { ask: "اسأل عن المخرجات…", toAgent: "رد إلى الوكيل", copy: "نسخ", copied: "تم النسخ", updating: "جارٍ التحديث…", presets: ["ماذا يقول هنا؟", "لخّص باختصار"] },
      es: { ask: "pregunta sobre la salida…", toAgent: "responder al agente", copy: "copiar", copied: "copiado", updating: "actualizando…", presets: ["¿qué dice aquí?", "resume brevemente"] },
      fr: { ask: "posez une question sur la sortie…", toAgent: "répondre à l'agent", copy: "copier", copied: "copié", updating: "mise à jour…", presets: ["qu'est-ce qui est écrit ici ?", "résume brièvement"] },
      ru: { ask: "спросите о выводе…", toAgent: "ответ агенту", copy: "копировать", copied: "скопировано", updating: "обновляется…", presets: ["что здесь написано?", "подытожь кратко"] },
      de: { ask: "frag zur ausgabe…", toAgent: "an den agenten antworten", copy: "kopieren", copied: "kopiert", updating: "wird aktualisiert…", presets: ["was steht hier?", "kurz zusammenfassen"] },
      zh: { ask: "询问输出内容…", toAgent: "回复给智能体", copy: "复制", copied: "已复制", updating: "更新中…", presets: ["这里写了什么？", "简短总结"] },
      pt: { ask: "pergunte sobre a saída…", toAgent: "responder ao agente", copy: "copiar", copied: "copiado", updating: "atualizando…", presets: ["o que diz aqui?", "resuma brevemente"] },
      it: { ask: "chiedi sull'output…", toAgent: "rispondi all'agente", copy: "copia", copied: "copiato", updating: "aggiornamento…", presets: ["cosa c'è scritto qui?", "riassumi in breve"] },
      ja: { ask: "出力について質問…", toAgent: "エージェントへの返信", copy: "コピー", copied: "コピーしました", updating: "更新中…", presets: ["ここには何が書いてある？", "簡潔に要約して"] },
      ko: { ask: "출력에 대해 질문하기…", toAgent: "에이전트에 답장", copy: "복사", copied: "복사됨", updating: "업데이트 중…", presets: ["여기 뭐라고 쓰여 있어?", "간단히 요약해줘"] },
      hi: { ask: "आउटपुट के बारे में पूछें…", toAgent: "एजेंट को जवाब", copy: "कॉपी", copied: "कॉपी हो गया", updating: "अपडेट हो रहा है…", presets: ["यहाँ क्या लिखा है?", "संक्षेप में सारांश दें"] },
      id: { ask: "tanya tentang keluaran…", toAgent: "balas ke agen", copy: "salin", copied: "tersalin", updating: "memperbarui…", presets: ["apa yang tertulis di sini?", "ringkas singkat"] },
      vi: { ask: "hỏi về kết quả…", toAgent: "trả lời tác nhân", copy: "sao chép", copied: "đã sao chép", updating: "đang cập nhật…", presets: ["ở đây viết gì?", "tóm tắt ngắn gọn"] },
      bn: { ask: "আউটপুট সম্পর্কে জিজ্ঞাসা করুন…", toAgent: "এজেন্টকে উত্তর", copy: "কপি", copied: "কপি হয়েছে", updating: "আপডেট হচ্ছে…", presets: ["এখানে কী লেখা আছে?", "সংক্ষেপে সারাংশ দাও"] },
    };
    function ui() { return UI_STRINGS[explainLang] || UI_STRINGS.zh; }

    // Claude auth is optional. The server reports only whether a supported
    // method is configured; the browser stores only the harmless setup path
    // the user picked. No credential value crosses this UI boundary.
    let currentAuth = { status: "missing", method: "none" };
    let authSetupForced = false;

    function storedAuthChoice() {
      try { return localStorage.getItem(AUTH_CHOICE_KEY); } catch { return null; }
    }

    function storeAuthChoice(value) {
      try {
        if (value) localStorage.setItem(AUTH_CHOICE_KEY, value);
        else localStorage.removeItem(AUTH_CHOICE_KEY);
      } catch {}
    }

    function showAuthInstructions(choice) {
      document.querySelectorAll("[data-auth-choice]").forEach((button) => {
        button.setAttribute("aria-pressed", button.dataset.authChoice === choice ? "true" : "false");
      });
      let visible = false;
      document.querySelectorAll("[data-auth-instructions]").forEach((panel) => {
        const selected = panel.dataset.authInstructions === choice;
        panel.hidden = !selected;
        if (selected) visible = true;
      });
      if (authInstructions) authInstructions.hidden = !visible;
      if (authCheckResult) authCheckResult.textContent = "";
    }

    function paintAuth(auth) {
      if (!auth || !["ready", "missing", "failed"].includes(auth.status)) return;
      currentAuth = auth;
      const storedChoice = storedAuthChoice();
      const readOnly = storedChoice === "read-only";

      if (auth.status === "ready") {
        storeAuthChoice(null);
        authSetupForced = false;
        if (authSetup) authSetup.hidden = true;
        if (authTrigger) {
          authTrigger.hidden = true;
          authTrigger.setAttribute("aria-expanded", "false");
        }
        showAuthInstructions(null);
        return;
      }

      if (authTrigger) {
        authTrigger.hidden = false;
        authTrigger.textContent = auth.status === "failed" ? "auth failed" : readOnly ? "read-only" : "connect claude";
      }

      const shouldShow = authSetupForced || !readOnly;
      if (authSetup) authSetup.hidden = !shouldShow;
      if (authTrigger) authTrigger.setAttribute("aria-expanded", shouldShow ? "true" : "false");
      if (!shouldShow) {
        showAuthInstructions(null);
        return;
      }

      if (auth.status === "failed") {
        if (authKicker) authKicker.textContent = "authentication failed";
        if (authTitle) authTitle.textContent = "reconnect Claude";
        if (authDescription) authDescription.textContent = "The configured method was rejected. Transcript tailing still works while you repair it or continue read-only.";
        const choice = auth.method === "api-key"
          ? "api-key"
          : auth.method === "bedrock" || auth.method === "vertex"
            ? "cloud"
            : "claude-code";
        showAuthInstructions(choice);
      } else {
        if (authKicker) authKicker.textContent = "first run";
        if (authTitle) authTitle.textContent = "enable chat and summaries";
        if (authDescription) authDescription.textContent = "Session tailing already works. Choose how Claude-backed discussion should authenticate, or keep using the read-only transcript view.";
        showAuthInstructions(["claude-code", "api-key", "cloud"].includes(storedChoice) ? storedChoice : null);
      }
    }

    function openAuthSetup() {
      authSetupForced = true;
      paintAuth(currentAuth);
      authSetup?.scrollIntoView({
        behavior: reduceMotionOn() ? "auto" : "smooth",
        block: "start",
      });
    }

    document.querySelectorAll("[data-auth-choice]").forEach((button) => {
      button.addEventListener("click", () => {
        const choice = button.dataset.authChoice;
        if (choice === "read-only") {
          storeAuthChoice("read-only");
          authSetupForced = false;
          paintAuth(currentAuth);
          renderDetail();
          return;
        }
        storeAuthChoice(choice);
        authSetupForced = true;
        paintAuth(currentAuth);
      });
    });

    if (authTrigger) {
      authTrigger.addEventListener("click", openAuthSetup);
    }

    if (authCheck) {
      authCheck.addEventListener("click", async () => {
        authCheck.disabled = true;
        if (authCheckResult) authCheckResult.textContent = "checking…";
        try {
          const res = await fetch("/api/auth/status");
          const body = await res.json();
          if (!res.ok || !body?.auth) throw new Error("status unavailable");
          paintAuth(body.auth);
          renderDetail();
          if (body.auth.status !== "ready" && authCheckResult) {
            authCheckResult.textContent = "not detected yet";
          }
        } catch (err) {
          if (authCheckResult) authCheckResult.textContent = "check failed";
          console.warn("[auth] status check failed", err);
        } finally {
          authCheck.disabled = false;
        }
      });
    }

    // per-session "turns in context" stepper bounds — mirror the server clamps.
    const CHAT_CTX_MIN = 1, CHAT_CTX_MAX = 10, CHAT_CTX_DEFAULT = 5;
    function clampCtxTurns(n) {
      const v = Math.floor(Number(n));
      if (!Number.isFinite(v)) return CHAT_CTX_DEFAULT;
      return Math.min(CHAT_CTX_MAX, Math.max(CHAT_CTX_MIN, v));
    }
    async function setChatContextTurns(sessionKey, turns) {
      try {
        const res = await fetch('/chat/context-turns', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionKey, turns }),
        });
        if (!res.ok) console.warn('[chat] context-turns set failed', res.status);
      } catch (err) {
        console.warn('[chat] context-turns set error', err);
      }
    }

    async function setSessionName(sessionKey, name) {
      try {
        const res = await fetch('/session/rename', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionKey, name }),
        });
        if (!res.ok) console.warn('[session] rename failed', res.status);
      } catch (err) {
        console.warn('[session] rename error', err);
      }
    }

    // reset a session's discussion to pristine — wipes the whole conversation and
    // the assistant's memory (as if untouched). used by the reset button in the
    // detail title row. the server drops the subprocess + broadcasts chat:cleared.
    async function resetChat(sessionKey) {
      if (!sessionKey) return;
      try {
        const res = await fetch('/chat/clear', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionKey }),
        });
        if (res.ok) {
          chatThreadByKey.delete(sessionKey);
          chatStatusByKey.delete(sessionKey);
          expandedThreads.delete(sessionKey);
          chatDrafts.delete(sessionKey);
          refresh();
        } else {
          console.warn('[chat] reset failed', res.status);
        }
      } catch (err) {
        console.warn('[chat] reset error', err);
      }
    }

    function paintLang() {
      if (langSelect && langSelect.value !== explainLang) langSelect.value = explainLang;
      paintAutoExplainControl();
    }
    async function pushLang(code) {
      try {
        const res = await fetch("/settings/language", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ language: code }),
        });
        if (!res.ok) console.warn("[lang] set failed", res.status);
      } catch (err) {
        console.warn("[lang] set error", err);
      }
    }

    function paintThemeControl() {
      const theme = window.SottochatTheme;
      if (!themeCycle || !theme?.systems?.length) return;
      const currentId = theme.current();
      const index = Math.max(0, theme.systems.findIndex((system) => system.id === currentId));
      const current = theme.systems[index];
      const next = theme.systems[(index + 1) % theme.systems.length];
      themeCycle.setAttribute("aria-label", `color system: ${current.label}. next: ${next.label}`);
      themeCycle.title = `${current.label}. click for ${next.label}`;
      themeCycle.querySelectorAll(".theme-dot").forEach((dot, dotIndex) => {
        dot.style.setProperty("--theme-dot", current.swatches[dotIndex] || current.swatches[0]);
      });
    }

    function paintAutoExplainControl() {
      if (!autoExplainTrigger) return;
      const action = ui().presets?.[0] || "what does this say?";
      const enabled = autoExplainThreshold > 0;
      const label = autoExplainThreshold >= 1000
        ? `${(autoExplainThreshold / 1000).toFixed(1).replace(/\.0$/, "")}k+`
        : enabled ? `${autoExplainThreshold}+` : "off";
      autoExplainTrigger.querySelector(".auto-threshold").textContent = label;
      autoExplainTrigger.setAttribute("aria-pressed", enabled ? "true" : "false");
      autoExplainTrigger.setAttribute(
        "aria-label",
        enabled
          ? `${action} automatically for agent replies of ${autoExplainThreshold} words or more`
          : `${action} automatically: off`,
      );
      autoExplainTrigger.title = enabled
        ? `${action} at ${autoExplainThreshold}+ words`
        : `${action}: manual only`;
      autoExplainMenu?.querySelectorAll("[data-auto-threshold]").forEach((option) => {
        option.setAttribute("aria-checked", Number(option.dataset.autoThreshold) === autoExplainThreshold ? "true" : "false");
      });
    }

    function fmtUsageTokens(value) {
      return fmtTokens(Number(value) || 0) || "0";
    }

    function paintUsageControl(next) {
      if (next && typeof next === "object") {
        usageState = {
          today: typeof next.today === "string" ? next.today : "",
          days: Array.isArray(next.days) ? next.days : [],
        };
      }
      const today = usageState.days.find((day) => day?.date === usageState.today) || {
        totalTokens: 0,
        chatTokens: 0,
        observerTokens: 0,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      };
      const totalLabel = fmtUsageTokens(today.totalTokens);
      if (usageButtonTotal) usageButtonTotal.textContent = totalLabel;
      if (usageTodayTotal) usageTodayTotal.textContent = `${totalLabel} tokens`;
      if (usageTodayDate) usageTodayDate.textContent = usageState.today || "today";
      if (usageBreakdown) {
        usageBreakdown.textContent = `chat ${fmtUsageTokens(today.chatTokens)} · summaries ${fmtUsageTokens(today.observerTokens)} · ${Number(today.requests) || 0} calls`;
      }
      if (usageTrigger) {
        usageTrigger.setAttribute("aria-label", `sottochat additional token usage today: ${Number(today.totalTokens) || 0}`);
        usageTrigger.title = `${totalLabel} additional tokens today`;
      }
      if (!usageHistory) return;
      if (!usageState.days.length) {
        usageHistory.innerHTML = '<p class="usage-empty">no usage recorded yet</p>';
        return;
      }
      usageHistory.innerHTML = usageState.days.map((day) => {
        const date = day.date === usageState.today ? "today" : day.date;
        return '<div class="usage-row">' +
          '<span class="usage-row-date">' + escapeHtml(date) + '</span>' +
          '<span class="usage-row-sources">chat ' + fmtUsageTokens(day.chatTokens) + ' · sum ' + fmtUsageTokens(day.observerTokens) + '</span>' +
          '<span class="usage-row-total">' + fmtUsageTokens(day.totalTokens) + '</span>' +
          '</div>';
      }).join("");
    }

    function setNavPopover(trigger, panel, open) {
      if (!trigger || !panel) return;
      trigger.setAttribute("aria-expanded", open ? "true" : "false");
      panel.hidden = !open;
    }

    function closeNavPopovers(except) {
      if (except !== autoExplainMenu) setNavPopover(autoExplainTrigger, autoExplainMenu, false);
      if (except !== usagePanel) setNavPopover(usageTrigger, usagePanel, false);
    }

    function toggleNavPopover(trigger, panel) {
      const willOpen = panel?.hidden !== false;
      closeNavPopovers(panel);
      setNavPopover(trigger, panel, willOpen);
    }

    if (themeCycle && window.SottochatTheme?.systems?.length) {
      paintThemeControl();
      themeCycle.addEventListener("click", () => {
        const theme = window.SottochatTheme;
        const index = Math.max(0, theme.systems.findIndex((system) => system.id === theme.current()));
        const next = theme.systems[(index + 1) % theme.systems.length];
        theme.apply(next.id, true);
      });
      window.addEventListener("sottochat:color-system", paintThemeControl);
    }

    if (autoExplainTrigger && autoExplainMenu) {
      paintAutoExplainControl();
      autoExplainTrigger.addEventListener("click", () => toggleNavPopover(autoExplainTrigger, autoExplainMenu));
      autoExplainMenu.querySelectorAll("[data-auto-threshold]").forEach((option) => {
        option.addEventListener("click", () => {
          autoExplainThreshold = readAutoExplainThreshold(option.dataset.autoThreshold);
          try { localStorage.setItem(AUTO_EXPLAIN_KEY, String(autoExplainThreshold)); } catch {}
          closeNavPopovers();
          paintAutoExplainControl();
          autoExplainTrigger.focus();
        });
      });
      autoExplainMenu.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        const options = Array.from(autoExplainMenu.querySelectorAll("[data-auto-threshold]"));
        const current = Math.max(0, options.indexOf(document.activeElement));
        const direction = event.key === "ArrowDown" ? 1 : -1;
        options[(current + direction + options.length) % options.length]?.focus();
        event.preventDefault();
      });
      window.addEventListener("storage", (event) => {
        if (event.key !== AUTO_EXPLAIN_KEY) return;
        autoExplainThreshold = readAutoExplainThreshold(event.newValue);
        paintAutoExplainControl();
      });
    }

    if (usageTrigger && usagePanel) {
      paintUsageControl();
      usageTrigger.addEventListener("click", () => toggleNavPopover(usageTrigger, usagePanel));
    }

    document.addEventListener("click", (event) => {
      const target = event.target;
      if (target instanceof Node && (autoExplainWrap?.contains(target) || usageWrap?.contains(target))) return;
      closeNavPopovers();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const autoWasOpen = autoExplainMenu?.hidden === false;
      const usageWasOpen = usagePanel?.hidden === false;
      closeNavPopovers();
      if (autoWasOpen) autoExplainTrigger?.focus();
      else if (usageWasOpen) usageTrigger?.focus();
    });

    if (langSelect) {
      langSelect.value = explainLang;
      langSelect.addEventListener("change", () => {
        explainLang = langSelect.value;
        localStorage.setItem(LANG_KEY, explainLang);
        pushLang(explainLang);
        paintAutoExplainControl();
        refresh(); // re-render placeholder / quick-replies in the new language
      });
      // only sync to the server when THIS browser has an explicit saved choice.
      // a fresh browser has no choice — it must adopt the server's language (via
      // the hello handler), not clobber it (and every other client) with "zh".
      if (localStorage.getItem(LANG_KEY)) pushLang(explainLang);
    }

    // gh-star: live star count for the pill's repo, read straight off its href
    // so this keeps working if the repo pointer ever moves again. best-effort —
    // a network hiccup or GitHub rate-limit just leaves the "—" placeholder.
    (async function () {
      const ghStarEl = document.getElementById("gh-star");
      const ghPillEl = document.querySelector('a.gh-pill[href*="github.com"]');
      if (!ghStarEl || !ghPillEl) return;
      const m = ghPillEl.href.match(/github\.com\/([^/]+\/[^/]+?)\/?$/);
      if (!m) return;
      try {
        const res = await fetch(`https://api.github.com/repos/${m[1]}`);
        if (!res.ok) return;
        const data = await res.json();
        if (typeof data.stargazers_count === "number") {
          ghStarEl.textContent = fmtCount(data.stargazers_count);
        }
      } catch (err) {
        console.warn("[gh-star] fetch error", err);
      }
    })();

    // sessions sidebar collapse — thin rail of session color-dots. state
    // persists in localStorage so a reload keeps the chosen width.
    const sidebarEl = document.querySelector(".sidebar");
    const sidebarToggle = document.getElementById("sidebar-toggle");
    const SIDEBAR_KEY = "cutCakeSidebarCollapsed";
    function paintSidebar(collapsed) {
      if (!sidebarEl || !sidebarToggle) return;
      sidebarEl.classList.toggle("collapsed", collapsed);
      sidebarToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      sidebarToggle.setAttribute("aria-label", collapsed ? "expand sessions" : "collapse sessions");
    }
    (function () {
      let collapsed = false;
      try { collapsed = localStorage.getItem(SIDEBAR_KEY) === "1"; } catch {}
      paintSidebar(collapsed);
    })();
    if (sidebarToggle) {
      sidebarToggle.addEventListener("click", () => {
        const collapsed = !sidebarEl.classList.contains("collapsed");
        try { localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0"); } catch {}
        paintSidebar(collapsed);
      });
    }

    // state thresholds
    const LIVE_MS = 30 * 1000;          // <30s = live
    const IDLE_MS = 5 * 60 * 1000;      // >5m = idle
    const AMBIENT_MS = 5 * 60 * 1000;   // all sessions idle this long → quiet collapse

    // assets
    const MASCOT_ACTIVE = "/assets/mascot-uni-2.svg";
    const MASCOT_IDLE = "/assets/mascot-uni-1.svg";

    // motion helpers — magicui-style ports.
    // blurFadeIn = the BlurFade pattern: opacity 0 + blur(8px) + small y offset → reveal.
    // blurFadeStagger = run blurFadeIn on a list of nodes with a small staggered delay.
    function reduceMotionOn() {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }
    function blurFadeIn(el, opts) {
      if (!el || typeof gsap === "undefined" || reduceMotionOn()) return;
      const o = opts || {};
      // ported from magicui blur-fade.tsx defaults: y: -offset (direction "down"),
      // blur 6px, ease easeOut, base delay 0.04. duration bumped above the 0.4s
      // source default to land closer to the slower feel we settled on.
      gsap.fromTo(el,
        { opacity: 0, filter: "blur(6px)", y: -6 },
        {
          opacity: 1,
          filter: "blur(0px)",
          y: 0,
          duration: o.duration || 0.7,
          delay: 0.04 + (o.delay || 0),
          ease: "power2.out",
          clearProps: "filter,y,opacity",
        }
      );
    }
    function blurFadeStagger(parent, selector, opts) {
      if (!parent) return;
      const o = opts || {};
      const step = o.step || 0.08;
      const start = o.start || 0;
      const els = parent.querySelectorAll(selector);
      els.forEach((el, i) => blurFadeIn(el, { delay: start + step * i, duration: o.duration }));
    }

    // per-session colour palette — each session hashes to one entry; the
    // resulting accent/plum/hover overrides --accent etc. on the card root
    // and on the detail pane while that session is open. all hues stay in the
    // dessert/patisserie register so the brand still reads.
    const SESSION_PALETTE = [
      // strawberry (default brand)
      { accent: "236, 72, 153",  hover: "219, 39, 119",  plum: "168, 85, 247" },
      // peach
      { accent: "249, 115, 22",  hover: "234, 88, 12",   plum: "236, 72, 153" },
      // mint
      { accent: "16, 185, 129",  hover: "5, 150, 105",   plum: "20, 184, 166" },
      // blueberry
      { accent: "59, 130, 246",  hover: "37, 99, 235",   plum: "129, 140, 248" },
      // lavender
      { accent: "168, 85, 247",  hover: "147, 51, 234",  plum: "236, 72, 153" },
      // honey
      { accent: "234, 179, 8",   hover: "202, 138, 4",   plum: "249, 115, 22" },
    ];
    function sessionColorIdx(sessionId) {
      const s = String(sessionId || "");
      let h = 5381;
      for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
      return h % SESSION_PALETTE.length;
    }
    function sessionColorVars(sessionId) {
      // Per-session hues are the defining behavior of Session Spectrum. Other
      // systems keep one operative accent so selection and action stay stable.
      if (document.documentElement.dataset.colorSystem !== "session-spectrum") return "";
      const c = SESSION_PALETTE[sessionColorIdx(sessionId)];
      return (
        "--accent: rgb(" + c.accent + ");" +
        "--accent-hover: rgb(" + c.hover + ");" +
        "--accent-soft: rgba(" + c.accent + ", 0.12);" +
        "--plum: rgb(" + c.plum + ");"
      );
    }
    window.addEventListener("sottochat:color-system", () => refresh());

    // state — one entry per discovered session, keyed by server-side key
    // ("<source>:<path>"). Each carries its own events/threads/lastEventTs.
    const sessionsByKey = new Map();
    const autoExplainSent = new Set();
    const autoExplainInFlight = new Set();

    // utils
    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
      }[c]));
    }
    function clip(s, n) {
      s = String(s || "");
      return s.length > n ? s.slice(0, n) + "…" : s;
    }
    function projectName(info) {
      if (!info) return "";
      // prefer the real cwd: its basename keeps the hyphens/underscores the
      // dash-encoded slug flattens away ("claude-meta" → "claude meta", not "meta").
      // single-word basenames widen to the parent dir; capped at 4 words.
      if (info.cwd && typeof info.cwd === "string") {
        const segs = info.cwd.split("/").filter(Boolean);
        if (segs.length) {
          let words = segs[segs.length - 1].split(/[-_\s]+/).filter(Boolean);
          if (words.length < 2 && segs.length > 1) {
            words = segs[segs.length - 2].split(/[-_\s]+/).filter(Boolean).concat(words);
          }
          if (words.length) return words.slice(0, 4).join(" ");
        }
      }
      if (!info.slug) return "";
      const parts = info.slug.replace(/^-+/, "").split("-");
      return parts[parts.length - 1] || info.slug;
    }
    function sessionName(infoOrSess) {
      if (!infoOrSess) return "—";
      // a user-set rename always wins.
      if (infoOrSess.customName) return infoOrSess.customName;
      // server attaches a `displayName` for chat-agent sessions: parses their
      // sandbox-hash slug back to the upstream session's project name and uses
      // "<project> · chat" so the inbox card reads as the parent's helper, not
      // an anonymous hash. fall through to the slug-derived name otherwise.
      if (infoOrSess.displayName) return infoOrSess.displayName;
      const info = infoOrSess.info ? infoOrSess.info : infoOrSess;
      return projectName(info) || "—";
    }
    function fmtElapsed(sess) {
      const ts = sess?.lastEventTs;
      if (!ts) return "—";
      const ms = Date.now() - ts;
      if (ms < 5000) return "now";
      const s = Math.floor(ms / 1000);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      if (h) return h + "h " + m + "m ago";
      if (m) return m + "m ago";
      return s + "s ago";
    }
    function keyForSnapshot(sess) {
      return sess.key || (sess.info ? (sess.info.source + ":" + sess.info.path) : "");
    }
    function sessionState(sess) {
      const ts = sess?.lastEventTs || 0;
      const age = Date.now() - ts;
      if (age < LIVE_MS) return "live";
      if (age < IDLE_MS) return "recent";
      return "idle";
    }

    function fmtAge(ms) {
      const s = Math.floor(ms / 1000);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      if (h) return h + "h " + m + "m";
      if (m) return m + "m";
      return s + "s";
    }
    function shortModel(m) {
      if (!m) return "";
      const stripped = String(m).replace(/^claude-/, "").replace(/-\d{8}$/, "");
      return stripped.replace(/-(\d+)-(\d+)$/, " $1.$2");
    }

    // derive turns from raw events (mirrors src/turns.ts)
    function deriveTurns(evs) {
      const turns = [];
      let cur = null;
      const close = () => { if (cur) { turns.push(cur); cur = null; } };
      for (const ev of evs) {
        if (ev.kind === "user_message") {
          close();
          cur = {
            id: ev.uuid,
            startTs: ev.ts,
            endTs: ev.ts,
            userText: ev.text || "",
            userChars: (ev.text || "").length,
            agentText: "",
            agentChars: 0,
            agentTokens: 0,
            toolUses: 0,
            linesAdded: 0,
            linesRemoved: 0,
          };
        } else if (cur) {
          cur.endTs = ev.ts;
          if (ev.kind === "assistant_text") {
            cur.agentText += (cur.agentText ? "\n\n" : "") + (ev.text || "");
            cur.agentChars += (ev.text || "").length;
            if (typeof ev.tokens === "number") cur.agentTokens += ev.tokens;
          } else if (ev.kind === "tool_use") {
            cur.toolUses += 1;
            if (typeof ev.linesAdded === "number") cur.linesAdded += ev.linesAdded;
            if (typeof ev.linesRemoved === "number") cur.linesRemoved += ev.linesRemoved;
          } else if (ev.kind === "stop") {
            close();
          }
        }
      }
      if (cur) turns.push(cur);
      return turns;
    }

    const WORD_SEGMENTER = typeof Intl.Segmenter === "function"
      ? new Intl.Segmenter(undefined, { granularity: "word" })
      : null;
    function wordCount(s) {
      const text = String(s || "").trim();
      if (!text) return 0;
      if (WORD_SEGMENTER) {
        let count = 0;
        for (const part of WORD_SEGMENTER.segment(text)) {
          if (part.isWordLike) count++;
        }
        return count;
      }
      return text.split(/\s+/).filter(Boolean).length;
    }
    function fmtCount(n) {
      if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
      return String(n);
    }
    function niceMax(v) {
      if (v <= 0) return 100;
      if (v <= 50) return 50;
      if (v <= 100) return 100;
      if (v <= 200) return 200;
      if (v <= 500) return 500;
      if (v <= 1000) return 1000;
      if (v <= 2000) return 2000;
      return Math.ceil(v / 500) * 500;
    }

    // chart icons — small inline svgs sitting in a tinted bubble in the card head
    const ICON_COMPLEXITY = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12 L5 8 L8 10 L11 5 L14 8"/></svg>';
    const ICON_CODE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4 L2 8 L5 12 M11 4 L14 8 L11 12 M9.5 3.5 L6.5 12.5"/></svg>';
    const ICON_AGENT = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5 a2 2 0 0 1 2 -2 h6 a2 2 0 0 1 2 2 v4 a2 2 0 0 1 -2 2 H7 l-3 2.5 V11 a2 2 0 0 1 -1 -2 z"/></svg>';
    // dripping-icing cap — shape lives in /assets/frosting-new.svg, applied here
    // only to bars taller than this threshold (% of yMax) so short bars don't get
    // crushed by their own frosting silhouette.
    const BAR_FROST_MIN_PCT = 25;

    // a single cake decoration perches somewhere in the detail pane on every
    // session-open. target is picked deterministically per session (so it
    // doesn't jump every 5s refresh) but varies between sessions. softly
    // animates in via gsap (drop + blur-fade + soft overshoot).
    function cakeHash(seed) {
      let h = 5381;
      const s = String(seed || "");
      for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
      return h;
    }
    // pool of perch surfaces. each entry: a query selector + the size of the
    // cake at that surface + the anchor class describing how to position it.
    // size adapts to the surface — 26px on a bar, 40px on a chart card.
    // three mascot variants, palette-unified so they read as the same cartoon
    // in different poses. perch picks one per session via hash, so different
    // sessions get different mascots while a given session stays consistent.
    const CAKE_PERCH_ICONS = [
      "/assets/mascot-uni-1.svg",
      "/assets/mascot-uni-2.svg",
      "/assets/mascot-uni-3.svg",
    ];
    const CAKE_PERCH_POOL = [
      // frosted bars (output / added) — same as before, smallest size.
      { selectorAll: "#detail-content .cx-bar.bar-output, #detail-content .cx-bar.bar-added",
        size: 26, anchor: "bar-top",
        valid: (el) => !!el.querySelector(".bar-frost") },
      // top-right corner of either chart card.
      { selectorAll: "#detail-content .chart-card",          size: 38, anchor: "card-top-right" },
      // floating off the session-head heading.
      { selectorAll: "#detail-content .session-head h2",     size: 30, anchor: "head-right" },
      // top-right of the chat-input panel.
      { selectorAll: "#detail-content .chat-input",          size: 36, anchor: "input-top-right" },
    ];
    // last placed perch, recorded so we can short-circuit refresh re-mounts
    // when the same session+target combo is still valid (avoids replay flicker).
    let lastCakePerchKey = null;
    // per-session salt mixed into the pick/tilt hashes — bumped each time the
    // mascot wanders to a fresh spot (after the user pesters it with too many
    // hovers in too short a window). icon hash deliberately omits the salt
    // so the same mascot character keeps showing up just in different perches.
    const perchWanderSalt = new Map();
    function placeCakePerch(sessionId, opts) {
      const animate = !!(opts && opts.animate);
      // chart/chat-input innerHTML is wiped every 5s refresh, taking the cake
      // with it. so this function gets called from renderDetail every tick and
      // re-mounts a fresh cake in the same deterministic spot. the `animate`
      // flag controls whether to play the entrance — only true on session-open.
      const prior = document.getElementById("cake-perch");
      if (prior) {
        if (animate && typeof gsap !== "undefined" && !reduceMotionOn()) {
          gsap.killTweensOf(prior);
          gsap.to(prior, {
            opacity: 0, scale: 0.55, y: -14, duration: 0.35, ease: "power2.in",
            onComplete: () => prior.remove(),
          });
        } else {
          prior.remove();
        }
      }
      if (!sessionId) { lastCakePerchKey = null; return; }
      // gather candidates across the pool — flatten matches into a single list.
      const candidates = [];
      for (const cfg of CAKE_PERCH_POOL) {
        const matches = document.querySelectorAll(cfg.selectorAll);
        for (const el of matches) {
          if (cfg.valid && !cfg.valid(el)) continue;
          // skip hidden / display:none elements (e.g. charts-band collapsed)
          if (el.offsetParent === null) continue;
          candidates.push({ el, size: cfg.size, anchor: cfg.anchor });
        }
      }
      if (!candidates.length) return;
      const salt = perchWanderSalt.get(sessionId) || 0;
      const pickH = cakeHash(sessionId + ":pick:" + salt);
      const tiltH = cakeHash(sessionId + ":tilt:" + salt);
      const pick = candidates[pickH % candidates.length];
      const tilt = (tiltH % 31) - 15; // -15..+15 deg
      // ensure the host is a positioned ancestor so absolute children anchor here.
      if (getComputedStyle(pick.el).position === "static") pick.el.style.position = "relative";
      // icon stays on its session-stable hash (no salt) — same mascot, just
      // jumping between perches when it wanders.
      const iconIdx = cakeHash(sessionId + ":icon") % CAKE_PERCH_ICONS.length;
      const iconSrc = CAKE_PERCH_ICONS[iconIdx];
      const cake = document.createElement("span");
      cake.id = "cake-perch";
      cake.className = "cake-perch " + pick.anchor;
      cake.style.cssText = "--cake-size: " + pick.size + "px; --cake-tilt: " + tilt + "deg;";
      cake.innerHTML = '<img src="' + iconSrc + '" alt="" draggable="false" />';
      pick.el.appendChild(cake);
      lastCakePerchKey = sessionId + "|" + pick.anchor;
      // mascot appears silently — no entrance animation, just shows up in place.
      // (the prior fade-out on session change still runs so the old cake clears
      // cleanly before the new one mounts.)
    }
    // explicit relocate: bumps the wander salt so placeCakePerch picks a fresh
    // anchor, then plays an entrance animation on the new perch (placeCakePerch
    // itself is silent on entry so refresh re-mounts don't flash). triggered by
    // the pestering-bait threshold below.
    function wanderPerch(sessionId) {
      if (!sessionId) return;
      perchWanderSalt.set(sessionId, (perchWanderSalt.get(sessionId) || 0) + 1);
      placeCakePerch(sessionId, { animate: true });
      const cake = document.getElementById("cake-perch");
      if (!cake || typeof gsap === "undefined" || reduceMotionOn()) return;
      // delay slightly so the prior cake's 0.35s fade has visibly started; then
      // drop the new one in with a soft overshoot.
      gsap.from(cake, {
        opacity: 0, scale: 0.4, y: -14,
        duration: 0.5, delay: 0.18,
        ease: "back.out(1.6)",
        clearProps: "transform,opacity",
      });
    }
    // pestering-bait counter: tracks recent hover timestamps over a 30s sliding
    // window. when count crosses a per-trigger threshold (rerolled to 2..5 each
    // time the bait fires) the perch wanders to a fresh anchor.
    const perchHoverTimes = [];
    let perchTeaseLimit = 2 + Math.floor(Math.random() * 4); // 2..5 inclusive
    function recordPerchHover() {
      const now = Date.now();
      perchHoverTimes.push(now);
      while (perchHoverTimes.length && now - perchHoverTimes[0] > 30_000) {
        perchHoverTimes.shift();
      }
      if (perchHoverTimes.length >= perchTeaseLimit) {
        perchHoverTimes.length = 0;
        perchTeaseLimit = 2 + Math.floor(Math.random() * 4);
        return true;
      }
      return false;
    }
    // as a css mask so editing the svg file updates every bar. the span itself
    // carries no markup; the bar's currentColor fills the masked shape.
    const BAR_FROST = '<span class="bar-frost" aria-hidden="true"></span>';
    // charts cap at the last N turns — keeps bars wide and the panel uncluttered.
    const CHART_TURNS = 5;

    // per-session expanded state for the full charts band. default collapsed —
    // the .mini-stats inline glance covers the always-on summary.
    const chartsBandExpanded = new Set();
    function applyChartsBandExpanded(sessionId) {
      const open = chartsBandExpanded.has(sessionId);
      dChartsBand.hidden = !open;
      dChartsToggle.setAttribute("aria-expanded", open ? "true" : "false");
      dChartsToggle.title = open ? "hide charts" : "show charts";
    }
    // entrance: bars grow up from the floor with a forward stagger; band
    // itself rises + scales unless the renderDetail blur-fade cascade is
    // already animating the chart-cards (the `opening` case). also clears any
    // inline styles a previously-killed collapse tween left behind.
    function animateExpandChartsBand(sessionId, opening) {
      if (typeof gsap === "undefined" || reduceMotionOn()) return;
      if (selectedSessionId() !== sessionId) return;
      if (!dChartsBand || dChartsBand.hidden) return;
      gsap.set(dChartsBand, { clearProps: "height,marginBottom,opacity,overflow,transform,filter" });
      const cards = dChartsBand.querySelectorAll(".chart-card");
      cards.forEach((c) => gsap.set(c, { clearProps: "transform,opacity,filter" }));
      const bars = dChartsBand.querySelectorAll(".cx-bar");
      if (!opening) {
        gsap.fromTo(dChartsBand,
          { opacity: 0, y: -10, scale: 0.97 },
          { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: "power2.out", clearProps: "transform,opacity" }
        );
      }
      if (bars.length) {
        gsap.set(bars, { transformOrigin: "50% 100%" });
        gsap.fromTo(bars,
          { scaleY: 0 },
          {
            scaleY: 1,
            duration: 0.6,
            ease: "back.out(1.4)",
            stagger: { each: 0.03, from: "start" },
            delay: opening ? 0.18 : 0.08,
            clearProps: "transform",
          }
        );
      }
    }
    // collapse: bars deflate end-to-start, chart-cards shrink + blur, then the
    // band's measured height + margin fold to zero, then a small toggle pulse
    // hands the user's eye to the place the charts now live. callers flip
    // `chartsBandExpanded` BEFORE calling so a re-click mid-animation can
    // reverse direction — the onComplete just calls applyChartsBandExpanded
    // which honors whatever the current intent is at that point.
    function animateCollapseChartsBand(sessionId) {
      if (!dChartsBand) return;
      if (selectedSessionId() !== sessionId) {
        applyChartsBandExpanded(sessionId);
        return;
      }
      if (dChartsBand.hidden) return; // already collapsed visually
      if (typeof gsap === "undefined" || reduceMotionOn()) {
        applyChartsBandExpanded(sessionId);
        placeCakePerch(sessionId, { animate: false });
        return;
      }
      const cards = Array.from(dChartsBand.querySelectorAll(".chart-card"));
      const bars = Array.from(dChartsBand.querySelectorAll(".cx-bar"));
      const startHeight = dChartsBand.offsetHeight;
      const startMargin = parseFloat(getComputedStyle(dChartsBand).marginBottom) || 0;
      const tl = gsap.timeline({
        onComplete: () => {
          gsap.set(dChartsBand, { clearProps: "height,marginBottom,opacity,overflow,transform,filter" });
          bars.forEach((b) => gsap.set(b, { clearProps: "transform" }));
          cards.forEach((c) => gsap.set(c, { clearProps: "transform,opacity,filter" }));
          applyChartsBandExpanded(sessionId);
          placeCakePerch(sessionId, { animate: false });
          if (dChartsToggle) {
            gsap.fromTo(dChartsToggle,
              { scale: 1 },
              { scale: 1.15, duration: 0.16, ease: "power2.out", yoyo: true, repeat: 1, clearProps: "transform" }
            );
          }
        },
      });
      // bars deflate end → start so the visual sweeps back toward the toggle.
      tl.to(bars, {
        scaleY: 0,
        transformOrigin: "50% 100%",
        duration: 0.42,
        ease: "power2.in",
        stagger: { each: 0.022, from: "end" },
      });
      // chart-cards shrink/blur in parallel with the tail of the bar deflate.
      tl.to(cards, {
        scale: 0.95,
        opacity: 0.25,
        filter: "blur(2px)",
        duration: 0.32,
        ease: "power2.in",
      }, "-=0.2");
      // freeze the band at its current pixel height so the height tween has a
      // concrete starting value, then fold height + margin + opacity to 0.
      tl.set(dChartsBand, { height: startHeight, marginBottom: startMargin, overflow: "hidden" });
      tl.to(dChartsBand, {
        height: 0,
        marginBottom: 0,
        opacity: 0,
        duration: 0.55,
        ease: "power3.inOut",
      });
    }
    function miniStatsHtmlForSession(sess) {
      const turns = deriveTurns(sess.events || []);
      if (turns.length === 0) return "";
      const last = turns[turns.length - 1];
      const recent = turns.slice(-CHART_TURNS);
      const outputMax = Math.max(20, ...recent.map(t => wordCount(t.agentText) + (t.toolUses || 0) * 30));
      const codeMax = Math.max(10, ...recent.map(t => Math.max(t.linesAdded || 0, t.linesRemoved || 0)));
      const outputW = wordCount(last.agentText);
      const outputVal = outputW + (last.toolUses || 0) * 30;
      const added = last.linesAdded || 0;
      const removed = last.linesRemoved || 0;
      const pct = (v, max) => Math.max(8, Math.min(100, Math.round((v / max) * 100)));
      const hasCode = added > 0 || removed > 0;
      const outTip = "agent: " + outputW + "w" + (last.toolUses ? " · " + last.toolUses + "t" : "");
      const codeTip = "+" + added + " / -" + removed + " lines";
      const bars =
        '<span class="mini-bar mb-output" style="height: ' + pct(outputVal, outputMax) + '%" title="' + escapeHtml(outTip) + '"></span>' +
        (hasCode
          ? '<span class="mini-sep"></span>' +
            '<span class="mini-bar mb-added" style="height: ' + pct(added, codeMax) + '%" title="' + escapeHtml(codeTip) + '"></span>' +
            '<span class="mini-bar mb-removed" style="height: ' + pct(removed, codeMax) + '%" title="' + escapeHtml(codeTip) + '"></span>'
          : "");
      return '<span class="mini-stats">' + bars + '</span>';
    }
    if (dChartsToggle) {
      dChartsToggle.addEventListener("click", () => {
        const sid = selectedSessionId();
        if (!sid) return;
        // kill any in-flight expand/collapse tweens so a re-click mid-animation
        // reverses direction cleanly.
        if (typeof gsap !== "undefined") {
          const bars = dChartsBand.querySelectorAll(".cx-bar");
          const cards = dChartsBand.querySelectorAll(".chart-card");
          gsap.killTweensOf([dChartsBand, ...bars, ...cards]);
        }
        // flip intent FIRST so a re-click during the animation sees the new
        // intent and inverts; then run the matching animation. close keeps
        // hidden=false through the animation; open sets hidden=false up front.
        if (chartsBandExpanded.has(sid)) {
          chartsBandExpanded.delete(sid);
          // mirror the closed state on the toggle's aria/title now even though
          // the band is still visible during the collapse tween.
          dChartsToggle.setAttribute("aria-expanded", "false");
          dChartsToggle.title = "show charts";
          animateCollapseChartsBand(sid);
        } else {
          chartsBandExpanded.add(sid);
          applyChartsBandExpanded(sid);
          animateExpandChartsBand(sid, false);
          placeCakePerch(sid, { animate: false });
        }
      });
    }

    function complexityChart(turns, count) {
      const last = count ? turns.slice(-count) : turns.slice();
      if (last.length === 0) return null;
      const data = last.map(t => {
        const inputW = wordCount(t.userText);
        const outputW = wordCount(t.agentText);
        return {
          input: inputW,
          output: outputW + t.toolUses * 30,
          outputWords: outputW,
          tools: t.toolUses,
          ts: t.endTs,
        };
      });
      const peak = Math.max(20, ...data.map(d => Math.max(d.input, d.output)));
      return { data, yMax: niceMax(peak) };
    }

    function renderChartHtml(turns, count) {
      const cx = complexityChart(turns, count);
      if (!cx) return "";
      const yMax = cx.yMax;
      const lastTs = cx.data[cx.data.length - 1].ts;
      const lastAgeMs = Date.now() - lastTs;
      const lastAgeLabel = lastAgeMs < 5000 ? "now" : fmtAge(lastAgeMs) + " ago";
      const pairs = cx.data.map((d, i) => {
        const isLast = i === cx.data.length - 1;
        const inputH = Math.max(0.5, (d.input / yMax) * 100);
        const outputH = Math.max(0.5, (d.output / yMax) * 100);
        const tip =
          "agent: " + d.outputWords + "w" +
          (d.tools ? " · " + d.tools + "t" : "") +
          " · you: " + d.input + "w";
        return (
          '<div class="cx-pair' + (isLast ? " latest" : "") + '" title="' + escapeHtml(tip) + '">' +
            '<div class="cx-bar bar-input" style="height: ' + inputH + '%">' + (inputH >= BAR_FROST_MIN_PCT ? BAR_FROST : '') + '</div>' +
            '<div class="cx-bar bar-output" style="height: ' + outputH + '%">' + (outputH >= BAR_FROST_MIN_PCT ? BAR_FROST : '') + '</div>' +
          '</div>'
        );
      }).join("");
      return (
        '<div class="chart-card">' +
          '<div class="chart-head">' +
            '<span class="chart-icon">' + ICON_COMPLEXITY + '</span>' +
            '<span class="chart-title">turn complexity (words)</span>' +
            '<span class="chart-legend">' +
              '<span class="legend-pill"><span class="dot dot-input"></span>you</span>' +
              '<span class="legend-pill"><span class="dot dot-output"></span>agent</span>' +
            '</span>' +
          '</div>' +
          '<div class="chart-body">' +
            '<div class="cx-yaxis">' +
              '<span class="tick top">' + fmtCount(yMax) + '</span>' +
              '<span class="tick mid">' + fmtCount(Math.round(yMax / 2)) + '</span>' +
              '<span class="tick bot">0</span>' +
            '</div>' +
            '<div class="cx-plot">' +
              '<div class="cx-grid top"></div>' +
              '<div class="cx-grid mid"></div>' +
              '<div class="cx-grid bot"></div>' +
              '<div class="cx-bars">' + pairs + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="chart-foot">' + escapeHtml(lastAgeLabel) + '</div>' +
        '</div>'
      );
    }

    function renderCodeChartHtml(turns, count) {
      const last = count ? turns.slice(-count) : turns.slice();
      if (last.length === 0) return "";
      const data = last.map(t => ({ added: t.linesAdded || 0, removed: t.linesRemoved || 0, ts: t.endTs }));
      if (data.every(d => d.added === 0 && d.removed === 0)) return "";
      const peak = Math.max(20, ...data.map(d => Math.max(d.added, d.removed)));
      const yMax = niceMax(peak);
      const lastTs = data[data.length - 1].ts;
      const lastAgeMs = Date.now() - lastTs;
      const lastAgeLabel = lastAgeMs < 5000 ? "now" : fmtAge(lastAgeMs) + " ago";
      const pairs = data.map((d, i) => {
        const isLast = i === data.length - 1;
        const addedH = Math.max(0.5, (d.added / yMax) * 100);
        const removedH = Math.max(0.5, (d.removed / yMax) * 100);
        const tip = "+" + d.added + " / -" + d.removed + " lines";
        return (
          '<div class="cx-pair' + (isLast ? " latest" : "") + '" title="' + escapeHtml(tip) + '">' +
            '<div class="cx-bar bar-added" style="height: ' + addedH + '%">' + (addedH >= BAR_FROST_MIN_PCT ? BAR_FROST : '') + '</div>' +
            '<div class="cx-bar bar-removed" style="height: ' + removedH + '%">' + (removedH >= BAR_FROST_MIN_PCT ? BAR_FROST : '') + '</div>' +
          '</div>'
        );
      }).join("");
      return (
        '<div class="chart-card code">' +
          '<div class="chart-head">' +
            '<span class="chart-icon">' + ICON_CODE + '</span>' +
            '<span class="chart-title">code changes (lines)</span>' +
            '<span class="chart-legend">' +
              '<span class="legend-pill"><span class="dot dot-added"></span>added</span>' +
              '<span class="legend-pill"><span class="dot dot-removed"></span>removed</span>' +
            '</span>' +
          '</div>' +
          '<div class="chart-body">' +
            '<div class="cx-yaxis">' +
              '<span class="tick top">' + fmtCount(yMax) + '</span>' +
              '<span class="tick mid">' + fmtCount(Math.round(yMax / 2)) + '</span>' +
              '<span class="tick bot">0</span>' +
            '</div>' +
            '<div class="cx-plot">' +
              '<div class="cx-grid top"></div>' +
              '<div class="cx-grid mid"></div>' +
              '<div class="cx-grid bot"></div>' +
              '<div class="cx-bars">' + pairs + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="chart-foot">' + escapeHtml(lastAgeLabel) + '</div>' +
        '</div>'
      );
    }

    // collapse same-slug lineage: a `/clear` in claude code mints a new
    // sessionId + new jsonl in the same project dir, leaving the old jsonl
    // dormant. without coalescing, the user sees two cards for what's
    // logically one continuing project — and accumulated dead siblings
    // (bun --hot orphaning subprocesses, short-lived var-folders shells)
    // pile up indefinitely. rule: within a (source, slug) group, the
    // freshest is always shown; non-freshest siblings show only while they
    // *themselves* are still active (lastEventTs within LINEAGE_FRESH_MS of
    // now). this hides /clear predecessors after ~LINEAGE_FRESH_MS and the
    // dead-on-arrival subprocesses too. parallel terminals on the same
    // project keep emitting events and stay visible.
    // pattern adapted from abtop's `find_live_session_id`
    // (vendor/abtop/src/collector/claude.rs:1029-1041), without the PID-FD
    // resolution since bun has no native libproc binding.
    const LINEAGE_FRESH_MS = 60 * 1000;

    // sessions whose cwd lives under our own sandbox dirs — these are the
    // sdk subprocesses the server itself spawns (chat-agent + observer, now
    // under ~/.sottochat/; older sessions remain on disk under the legacy
    // ~/.cut-the-cake / ~/.chunk-to-chat roots). they're real cc sessions from the tailer's POV,
    // but they aren't user-driven work — render them grouped under a divider
    // at the bottom of the inbox so the user-driven cards are never
    // interleaved with our own machinery.
    //
    // match the sandbox roots directly rather than enumerating each subprocess
    // role, so any current or future subprocess is caught. the leading '--'
    // is the tell of a hidden dir in cc's slug encoding: ~/.sottochat/…
    // encodes to '…--sottochat-…', whereas a real repo cloned as
    // 'sottochat' is single-dash ('…-sottochat') and stays user-driven.
    function isInternalSession(sess) {
      const slug = sess?.info?.slug || '';
      return slug.includes('--sottochat') || slug.includes('--cut-the-cake') || slug.includes('--chunk-to-chat');
    }

    // collapsed state for the "internal · sdk subprocesses" section — persisted
    // so it stays out of the way across reloads. absence of the key (first
    // visit) defaults to collapsed; only an explicit "0" expands it.
    const INTERNAL_COLLAPSED_KEY = "ctc-internal-collapsed";
    function isInternalCollapsed() {
      try {
        return localStorage.getItem(INTERNAL_COLLAPSED_KEY) !== "0";
      } catch { return true; }
    }
    function setInternalCollapsed(collapsed) {
      try { localStorage.setItem(INTERNAL_COLLAPSED_KEY, collapsed ? "1" : "0"); } catch {}
    }

    // stable display order: a session's slot is fixed by when it was FIRST seen
    // (newest-first-seen on top), so background activity never reshuffles the
    // list under the user. new sessions slide in at the top once, then stay put.
    const sessionOrderRank = new Map();
    let sessionOrderSeq = 1;
    function applyStableOrder(list) {
      const unranked = list.filter(s => !sessionOrderRank.has(s.key));
      // oldest-activity-first, so the most-recent unranked session gets the
      // highest rank and thus sorts to the top on first appearance.
      unranked.sort((a, b) => (a.lastEventTs || 0) - (b.lastEventTs || 0));
      for (const s of unranked) sessionOrderRank.set(s.key, sessionOrderSeq++);
      return list.slice().sort((a, b) =>
        (sessionOrderRank.get(b.key) || 0) - (sessionOrderRank.get(a.key) || 0));
    }

    function sortedSessions() {
      const all = Array.from(sessionsByKey.values())
        .sort((a, b) => (b.lastEventTs || 0) - (a.lastEventTs || 0));

      const freshestByLineage = new Map();
      for (const s of all) {
        const key = (s.info?.source || "") + "\u0000" + (s.info?.slug || "");
        const ts = s.lastEventTs || 0;
        const cur = freshestByLineage.get(key) || 0;
        if (ts > cur) freshestByLineage.set(key, ts);
      }

      const visible = all.filter(s => {
        const key = (s.info?.source || "") + "\u0000" + (s.info?.slug || "");
        const my = s.lastEventTs || 0;
        const fresh = freshestByLineage.get(key) || 0;
        // freshest in lineage → always show. non-freshest → only if *i*
        // had activity recently (parallel sessions / just-cleared edge cases).
        return my >= fresh || (Date.now() - my) < LINEAGE_FRESH_MS;
      });
      return applyStableOrder(visible);
    }

    function findSessionBySessionId(sessionId) {
      for (const s of sessionsByKey.values()) {
        if (s.info?.sessionId === sessionId) return s;
      }
      return null;
    }

    // compact token count, e.g. 142000 -> "142k", 1500 -> "1.5k", 950 -> "950".
    function fmtTokens(n) {
      n = Number(n) || 0;
      if (n <= 0) return "";
      if (n >= 1000000) {
        const m = n / 1000000;
        return (m >= 10 ? Math.round(m) : Math.round(m * 10) / 10) + "m";
      }
      if (n >= 1000) {
        const k = n / 1000;
        return (k >= 100 ? Math.round(k) : Math.round(k * 10) / 10) + "k";
      }
      return String(n);
    }

    // last two path segments of a working dir, e.g. "…/workspace/claude-meta".
    // the real cwd comes from the jsonl (info.cwd); never derive it from the slug.
    function shortCwd(cwd) {
      if (!cwd || typeof cwd !== "string") return "";
      const segs = cwd.split("/").filter(Boolean);
      if (segs.length <= 2) return "/" + segs.join("/");
      return "…/" + segs.slice(-2).join("/");
    }

    function buildCardInnerHtml(sess, opts) {
      const modelLabel = shortModel(sess.model);
      // a summary generated under a previous explain-language setting is stale
      // until the observer re-feeds it (see /settings/language on the server) —
      // show it dimmed with an "updating…" tag instead of pretending it's current.
      const stale = !!(sess.summary && sess.summaryLang && sess.summaryLang !== explainLang);
      const summaryHtml = sess.summary
        ? '<p class="card-insight' + (stale ? ' stale' : '') + '" dir="auto">' +
            escapeHtml(sess.summary) +
            (stale
              ? ' <span class="typing-dots card-insight-dots" aria-label="' + escapeHtml(ui().updating) + '"><span></span><span></span><span></span></span>'
              : '') +
          '</p>'
        : '';
      const state = sessionState(sess);
      const ts = sess?.lastEventTs || 0;
      const age = Date.now() - ts;
      const elapsedHtml = state === "live"
        ? '<span class="live-word">live</span>'
        : state === "idle"
          ? 'idle ' + fmtAge(age)
          : fmtAge(age) + ' ago';
      const cwdStr = shortCwd(sess?.info?.cwd);
      const cwdHtml = cwdStr ? '<span class="card-cwd">' + escapeHtml(cwdStr) + '</span>' : '';
      const sourceStr = opts.showSource ? (sess?.info?.source || 'claude-code') : '';
      const footParts = [sourceStr, cwdHtml, elapsedHtml].filter(Boolean);
      const footHtml = footParts.join(' <span class="sep">·</span> ');

      const miniStats = miniStatsHtmlForSession(sess);
      const tok = fmtTokens(sess.contextTokens);
      const tokHtml = tok ? '<span class="tok-tag" title="context tokens">' + tok + '</span>' : '';

      const isEditingThisCard = editingNameSurface === "card" && editingNameSessionId === sess?.info?.sessionId;
      const titleHtml = isEditingThisCard
        ? '<input class="name-edit-input" dir="auto" value="' + escapeHtml(editingNameDraft) + '" />'
        : '<h3 class="card-name">' + escapeHtml(sessionName(sess)) + '</h3>';

      let html =
        '<div class="card-head">' +
          titleHtml +
          '<div class="card-meta">' +
            miniStats +
            tokHtml +
            (modelLabel ? '<span class="model-tag">' + escapeHtml(modelLabel) + '</span>' : '') +
          '</div>' +
        '</div>' +
        summaryHtml +
        '<p class="card-foot">' + footHtml + '</p>';

      if (opts.selected) {
        const mascotSrc = state === "idle" ? MASCOT_IDLE : MASCOT_ACTIVE;
        html += '<img class="card-mascot" src="' + mascotSrc + '" alt="" draggable="false" />';
      }
      return html;
    }

    function applyCardClasses(card, sess, opts) {
      const state = sessionState(sess);
      card.classList.toggle("live", state === "live");
      card.classList.toggle("idle", state === "idle");
      card.classList.toggle("selected", !!opts.selected);
      card.classList.toggle("internal", isInternalSession(sess));
    }

    function cardSig(sess) {
      // signature of "did the meaningful content change?" — avoids flashing
      // on every minute-tick or selection change. covers new events, new
      // observer insights.
      return [
        sess.lastEventTs || 0,
        sess.summaryTs || 0,
        sess.summary || "",
        explainLang,
      ].join("\u0001");
    }

    function buildCard(sess, opts) {
      opts = opts || {};
      const card = document.createElement("a");
      card.className = "card";
      card.href = "#session/" + encodeURIComponent(sess.info.sessionId);
      card.dataset.sessionId = sess.info.sessionId;
      card.dataset.sig = cardSig(sess);
      card.style.cssText = sessionColorVars(sess.info.sessionId);
      card.title = sessionName(sess);
      card.innerHTML = buildCardInnerHtml(sess, opts);
      applyCardClasses(card, sess, opts);
      wireCardNameInput(card, sess);
      return card;
    }

    function updateCard(card, sess, opts) {
      const newSig = cardSig(sess);
      const changed = card.dataset.sig !== newSig;
      card.dataset.sig = newSig;
      card.innerHTML = buildCardInnerHtml(sess, opts);
      applyCardClasses(card, sess, opts);
      wireCardNameInput(card, sess);
      if (changed && !reduceMotion()) {
        // re-trigger the keyframe by removing + reflowing + re-adding the class
        card.classList.remove("is-updated");
        void card.offsetWidth;
        card.classList.add("is-updated");
      }
    }

    // ---- inline session-name editing (card title + detail header) ----
    // at most one edit in progress at a time, tracked by which surface
    // started it — the card and the detail header never both show an input
    // for the same session, even when both are visible at once.
    let editingNameSessionId = null;
    let editingNameSurface = null; // "card" | "detail"
    let editingNameDraft = "";

    function startNameEdit(sessionId, surface) {
      const sess = findSessionBySessionId(sessionId);
      if (!sess) return;
      editingNameSessionId = sessionId;
      editingNameSurface = surface;
      editingNameDraft = sessionName(sess);
      refresh();
    }

    function cancelNameEdit() {
      if (!editingNameSessionId) return;
      editingNameSessionId = null;
      editingNameSurface = null;
      editingNameDraft = "";
      refresh();
    }

    function commitNameEdit() {
      const sessionId = editingNameSessionId;
      if (!sessionId) return;
      const sess = findSessionBySessionId(sessionId);
      const name = editingNameDraft.trim();
      editingNameSessionId = null;
      editingNameSurface = null;
      editingNameDraft = "";
      if (!sess) { refresh(); return; }
      const sessionKey = keyForSnapshot(sess);
      if (name) sess.customName = name; else delete sess.customName; // optimistic; server echoes session:rename
      setSessionName(sessionKey, name);
      refresh();
    }

    // wires Enter/Escape/blur on a freshly-created edit <input> and keeps
    // editingNameDraft in sync with keystrokes, so a mid-edit refresh
    // (another session's tick, etc.) redraws the input with what's already
    // been typed instead of resetting it.
    function wireNameInput(input) {
      input.addEventListener("input", () => { editingNameDraft = input.value; });
      input.addEventListener("keydown", e => {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); commitNameEdit(); }
        else if (e.key === "Escape") { e.preventDefault(); cancelNameEdit(); }
      });
      input.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); });
      input.addEventListener("blur", () => { if (editingNameSessionId) commitNameEdit(); });
    }

    function focusNameInput(input) {
      input.focus();
      const pos = input.value.length;
      try { input.setSelectionRange(pos, pos); } catch {}
    }

    function wireCardNameInput(card, sess) {
      if (editingNameSurface !== "card" || editingNameSessionId !== sess?.info?.sessionId) return;
      const input = card.querySelector(".name-edit-input");
      if (!input) return;
      wireNameInput(input);
      focusNameInput(input);
    }

    // clicking a card's name enters edit mode instead of navigating — the
    // whole card is an <a>, so this must stop the click from bubbling to it.
    // delegated on the grid container since individual cards' innerHTML gets
    // replaced on every refresh.
    cardsEl.addEventListener("click", e => {
      const nameEl = e.target.closest(".card-name");
      if (!nameEl) return;
      const card = nameEl.closest(".card");
      const sessionId = card?.dataset.sessionId;
      if (!sessionId) return;
      e.preventDefault();
      e.stopPropagation();
      startNameEdit(sessionId, "card");
    });

    // detail header's #d-name is a stable element (only its content is
    // replaced, never itself) — a direct listener is enough, no delegation.
    dName.addEventListener("click", e => {
      if (e.target.closest(".name-edit-input")) return;
      const sessionId = selectedSessionId();
      if (!sessionId) return;
      startNameEdit(sessionId, "detail");
    });

    function selectedSessionId() {
      return decodeURIComponent((location.hash.match(/^#session\/(.+)$/) || [])[1] || "");
    }

    // ambient quiet
    let ambientWoken = false;
    function shouldQuiet(list, sel) {
      if (sel) return false;
      if (list.length === 0) return false;
      if (ambientWoken) return false;
      const now = Date.now();
      return list.every(s => (now - (s.lastEventTs || 0)) >= AMBIENT_MS);
    }
    document.addEventListener("mousemove", () => {
      if (!ambientWoken) {
        ambientWoken = true;
        renderInbox();
        clearTimeout(window.__ambientReArm);
        window.__ambientReArm = setTimeout(() => {
          ambientWoken = false;
          renderInbox();
        }, 30 * 1000);
      } else {
        clearTimeout(window.__ambientReArm);
        window.__ambientReArm = setTimeout(() => {
          ambientWoken = false;
          renderInbox();
        }, 30 * 1000);
      }
    }, { passive: true });

    // persistent map of sessionId → card element. lets renderInbox diff against
    // the live dom so existing cards stay put across 5s ticks (no re-mount, no
    // animation flicker). only newly-added or removed cards animate.
    const cardEls = new Map();
    const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function clearAllCards() {
      cardEls.clear();
      cardsEl.innerHTML = "";
    }

    function renderInbox() {
      const list = sortedSessions();
      const sel = selectedSessionId();

      if (list.length === 0) {
        clearAllCards();
        cardsEl.appendChild(inboxEmpty);
        inboxEmpty.hidden = false;
        ambientQuiet.hidden = true;
        return;
      }
      if (inboxEmpty.parentNode === cardsEl) inboxEmpty.remove();
      inboxEmpty.hidden = true;

      if (shouldQuiet(list, sel)) {
        clearAllCards();
        // list is now in stable (first-seen) order, so list[0] isn't necessarily
        // the most-recently-active — take the max activity across the list.
        const newestTs = list.reduce((m, s) => Math.max(m, s.lastEventTs || 0), 0);
        const age = Date.now() - newestTs;
        const n = list.length;
        ambientQuiet.textContent =
          "quiet — " + n + " agent" + (n === 1 ? "" : "s") +
          " running, last activity " + fmtAge(age) + " ago";
        ambientQuiet.hidden = false;
        return;
      }
      ambientQuiet.hidden = true;

      const sources = new Set(list.map(s => s?.info?.source || 'claude-code'));
      const showSource = sources.size > 1;

      // remove cards that are no longer in the list — fade + slide out
      const desiredIds = new Set(list.map(s => s.info.sessionId));
      for (const [id, el] of [...cardEls]) {
        if (!desiredIds.has(id)) {
          cardEls.delete(id);
          if (typeof gsap !== "undefined" && !reduceMotion()) {
            el.style.pointerEvents = "none";
            gsap.to(el, {
              opacity: 0,
              x: -24,
              height: 0,
              paddingTop: 0,
              paddingBottom: 0,
              marginTop: 0,
              marginBottom: 0,
              duration: 1.2,
              ease: "power2.in",
              onComplete: () => el.remove(),
            });
          } else {
            el.remove();
          }
        }
      }

      // FLIP snapshot: capture top of every persisting card BEFORE we mutate
      // the DOM, so we can animate them from their previous slot to the new
      // one when an insert/remove pushes them around. mirrors motion's `layout`
      // prop on AnimatedListItem (vendor/magicui/animated-list.tsx).
      const flipBefore = new Map();
      const canFlip = typeof gsap !== "undefined" && !reduceMotion();
      if (canFlip) {
        for (const [id, el] of cardEls) {
          flipBefore.set(id, el.getBoundingClientRect().top);
        }
      }

      // partition: user-driven cards on top, server-spawned sdk subprocesses
      // (observer + chat agents) below a divider. inside each group
      // the original lastEventTs sort is preserved.
      const realList = list.filter(s => !isInternalSession(s));
      const internalList = list.filter(s => isInternalSession(s));
      const orderedList = realList.concat(internalList);
      const internalCount = internalList.length;
      const internalCollapsed = isInternalCollapsed();
      cardsEl.classList.toggle("internal-collapsed", internalCollapsed);

      // upsert + reorder
      let anchor = null;        // last placed card; new cards insert after it
      let staggerIdx = 0;       // stagger this tick's new cards (e.g. on first hello)
      const SEPARATOR_ID = "__internal-separator__";
      let separatorEl = document.getElementById(SEPARATOR_ID);
      if (internalCount === 0 && separatorEl) {
        separatorEl.remove();
        separatorEl = null;
      }
      let separatorPlaced = false;
      for (let i = 0; i < orderedList.length; i++) {
        const sess = orderedList[i];
        const id = sess.info.sessionId;
        const opts = { showSource, selected: id === sel };
        let card = cardEls.get(id);
        let isNew = false;
        if (!card) {
          card = buildCard(sess, opts);
          cardEls.set(id, card);
          isNew = true;
        } else {
          updateCard(card, sess, opts);
        }

        // first internal card → drop in the separator just before it.
        if (!separatorPlaced && internalCount > 0 && i === realList.length) {
          if (!separatorEl) {
            separatorEl = document.createElement("div");
            separatorEl.id = SEPARATOR_ID;
            separatorEl.className = "inbox-separator";
            separatorEl.addEventListener("click", () => {
              setInternalCollapsed(!isInternalCollapsed());
              renderInbox();
            });
          }
          separatorEl.classList.toggle("expanded", !internalCollapsed);
          separatorEl.innerHTML =
            '<span class="inbox-separator-label">internal · sdk subprocesses (' +
            internalCount + ')</span>' +
            '<span class="inbox-separator-chevron">&#9656;</span>';
          const sepTarget = anchor ? anchor.nextSibling : cardsEl.firstChild;
          if (separatorEl !== sepTarget) cardsEl.insertBefore(separatorEl, sepTarget);
          anchor = separatorEl;
          separatorPlaced = true;
        }

        // place this card right after the previous one (or at the start)
        const target = anchor ? anchor.nextSibling : cardsEl.firstChild;
        if (card !== target) cardsEl.insertBefore(card, target);
        anchor = card;

        if (isNew && typeof gsap !== "undefined" && !reduceMotion()) {
          // spring-y enter, magicui AnimatedList flavour: scale up from 0.55,
          // small y-drop, opacity 0 → 1, with back.out for the soft overshoot.
          // transformOrigin pinned to top so the card grows down into its slot
          // (mirrors motion's `originY: 0` in vendor/magicui/animated-list.tsx)
          // instead of expanding from its center.
          gsap.from(card, {
            opacity: 0,
            y: -22,
            scale: 0.55,
            filter: "blur(6px)",
            transformOrigin: "50% 0%",
            duration: 1.4,
            ease: "back.out(1.3)",
            delay: staggerIdx * 0.07,
            clearProps: "transform,opacity,filter",
          });
          staggerIdx++;
        }
      }

      // FLIP playback: any card that was already in the DOM and has shifted
      // gets animated from its old top to the new one. new cards are skipped
      // (they have no `before` entry — their enter animation handles them).
      //
      // bug we hit: refresh runs every 5s, list reorders frequently. the old
      // version used gsap.from with overwrite: "auto" but no clearProps. when a
      // new FLIP fired mid-flight, the previous tween's residual translate3d()
      // stuck on the inline style — cards drifted out of layout, leaving gaps
      // and ghost overlaps. fix:
      //   1. killTweensOf on the y/transform channel before starting a new tween
      //      (overwrite:"auto" alone doesn't always catch transform tweens).
      //   2. clearProps:"transform" on completion so the inline style resets.
      if (canFlip && flipBefore.size) {
        for (const [id, el] of cardEls) {
          const before = flipBefore.get(id);
          if (before == null) continue;
          const after = el.getBoundingClientRect().top;
          const delta = before - after;
          if (Math.abs(delta) > 0.5) {
            gsap.killTweensOf(el, "y,transform");
            gsap.fromTo(
              el,
              { y: delta },
              {
                y: 0,
                duration: 0.55,
                ease: "power3.out",
                clearProps: "transform",
              }
            );
          }
        }
      }
    }

    // last-viewed tracking
    function lastViewedKey(sessionId) { return "viewed:" + sessionId; }
    function markViewed(sessionId) {
      try { localStorage.setItem(lastViewedKey(sessionId), String(Date.now())); } catch {}
    }
    function getLastViewed(sessionId) {
      try {
        const v = localStorage.getItem(lastViewedKey(sessionId));
        return v ? Number(v) : 0;
      } catch { return 0; }
    }

    let lastDetailSessionId = null;     // remembers what's currently open so we
                                        // only blur-fade when the open session changes
    function renderDetail() {
      const sessionId = selectedSessionId();
      if (!sessionId) {
        const wasOpen = lastDetailSessionId !== null;
        detailEmpty.hidden = false;
        detailContent.hidden = true;
        if (wasOpen) blurFadeIn(detailEmpty, { duration: 0.9 });
        lastDetailSessionId = null;
        return;
      }
      const sess = findSessionBySessionId(sessionId);
      if (!sess) {
        detailEmpty.hidden = false;
        detailContent.hidden = true;
        lastDetailSessionId = null;
        return;
      }
      const opening = sessionId !== lastDetailSessionId;
      lastDetailSessionId = sessionId;
      detailEmpty.hidden = true;
      detailContent.hidden = false;
      detailContent.style.cssText = sessionColorVars(sessionId);
      const events = sess.events || [];
      if (editingNameSurface === "detail" && editingNameSessionId === sessionId) {
        dName.innerHTML = '<input class="name-edit-input" dir="auto" value="' + escapeHtml(editingNameDraft) + '" />';
        wireNameInput(dName.querySelector(".name-edit-input"));
        focusNameInput(dName.querySelector(".name-edit-input"));
      } else {
        dName.textContent = sessionName(sess);
      }
      const sourceEl = document.getElementById("d-source");
      if (sourceEl) sourceEl.textContent = sess?.info?.source || "claude-code";
      const cwdEl = document.getElementById("d-cwd");
      if (cwdEl) {
        const cwd = sess?.info?.cwd || "";
        cwdEl.textContent = cwd;
        cwdEl.hidden = !cwd;
      }
      dElapsed.textContent = fmtElapsed(sess);
      const tokEl = document.getElementById("d-tokens");
      if (tokEl) {
        const t = fmtTokens(sess.contextTokens);
        tokEl.textContent = t ? " · " + t + " ctx" : "";
      }
      // always-visible reset button in the title row — clears the whole
      // discussion for the open session. rebind (property, not addEventListener)
      // each render so it targets the currently-open session without stacking.
      const resetBtn = document.getElementById("d-chat-reset");
      if (resetBtn) {
        const sk = sess.key || (sess.info ? sess.info.source + ":" + sess.info.path : "");
        resetBtn.onclick = () => resetChat(sk);
      }
      // history (N) — lists this session's archived discussions. hidden until
      // the first clear archives something.
      const historyBtn = document.getElementById("d-chat-history");
      if (historyBtn) {
        const sk = sess.key || (sess.info ? sess.info.source + ":" + sess.info.path : "");
        const archives = chatArchivesByKey.get(sk) || [];
        historyBtn.hidden = archives.length === 0;
        const label = historyBtn.querySelector(".history-label");
        if (label) label.textContent = "history (" + archives.length + ")";
        historyBtn.setAttribute("aria-expanded", archiveOpenPanels.has(sk) ? "true" : "false");
        historyBtn.onclick = () => {
          if (archiveOpenPanels.has(sk)) archiveOpenPanels.delete(sk);
          else archiveOpenPanels.add(sk);
          renderDetail();
        };
        if (!archives.length) archiveOpenPanels.delete(sk);
      }
      const turns = deriveTurns(events);

      dChart.innerHTML = turns.length >= 2 ? renderChartHtml(turns, CHART_TURNS) : "";
      dCodeChart.innerHTML = renderCodeChartHtml(turns, CHART_TURNS);

      const hasComplexity = !!dChart.innerHTML;
      const hasCode = !!dCodeChart.innerHTML;
      const hasCharts = hasComplexity || hasCode;
      // hide whichever slot is empty so the surviving chart can claim full width
      // via the .single-chart grid override.
      dChart.hidden = !hasComplexity;
      dCodeChart.hidden = !hasCode;
      dChartsBand.classList.toggle("single-chart", hasCharts && !(hasComplexity && hasCode));
      dChartsToggle.hidden = !hasCharts;
      if (!hasCharts) chartsBandExpanded.delete(sessionId);
      applyChartsBandExpanded(sessionId);

      const lastViewed = getLastViewed(sessionId);
      const untouchedMs = lastViewed ? (Date.now() - lastViewed) : 0;
      if (lastViewed && untouchedMs >= 5 * 60 * 1000) {
        dUntouched.hidden = false;
        dUntouchedMins.textContent = fmtAge(untouchedMs);
      } else {
        dUntouched.hidden = true;
      }

      renderConversation(sess, turns);
      renderChatArchives(sess);
      renderChatThread(sess);
      // hide the chat-input while we're waiting for the upstream agent to reply —
      // the conversation panel above already shows the typing indicator.
      const lastTurn = turns.length ? turns[turns.length - 1] : null;
      const waitingForAgent = !!(lastTurn && lastTurn.userText && !lastTurn.agentText);
      dChatInput.hidden = waitingForAgent;
      if (!waitingForAgent) renderChatInput(sess);

      // the cake perch is re-mounted every refresh tick (chart/chat-input
      // innerHTML wipes wreck DOM nodes inside them every 5s). animate only on
      // session-open — silent re-mount on refresh keeps the cake visually
      // pinned without replaying the entrance.
      placeCakePerch(sessionId, { animate: opening });

      // when the open session changes (or first opens), blur-fade the detail
      // pane in with a two-tier cascade — the region step is the spine, the
      // leaf step gives every component its own beat. magicui BlurFade flavour,
      // ported. crucial: pre-hide leaves synchronously inside this same frame
      // so detailContent unhiding doesn't flash a fully-visible state for one
      // tick before the stagger starts.
      if (opening && typeof gsap !== "undefined" && !reduceMotionOn()) {
        const REGION_STEP = 0.12;
        const LEAF_STEP = 0.04;
        const plan = [
          { sel: ".session-head",  pick: r => r.querySelectorAll("#d-name, .source") },
          { sel: ".charts-band",   pick: r => r.querySelectorAll("#d-chart, #d-code-chart") },
          { sel: ".conversation",  pick: r => r.children },
          { sel: ".chat-thread",   pick: r => r.children },
          { sel: ".chat-input",    pick: r => r.children },
        ];
        let regionIdx = 0;
        for (const { sel, pick } of plan) {
          const region = detailContent.querySelector(sel);
          if (!region || region.hidden) continue;
          const leaves = Array.from(pick(region));
          if (!leaves.length) continue;
          const base = REGION_STEP * regionIdx;
          gsap.set(leaves, { opacity: 0, filter: "blur(6px)", y: -6 });
          leaves.forEach((el, i) => {
            gsap.to(el, {
              opacity: 1,
              filter: "blur(0px)",
              y: 0,
              duration: 0.75,
              delay: base + LEAF_STEP * i,
              ease: "power2.out",
              clearProps: "filter,y,opacity",
            });
          });
          regionIdx++;
        }
      }
    }

    const chatDrafts = new Map();
    // chat thread state — sessionKey → array of {role, text, ts}.
    // populated by ws "chat:chunk" messages (the server echoes user sends and streams assistant replies).
    const chatThreadByKey = new Map();
    // sessionKeys whose chat-thread the user has explicitly expanded. default
    // is collapsed: only the last RECENT_VISIBLE chunks render, with a "show
    // N earlier" toggle. send (manual or quick-pill) resets to collapsed so a
    // fresh send always lands a clean view of "your last + the response".
    const RECENT_VISIBLE_CHUNKS = 2;
    const expandedThreads = new Set();
    const chatStatusByKey = new Map();
    // archived (cleared) discussions — sessionKey → [{archivedTs, chunks}].
    // fed by snapshots + ws "chat:archived"/"chat:restored". the history (N)
    // button in the title row toggles the panel; archiveOpenPanels tracks which
    // sessions have it open, archiveExpanded which entries are unfolded.
    const chatArchivesByKey = new Map();
    const archiveOpenPanels = new Set();
    const archiveExpanded = new Set();
    let convoLastSession = null;
    let convoLastTurnCount = 0;
    // remember which conv-bodies the user has expanded so 5s refresh doesn't snap them shut.
    // keyed (sessionId, role, turnId).
    const expandedBodies = new Set();

    function renderAgentBody(text) {
      // markdown for agent text — feels like inside a claude session.
      // marked is loaded via cdn; if it didn't load, fall back to plain pre-wrap.
      if (typeof marked !== "undefined") {
        const html = marked.parse(String(text || ""), { breaks: true, gfm: true });
        return '<div class="conv-md">' + html + '</div>';
      }
      return '<div class="conv-text">' + escapeHtml(text) + '</div>';
    }

    function renderConversation(sess, turns) {
      const sessionId = sess.info?.sessionId || "";
      const lastTurn = turns.length ? turns[turns.length - 1] : null;
      const hasUser = !!(lastTurn && lastTurn.userText);
      const hasAgent = !!(lastTurn && lastTurn.agentText);
      // waiting = user spoke this turn, agent hasn't replied yet. drives the
      // typing indicator + chat-input hide below.
      const waitingForAgent = hasUser && !hasAgent;

      const headTitle = waitingForAgent ? "waiting for agent…" : "latest exchange";
      const ageMs = lastTurn ? Date.now() - (lastTurn.endTs || lastTurn.startTs || 0) : 0;
      const ageLabel = !lastTurn ? "" : (ageMs < 5000 ? "just now" : fmtAge(ageMs) + " ago");

      const headHtml =
        '<div class="conv-head">' +
          '<span class="conv-head-icon">' + ICON_AGENT + '</span>' +
          '<span class="conv-head-title">' + escapeHtml(headTitle) + '</span>' +
          (ageLabel ? '<span class="conv-head-time">' + escapeHtml(ageLabel) + '</span>' : '') +
        '</div>';

      if (!lastTurn) {
        dConversation.innerHTML = headHtml + '<p class="conv-empty">no turns yet</p>';
        convoLastSession = sessionId;
        convoLastTurnCount = 0;
        return;
      }

      const parts = [headHtml, '<div class="conv-stream">'];
      if (hasAgent) {
        // closed turn — show only the agent reply (with blur/truncation tail).
        // the user's message belongs to the past; the surface here is the
        // agent's latest output, ready to be reacted to.
        const expandKey = sessionId + "::" + lastTurn.id + "::L";
        const expanded = expandedBodies.has(expandKey);
        const bodyCls = "conv-body" + (expanded ? " is-expanded" : "");
        const agentWords = wordCount(lastTurn.agentText);
        parts.push(
          '<div class="conv-msg from-agent">' +
            '<span class="conv-msg-meta">agent</span>' +
            '<div class="conv-bubble">' +
              '<div class="' + bodyCls + '" data-expand-key="' + escapeHtml(expandKey) + '" data-conv-idx="0">' +
                renderAgentBody(lastTurn.agentText) +
              '</div>' +
              '<button class="conv-toggle hidden" data-conv-idx="0">show full</button>' +
              '<span class="conv-word-count hidden" data-conv-idx="0">' + agentWords + ' words</span>' +
            '</div>' +
          '</div>'
        );
      } else if (waitingForAgent) {
        // user just sent something — show their message on the right and a
        // typing indicator standing in for the not-yet-arrived agent reply.
        parts.push(
          '<div class="conv-msg from-you">' +
            '<span class="conv-msg-meta">you</span>' +
            '<div class="conv-bubble">' + escapeHtml(lastTurn.userText) + '</div>' +
          '</div>' +
          '<div class="conv-msg from-agent">' +
            '<span class="conv-msg-meta">agent</span>' +
            '<div class="conv-bubble">' +
              '<span class="typing-dots" aria-label="agent is typing"><span></span><span></span><span></span></span>' +
            '</div>' +
          '</div>'
        );
      }
      parts.push('</div>');

      dConversation.innerHTML = parts.join("");

      // measure each conv-body — if the rendered content overflows the cap,
      // mark it as truncated (turns on the fade) and reveal the toggle.
      // if the user previously expanded this body, keep it expanded and skip the toggle.
      dConversation.querySelectorAll('.conv-body').forEach((body) => {
        const idx = body.dataset.convIdx;
        const toggle = dConversation.querySelector('.conv-toggle[data-conv-idx="' + idx + '"]');
        const words = dConversation.querySelector('.conv-word-count[data-conv-idx="' + idx + '"]');
        const expandKey = body.dataset.expandKey;
        // the fade lives on the bubble (parent) so it doesn't scroll away when we
        // pin the body to its tail.
        const bubble = body.closest('.conv-bubble');
        const alreadyExpanded = body.classList.contains('is-expanded');
        if (alreadyExpanded) {
          if (bubble) bubble.classList.remove('is-truncated');
          if (toggle) {
            toggle.classList.remove('hidden');
            toggle.textContent = 'show less';
            toggle.addEventListener('click', () => {
              body.classList.remove('is-expanded');
              if (bubble) bubble.classList.add('is-truncated');
              body.scrollTop = body.scrollHeight; // re-pin to the tail
              expandedBodies.delete(expandKey);
              toggle.textContent = 'show full';
            });
          }
          if (words) words.classList.remove('hidden');
          return;
        }
        const overflow = body.scrollHeight > body.clientHeight + 4;
        if (overflow) {
          if (bubble) bubble.classList.add('is-truncated');
          // show the END of the exchange (the conclusion / next step), not the
          // start — pin the clipped view to the bottom. re-applied every render.
          body.scrollTop = body.scrollHeight;
          if (toggle) {
            toggle.classList.remove('hidden');
            toggle.textContent = 'show full';
            toggle.addEventListener('click', () => {
              body.classList.add('is-expanded');
              if (bubble) bubble.classList.remove('is-truncated');
              expandedBodies.add(expandKey);
              toggle.textContent = 'show less';
            });
          }
          if (words) words.classList.remove('hidden');
        } else if (bubble) {
          bubble.classList.remove('is-truncated');
          if (words) words.classList.add('hidden');
        }
      });

      convoLastSession = sessionId;
      convoLastTurnCount = turns.length;
    }

    // hover-burst: when the cursor enters a frosted bar, fling a handful of
    // sprinkles out of its frosting cap. delegated via mouseover (mouseenter
    // doesn't bubble), throttled per bar via dataset timestamp so re-entries
    // don't stack. only bars that actually carry a .bar-frost cap participate
    // (short bars below BAR_FROST_MIN_PCT are skipped automatically).
    const BURST_COLORS = ["#ec4899", "#f9a8d4", "#a855f7", "#fbbf24", "#5dd0c2", "#7c8cf0"];
    function burstSprinkles(bar) {
      if (typeof gsap === "undefined" || reduceMotionOn()) return;
      // radial burst: each sprinkle picks a random angle on the full circle
      // and radiates outward, no fan/fountain. produces a round pop instead of
      // an upward spray. one-stage tween — no second-stage fall.
      // colour palette is dominated by the bar's own color (read from computed
      // style — same source as the frosting `currentColor`), then sprinkled with
      // accent contrast picks from BURST_COLORS for variety.
      const barColor = getComputedStyle(bar).color || "#ec4899";
      const count = 9;
      for (let i = 0; i < count; i++) {
        const s = document.createElement("span");
        s.className = Math.random() < 0.4 ? "sprinkle-burst round" : "sprinkle-burst";
        // ~60% bar-color, ~40% accent palette mix-in
        s.style.background = Math.random() < 0.6
          ? barColor
          : BURST_COLORS[Math.floor(Math.random() * BURST_COLORS.length)];
        // start from the rim — center of the bar's top edge.
        s.style.left = "50%";
        s.style.top = "-6px"; // matches the frosting cap rim
        s.style.opacity = "0";
        s.style.transform = "translate(-50%, 0) rotate(" + (Math.random() * 360) + "deg)";
        bar.appendChild(s);
        // angle distributed roughly uniformly on the full circle (small jitter
        // around the index slice so the ring doesn't look perfectly geometric).
        const slice = (Math.PI * 2) / count;
        const angle = slice * i + (Math.random() - 0.5) * slice * 0.7;
        const dist = 30 + Math.random() * 22;
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist;
        const rot = (Math.random() < 0.5 ? -1 : 1) * (180 + Math.random() * 220);
        const dur = 0.6 + Math.random() * 0.25;
        gsap.timeline({
          onComplete: () => s.remove(),
        })
          .to(s, { opacity: 1, duration: 0.08, ease: "power1.out" }, 0)
          .to(
            s,
            {
              x: dx,
              y: dy,
              rotation: "+=" + rot,
              duration: dur,
              ease: "power2.out",
            },
            0
          )
          .to(s, { opacity: 0, duration: 0.25, ease: "power1.in" }, "-=0.3");
      }
    }
    document.addEventListener("mouseover", (ev) => {
      const target = ev.target;
      if (!(target instanceof Element)) return;
      const bar = target.closest(".cx-bar");
      if (!bar) return;
      if (!bar.querySelector(".bar-frost")) return; // only frosted bars
      const last = parseInt(bar.dataset.burstTs || "0", 10);
      if (Date.now() - last < 800) return; // cooldown so re-entries don't stack
      bar.dataset.burstTs = String(Date.now());
      burstSprinkles(bar);
    });

    // brand mark hover: jump up + 360° roll + drop (port of cutcake's brandJumpRoll).
    // trigger on the brand area (logo + wordmark) so hovering either fires it.
    function brandJumpRoll() {
      if (typeof gsap === "undefined" || reduceMotionOn()) return;
      const mark = document.querySelector(".top-nav .nav-logo");
      const trigger = document.querySelector(".top-nav .nav-left");
      if (!mark || !trigger) return;
      let playing = false;
      trigger.addEventListener("mouseenter", () => {
        if (playing) return;
        playing = true;
        gsap.timeline({
          onComplete: () => {
            gsap.set(mark, { rotation: 0 });
            playing = false;
          },
        })
          .to(mark, { y: -16, duration: 0.28, ease: "expo.out" })
          .to(mark, { rotation: 360, duration: 0.55, ease: "power2.inOut" }, "<0.05")
          .to(mark, { y: 0, duration: 0.45, ease: "expo.out" }, "-=0.25");
      });
    }
    brandJumpRoll();

    // sidebar card mascot hover: jump + front-flip + bouncy landing. distinct
    // from the top-nav brand-jump-roll: rotates around X (front flip / coin
    // spin) instead of around Z (planar spin), pops a slight scale pulse, and
    // lands with back.out(2.4) for extra boing. delegated via mouseover so
    // newly-rendered cards (every 5s) get the listener for free.
    document.addEventListener("mouseover", (ev) => {
      if (typeof gsap === "undefined" || reduceMotionOn()) return;
      const t = ev.target;
      if (!(t instanceof Element)) return;
      const card = t.closest("#cards .card");
      if (!card) return;
      const mascot = card.querySelector(".card-mascot");
      if (!mascot) return; // only selected cards mount a mascot
      if (mascot.dataset.flipping === "1") return; // cooldown until current flip ends
      mascot.dataset.flipping = "1";
      gsap.timeline({
        onComplete: () => {
          gsap.set(mascot, { rotationY: 0, scale: 1, y: 0, opacity: 1 });
          mascot.dataset.flipping = "0";
        },
      })
        // jump + scale.
        .to(mascot, { y: -9, scale: 1.07, duration: 0.3, ease: "power2.out" })
        // opacity eases IN to 45% on its own track — gradual, not snapped.
        .to(mascot, { opacity: 0.45, duration: 0.4, ease: "power2.inOut" }, "<")
        // y-axis flip while opacity holds at 0.45.
        .to(mascot, { rotationY: 360, duration: 0.6, ease: "power2.inOut" }, "<0.05")
        // landing: drop + settle.
        .to(mascot, { y: 0, scale: 1, duration: 0.5, ease: "back.out(1.2)" }, "-=0.18")
        // opacity eases OUT back to 100% over the landing — also gradual.
        .to(mascot, { opacity: 1, duration: 0.5, ease: "power2.inOut" }, "<");
    });

    // wandering cake-perch hover: pool of 15 mild reactions, picked at random
    // each time so it doesn't feel scripted. all animate the inner <img> (the
    // outer span owns positional transforms set in CSS — animating it would
    // clobber the `translate(-50%) rotate(tilt)` chain). cleanup `gsap.set`
    // resets every prop any pool member touches so leftover state never leaks
    // between picks. delegated so the perch keeps the listener after every 5s
    // re-mount inside the detail pane.
    const PERCH_REACTIONS = [
      // 1. walk left → flip → walk right → flip back → small step home.
      function walkFlip(img) {
        return gsap.timeline()
          .to(img, { x: -10, duration: 0.45, ease: "sine.inOut" })
          .to(img, { y: -2, duration: 0.12, ease: "sine.inOut", yoyo: true, repeat: 3 }, "<")
          .to(img, { rotationY: 180, duration: 0.3, ease: "power2.inOut" })
          .to(img, { x: 10, duration: 0.6, ease: "sine.inOut" })
          .to(img, { y: -2, duration: 0.12, ease: "sine.inOut", yoyo: true, repeat: 4 }, "<")
          .to(img, { rotationY: 360, duration: 0.3, ease: "power2.inOut" })
          .to(img, { x: 0, duration: 0.32, ease: "sine.inOut" });
      },
      // 2. soft head-tilt nod — small z-axis sway.
      function nod(img) {
        return gsap.timeline()
          .to(img, { rotation: 8, duration: 0.22, ease: "sine.inOut" })
          .to(img, { rotation: -6, duration: 0.3, ease: "sine.inOut" })
          .to(img, { rotation: 4, duration: 0.25, ease: "sine.inOut" })
          .to(img, { rotation: 0, duration: 0.2, ease: "sine.inOut" });
      },
      // 3. tiny double-hop — two short bounces with a settle.
      function hop(img) {
        return gsap.timeline()
          .to(img, { y: -7, duration: 0.18, ease: "power2.out" })
          .to(img, { y: 0, duration: 0.22, ease: "back.out(2)" })
          .to(img, { y: -4, duration: 0.14, ease: "power2.out" }, "+=0.05")
          .to(img, { y: 0, duration: 0.2, ease: "back.out(2)" });
      },
      // 4. gentle breathe — scale up, then back down.
      function breathe(img) {
        return gsap.timeline()
          .to(img, { scale: 1.12, duration: 0.32, ease: "sine.inOut" })
          .to(img, { scale: 1, duration: 0.5, ease: "sine.out" });
      },
      // 5. peek — sidestep right, look back (flip), and slide home.
      function peek(img) {
        return gsap.timeline()
          .to(img, { x: 8, duration: 0.3, ease: "sine.inOut" })
          .to(img, { rotationY: 180, duration: 0.28, ease: "power2.inOut" })
          .to(img, { y: -2, duration: 0.18, ease: "sine.inOut", yoyo: true, repeat: 1 })
          .to(img, { rotationY: 360, duration: 0.28, ease: "power2.inOut" })
          .to(img, { x: 0, duration: 0.3, ease: "sine.inOut" });
      },
      // 6. wiggle — quick tail-wag rotation, decaying amplitude.
      function wiggle(img) {
        return gsap.timeline()
          .to(img, { rotation: -6, duration: 0.1, ease: "sine.inOut" })
          .to(img, { rotation: 6, duration: 0.12, ease: "sine.inOut" })
          .to(img, { rotation: -4, duration: 0.12, ease: "sine.inOut" })
          .to(img, { rotation: 3, duration: 0.12, ease: "sine.inOut" })
          .to(img, { rotation: 0, duration: 0.16, ease: "sine.out" });
      },
      // 7. spin — slow gentle full z-axis rotation, no translate.
      function spin(img) {
        return gsap.timeline()
          .to(img, { rotation: 360, duration: 0.9, ease: "power2.inOut" });
      },
      // 8. squish — squash-and-stretch on the x/y scale axes.
      function squish(img) {
        return gsap.timeline()
          .to(img, { scaleX: 1.18, scaleY: 0.85, duration: 0.18, ease: "power2.out" })
          .to(img, { scaleX: 0.9, scaleY: 1.12, duration: 0.22, ease: "power2.inOut" })
          .to(img, { scaleX: 1, scaleY: 1, duration: 0.3, ease: "back.out(1.6)" });
      },
      // 9. lean — tilt and hold briefly, settle with overshoot.
      function lean(img) {
        return gsap.timeline()
          .to(img, { rotation: -15, duration: 0.32, ease: "power2.out" })
          .to(img, { rotation: 0, duration: 0.55, ease: "back.out(1.4)" }, "+=0.1");
      },
      // 10. shy — fade to half, scale down, then back up.
      function shy(img) {
        return gsap.timeline()
          .to(img, { opacity: 0.55, scale: 0.85, duration: 0.3, ease: "sine.inOut" })
          .to(img, { opacity: 1, scale: 1, duration: 0.5, ease: "sine.out" }, "+=0.1");
      },
      // 11. bobble — small circular path through four cardinal nudges.
      function bobble(img) {
        return gsap.timeline()
          .to(img, { x: -4, y: -3, duration: 0.16, ease: "sine.inOut" })
          .to(img, { x: 0,  y: -6, duration: 0.16, ease: "sine.inOut" })
          .to(img, { x: 4,  y: -3, duration: 0.16, ease: "sine.inOut" })
          .to(img, { x: 0,  y: 0,  duration: 0.18, ease: "sine.inOut" });
      },
      // 12. doubleFlip — two quick y-axis flips in place. on-complete reset
      //     handles the visual snap from 720° back to 0°.
      function doubleFlip(img) {
        return gsap.timeline()
          .to(img, { rotationY: 360, duration: 0.42, ease: "power2.inOut" })
          .to(img, { rotationY: 720, duration: 0.42, ease: "power2.inOut" });
      },
      // 13. shimmy — fast small horizontal jitter, decaying.
      function shimmy(img) {
        return gsap.timeline()
          .to(img, { x: -3, duration: 0.08, ease: "sine.inOut" })
          .to(img, { x: 3,  duration: 0.1,  ease: "sine.inOut" })
          .to(img, { x: -2, duration: 0.1,  ease: "sine.inOut" })
          .to(img, { x: 2,  duration: 0.1,  ease: "sine.inOut" })
          .to(img, { x: 0,  duration: 0.14, ease: "sine.out" });
      },
      // 14. stretch — pull tall briefly, then settle.
      function stretch(img) {
        return gsap.timeline()
          .to(img, { scaleY: 1.2,  scaleX: 0.95, duration: 0.32, ease: "sine.out" })
          .to(img, { scaleY: 1,    scaleX: 1,    duration: 0.45, ease: "back.out(1.4)" });
      },
      // 15. bow — tilt forward + slight scale-down (a small curtsy), straighten.
      function bow(img) {
        return gsap.timeline()
          .to(img, { rotation: 14, scale: 0.92, duration: 0.3, ease: "sine.out" })
          .to(img, { rotation: 0,  scale: 1,    duration: 0.45, ease: "back.out(1.6)" }, "+=0.1");
      },
    ];

    // over-the-top specials. picked with ~5% probability instead of the regular
    // pool — purely for delight, never gating any UX. side effects (sparkles,
    // confetti, ring) are fixed-position spans appended to body so they can
    // cover the whole viewport without being clipped by perch ancestors. each
    // returns a timeline tied to the mascot itself so the standard onComplete
    // cleanup still fires once the mascot animation settles.
    const SPARKLE_COLORS = [
      "#ec4899", "#f9a8d4", "#a855f7", "#fbbf24",
      "#5dd0c2", "#7c8cf0", "#fb923c", "#34d399",
    ];
    function spawnFlyer(originX, originY, opts) {
      const s = document.createElement("span");
      s.className = "sprinkle-burst" + (opts.round ? " round" : "");
      s.style.position = "fixed";
      s.style.left = originX + "px";
      s.style.top = originY + "px";
      s.style.background = opts.color;
      s.style.opacity = "0";
      s.style.zIndex = "1000";
      s.style.pointerEvents = "none";
      document.body.appendChild(s);
      gsap.set(s, { xPercent: -50, yPercent: -50, rotation: Math.random() * 360 });
      gsap.timeline({ onComplete: () => s.remove() })
        .to(s, { opacity: 1, duration: 0.1 }, 0)
        .to(s, {
          x: opts.dx, y: opts.dy,
          rotation: "+=" + opts.rot,
          duration: opts.dur,
          ease: opts.ease || "power2.out",
        }, 0)
        .to(s, { opacity: 0, duration: 0.35, ease: "power1.in" }, opts.dur - 0.35);
    }
    const PERCH_SPECIALS = [
      // A. fullscreen sparkle explosion radiating from the perch.
      function sparkleExplosion(img, perch) {
        const r = perch.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const count = 36;
        for (let i = 0; i < count; i++) {
          const angle = (Math.PI * 2 / count) * i + (Math.random() - 0.5) * 0.4;
          const dist = 220 + Math.random() * 380;
          spawnFlyer(cx, cy, {
            round: Math.random() < 0.4,
            color: SPARKLE_COLORS[Math.floor(Math.random() * SPARKLE_COLORS.length)],
            dx: Math.cos(angle) * dist,
            dy: Math.sin(angle) * dist,
            rot: (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 540),
            dur: 0.85 + Math.random() * 0.5,
          });
        }
        return gsap.timeline()
          .to(img, { y: -22, scale: 1.45, duration: 0.32, ease: "back.out(2)" })
          .to(img, { rotation: 720, duration: 0.7, ease: "power2.inOut" }, "<")
          .to(img, { y: 0, scale: 1, duration: 0.5, ease: "back.out(1.6)" }, "-=0.2");
      },
      // B. confetti rain — pieces fall from the top of the viewport, mascot
      //    does a celebratory hop with a small head-shake.
      function confettiRain(img, perch) {
        const w = window.innerWidth;
        const h = window.innerHeight;
        const count = 42;
        for (let i = 0; i < count; i++) {
          const startX = Math.random() * w;
          spawnFlyer(startX, -20, {
            round: Math.random() < 0.5,
            color: SPARKLE_COLORS[Math.floor(Math.random() * SPARKLE_COLORS.length)],
            dx: (Math.random() - 0.5) * 220,
            dy: h + 60,
            rot: (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 720),
            dur: 1.4 + Math.random() * 0.9,
            ease: "power1.in",
          });
        }
        return gsap.timeline()
          .to(img, { y: -16, scale: 1.2, duration: 0.28, ease: "power2.out" })
          .to(img, { rotation: -10, duration: 0.16, ease: "sine.inOut", yoyo: true, repeat: 3 }, "<")
          .to(img, { y: 0, scale: 1, rotation: 0, duration: 0.5, ease: "back.out(1.6)" });
      },
      // C. disco spin — three full z-rotations, scale pop, hue-rotate filter
      //    sweeps through the rainbow then unwinds. proxy-tween drives the
      //    filter since gsap doesn't natively interpolate hue-rotate strings.
      function discoSpin(img) {
        const proxy = { hue: 0 };
        const tl = gsap.timeline({
          onComplete: () => { img.style.filter = ""; },
        });
        tl.to(img, { scale: 1.3, y: -10, duration: 0.22, ease: "power2.out" })
          .to(img, { rotation: 1080, duration: 1.0, ease: "power2.inOut" }, "<")
          .to(proxy, {
            hue: 720, duration: 1.0,
            onUpdate: () => {
              img.style.filter = "hue-rotate(" + proxy.hue + "deg) saturate(1.4)";
            },
          }, "<")
          .to(img, { scale: 1, y: 0, duration: 0.4, ease: "back.out(1.6)" });
        return tl;
      },
      // D. comic burst — POW-style scale spike, brief shake, plus an expanding
      //    accent ring that emanates from the perch's screen position.
      function comicBurst(img, perch) {
        const r = perch.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const ring = document.createElement("span");
        ring.style.position = "fixed";
        ring.style.left = cx + "px";
        ring.style.top = cy + "px";
        ring.style.width = "30px";
        ring.style.height = "30px";
        ring.style.border = "3px solid var(--accent, #ec4899)";
        ring.style.borderRadius = "50%";
        ring.style.pointerEvents = "none";
        ring.style.zIndex = "999";
        document.body.appendChild(ring);
        gsap.set(ring, { xPercent: -50, yPercent: -50, scale: 1, opacity: 0.9 });
        gsap.to(ring, {
          scale: 9, opacity: 0,
          duration: 0.6, ease: "power2.out",
          onComplete: () => ring.remove(),
        });
        return gsap.timeline()
          .to(img, { scale: 2.2, duration: 0.18, ease: "back.out(2.5)" })
          .to(img, { rotation: -8, duration: 0.05 })
          .to(img, { rotation: 8,  duration: 0.05 })
          .to(img, { rotation: -5, duration: 0.05 })
          .to(img, { rotation: 3,  duration: 0.05 })
          .to(img, { rotation: 0, scale: 1, duration: 0.42, ease: "back.out(1.8)" });
      },
    ];

    function resetPerchImg(img) {
      gsap.set(img, {
        rotationY: 0, rotation: 0,
        x: 0, y: 0,
        scale: 1, scaleX: 1, scaleY: 1,
        opacity: 1,
      });
    }

    document.addEventListener("mouseover", (ev) => {
      if (typeof gsap === "undefined" || reduceMotionOn()) return;
      const t = ev.target;
      if (!(t instanceof Element)) return;
      const perch = t.closest("#cake-perch");
      if (!perch) return;
      const img = perch.querySelector("img");
      if (!img) return;
      if (perch.dataset.spinning === "1") return;

      // 1/20 lottery: over-the-top reaction. plays in place; doesn't count
      // against the wander threshold (specials are the reward, not the bait).
      if (Math.random() < 1 / 20) {
        perch.dataset.spinning = "1";
        const special = PERCH_SPECIALS[Math.floor(Math.random() * PERCH_SPECIALS.length)];
        const tl = special(img, perch);
        tl.eventCallback("onComplete", () => {
          resetPerchImg(img);
          perch.dataset.spinning = "0";
        });
        return;
      }

      // pestering bait: 2-5 hovers (rerolled each trigger) inside a 10s window
      // and the mascot relocates to a fresh anchor instead of reacting in place.
      if (recordPerchHover()) {
        const sid = selectedSessionId();
        if (sid) {
          wanderPerch(sid);
          return;
        }
      }

      // regular reaction pool.
      perch.dataset.spinning = "1";
      const pick = PERCH_REACTIONS[Math.floor(Math.random() * PERCH_REACTIONS.length)];
      const tl = pick(img);
      tl.eventCallback("onComplete", () => {
        resetPerchImg(img);
        perch.dataset.spinning = "0";
      });
    });

    function renderChatInput(sess) {
      const sessionKey = sess.key || (sess.info ? sess.info.source + ":" + sess.info.path : "");
      if (currentAuth.status !== "ready") {
        const failed = currentAuth.status === "failed";
        const readOnly = storedAuthChoice() === "read-only";
        const copy = failed
          ? "Claude authentication failed. Transcript viewing still works."
          : readOnly
            ? "read-only mode. Connect Claude when you want to discuss this session."
            : "Connect Claude to discuss this session. Transcript viewing already works.";
        dChatInput.innerHTML =
          '<div class="chat-auth-disabled" role="status">' +
            '<span>' + copy + '</span>' +
            '<button class="chat-auth-action" type="button">' + (failed ? "repair auth" : "connect claude") + '</button>' +
          '</div>';
        dChatInput.querySelector(".chat-auth-action")?.addEventListener("click", openAuthSetup);
        return;
      }
      // the ask box starts empty (or restores the user's in-progress draft) —
      // you ask about the latest output in your own language; no prefill.
      const initial = chatDrafts.has(sessionKey) ? chatDrafts.get(sessionKey) : "";

      // a background refresh() (observer/live-session events firing over the
      // websocket, etc.) rebuilds this whole pane on a cadence the user can't
      // control. if they're mid-keystroke in the textarea below, blowing away
      // dChatInput.innerHTML destroys that DOM node and steals focus/caret out
      // from under them. capture the in-flight focus + selection here, before
      // the rebuild, so we can restore it once the new textarea exists.
      const prevTa = dChatInput.querySelector('textarea');
      const hadFocus = !!prevTa && document.activeElement === prevTa;
      const prevSelStart = hadFocus ? prevTa.selectionStart : null;
      const prevSelEnd = hadFocus ? prevTa.selectionEnd : null;

      // localized preset chips (always shown) + a per-session stepper for how
      // many recent turns seed the assistant. clicking a chip sends its text
      // through the same /chat/send path; the stepper tunes buildChatSeed depth.
      const presetChips = (ui().presets || [])
        .map(p => '<button type="button" class="quick-pill" dir="auto" data-quick="' + escapeHtml(p) + '">' + escapeHtml(p) + '</button>')
        .join('');
      const ctxTurns = clampCtxTurns(sess.chatContextTurns);
      const stepperHtml =
        '<div class="ctx-turns" title="how many recent turns the assistant sees">' +
          '<span class="ctx-turns-lbl">ctx</span>' +
          '<button type="button" class="ctx-turns-btn" data-step="-1" aria-label="fewer turns"' + (ctxTurns <= CHAT_CTX_MIN ? ' disabled' : '') + '>−</button>' +
          '<span class="ctx-turns-val">' + ctxTurns + '</span>' +
          '<button type="button" class="ctx-turns-btn" data-step="1" aria-label="more turns"' + (ctxTurns >= CHAT_CTX_MAX ? ' disabled' : '') + '>+</button>' +
        '</div>';
      const quickHtml =
        '<div class="chat-quickreplies">' +
          '<div class="qr-presets">' + presetChips + '</div>' +
          stepperHtml +
        '</div>';

      dChatInput.innerHTML =
        quickHtml +
        '<div class="chat-input-row">' +
          '<textarea rows="2" dir="auto" placeholder="' + escapeHtml(ui().ask) + '">' + escapeHtml(initial) + '</textarea>' +
          '<button class="send-btn" title="send" aria-label="send">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<line x1="12" y1="19" x2="12" y2="5"/>' +
              '<polyline points="5 12 12 5 19 12"/>' +
            '</svg>' +
          '</button>' +
        '</div>';

      const ta = dChatInput.querySelector('textarea');
      const btn = dChatInput.querySelector('.send-btn');
      const pills = Array.from(dChatInput.querySelectorAll('.quick-pill'));

      // restore focus/caret onto the freshly-built textarea so a background
      // rebuild is invisible to whoever was mid-sentence. the draft text
      // itself already round-trips via chatDrafts → `initial` above; this
      // just keeps the cursor from jumping away.
      if (hadFocus && ta) {
        ta.focus();
        try { ta.setSelectionRange(prevSelStart, prevSelEnd); } catch {}
      }

      // shared send path. caller passes the text directly; for the textarea
      // path, we read .value here. caller can also pass a control to disable
      // while the request is in flight (avoids double-click).
      async function sendChatText(text, ctrl) {
        const trimmed = (text || "").trim();
        if (!trimmed) return;
        if (ctrl) ctrl.disabled = true;
        pills.forEach(p => { p.disabled = true; });
        try {
          const res = await fetch('/chat/send', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionKey, text: trimmed }),
          });
          if (!res.ok) {
            const body = await res.text();
            console.warn('[chat] send failed', res.status, body);
            if (ctrl) ctrl.disabled = false;
            pills.forEach(p => { p.disabled = false; });
            return;
          }
          // server broadcasts chat:chunk back — clear the textarea draft so the
          // next ask starts clean. also re-collapse any previously expanded
          // history for this session so the new user/agent pair is the only
          // visible exchange.
          chatDrafts.delete(sessionKey);
          expandedThreads.delete(sessionKey);
          if (ta) ta.value = '';
        } catch (err) {
          console.warn('[chat] send error', err);
          if (ctrl) ctrl.disabled = false;
          pills.forEach(p => { p.disabled = false; });
        }
      }

      if (ta) {
        ta.addEventListener('input', e => {
          chatDrafts.set(sessionKey, e.target.value);
        });
        ta.addEventListener('keydown', e => {
          // Enter sends; Shift+Enter inserts a newline. Skip while an IME is
          // composing (CJK) so Enter confirms the character instead of sending.
          if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            btn?.click();
          }
        });
      }
      if (btn) {
        btn.addEventListener('click', () => sendChatText(ta?.value || '', btn));
      }
      pills.forEach(p => {
        p.addEventListener('click', () => sendChatText(p.dataset.quick || '', p));
      });
      Array.from(dChatInput.querySelectorAll('.ctx-turns-btn')).forEach(b => {
        b.addEventListener('click', () => {
          const step = Number(b.dataset.step) || 0;
          const cur = clampCtxTurns(sess.chatContextTurns);
          const next = clampCtxTurns(cur + step);
          if (next === cur) return;
          sess.chatContextTurns = next; // optimistic; server echoes chat:context-turns
          setChatContextTurns(sessionKey, next);
          renderChatInput(sess);        // repaint value + disabled bounds (draft preserved)
        });
      });
    }


    // the suggested reply → a copyable card the user pastes into their terminal.
    let toAgentSeq = 0;
    function renderToAgentCard(reply) {
      const id = "ta-" + (++toAgentSeq);
      return '<div class="to-agent-card">' +
               '<div class="to-agent-head">' +
                 '<span class="to-agent-label">' + escapeHtml(ui().toAgent) + '</span>' +
                 '<button type="button" class="to-agent-copy" data-copy-target="' + id + '">' + escapeHtml(ui().copy) + '</button>' +
               '</div>' +
               '<pre class="to-agent-body" id="' + id + '" dir="ltr">' + escapeHtml(reply) + '</pre>' +
             '</div>';
    }

    // read-only list of the session's archived discussions, newest first.
    // each entry: when it was archived, its opening question, view (unfold the
    // transcript in place) and restore (make it the live thread again — the
    // subprocess is gone, so a follow-up send re-seeds from current turns).
    function renderChatArchives(sess) {
      const el = document.getElementById("d-chat-archives");
      if (!el) return;
      const sk = sess.key || (sess.info ? sess.info.source + ":" + sess.info.path : "");
      const archives = chatArchivesByKey.get(sk) || [];
      if (!archives.length || !archiveOpenPanels.has(sk)) {
        el.hidden = true;
        el.innerHTML = "";
        return;
      }
      el.hidden = false;
      const items = archives.slice().reverse().map((a) => {
        const id = sk + ":" + a.archivedTs;
        const expanded = archiveExpanded.has(id);
        const firstUser = a.chunks.find((c) => c.role === "user");
        const preview = firstUser && firstUser.text ? firstUser.text : "(no question)";
        const clipped = preview.length > 60 ? preview.slice(0, 60) + "…" : preview;
        let body = "";
        if (expanded) {
          body = '<div class="archive-thread">' + a.chunks.map((c) => {
            if (c.role === "assistant") {
              const mdHtml = typeof marked !== "undefined"
                ? marked.parse(c.text || "", { breaks: true, gfm: true })
                : escapeHtml(c.text || "");
              return '<div class="chat-row agent"><div class="chat-role">agent</div>' +
                     '<div class="chat-body conv-md" dir="auto">' + mdHtml + '</div></div>';
            }
            return '<div class="chat-row you"><div class="chat-role">you</div>' +
                   '<div class="chat-body" dir="auto">' + escapeHtml(c.text || "") + '</div></div>';
          }).join("") + '</div>';
        }
        return '<div class="archive-item" data-ts="' + a.archivedTs + '">' +
                 '<div class="archive-head">' +
                   '<span class="archive-when">' + escapeHtml(fmtAge(Date.now() - a.archivedTs)) + ' ago</span>' +
                   '<span class="archive-preview" dir="auto">' + escapeHtml(clipped) + '</span>' +
                   '<button type="button" class="archive-view">' + (expanded ? "hide" : "view") + '</button>' +
                   '<button type="button" class="archive-restore" title="make this the live discussion again">restore</button>' +
                 '</div>' + body +
               '</div>';
      });
      el.innerHTML =
        '<div class="archives-head">past discussions</div>' + items.join("");

      el.querySelectorAll(".archive-item").forEach((item) => {
        const ts = Number(item.dataset.ts);
        const id = sk + ":" + ts;
        const viewBtn = item.querySelector(".archive-view");
        if (viewBtn) viewBtn.addEventListener("click", () => {
          if (archiveExpanded.has(id)) archiveExpanded.delete(id);
          else archiveExpanded.add(id);
          renderChatArchives(sess);
        });
        const restoreBtn = item.querySelector(".archive-restore");
        if (restoreBtn) restoreBtn.addEventListener("click", async () => {
          try {
            const res = await fetch("/chat/restore", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ sessionKey: sk, archivedTs: ts }),
            });
            if (!res.ok) console.warn("[chat] restore failed", res.status);
            // ws chat:restored updates state + re-renders.
          } catch (e) {
            console.warn("[chat] restore failed", e);
          }
        });
      });
    }

    function renderChatThread(sess) {
      const sessionKey = sess.key || (sess.info ? sess.info.source + ":" + sess.info.path : "");
      const thread = chatThreadByKey.get(sessionKey) || [];
      const status = chatStatusByKey.get(sessionKey);
      if (!thread.length && (!status || status.status === "idle" || status.status === "spawned")) {
        dChatThread.innerHTML = "";
        return;
      }
      const renderRow = (c) => {
        if (c.role === "assistant") {
          const parsed = extractToAgent(c.text || "");
          const mdHtml = typeof marked !== "undefined"
            ? marked.parse(parsed.body || "", { breaks: true, gfm: true })
            : escapeHtml(parsed.body || "");
          let inner = '<div class="chat-body conv-md" dir="auto">' + mdHtml + '</div>';
          if (parsed.reply) inner += renderToAgentCard(parsed.reply);
          return '<div class="chat-row agent">' +
                   '<div class="chat-role">agent</div>' +
                   inner +
                 '</div>';
        }
        const autoBadge = c.kind === "auto"
          ? '<span class="chat-auto-tag" title="auto-sent">auto</span>'
          : '';
        return '<div class="chat-row you">' +
                 '<div class="chat-role">you' + autoBadge + '</div>' +
                 '<div class="chat-body" dir="auto">' + escapeHtml(c.text || "") + '</div>' +
               '</div>';
      };

      // collapse older history. when expanded, the full thread renders; when
      // collapsed (default), only the last RECENT_VISIBLE_CHUNKS render. send
      // resets to collapsed so a fresh send always re-anchors on the latest
      // exchange.
      const expanded = expandedThreads.has(sessionKey);
      const visible = thread.length > RECENT_VISIBLE_CHUNKS && !expanded
        ? thread.slice(-RECENT_VISIBLE_CHUNKS)
        : thread;

      let toggleHtml = "";
      if (thread.length > RECENT_VISIBLE_CHUNKS) {
        const hidden = thread.length - RECENT_VISIBLE_CHUNKS;
        const label = expanded
          ? "hide earlier"
          : "show " + hidden + " earlier message" + (hidden === 1 ? "" : "s");
        toggleHtml =
          '<button class="chat-history-toggle" type="button">' +
            escapeHtml(label) +
          '</button>';
      }
      const visibleHtml = visible.map(renderRow).join("");

      let statusHtml = "";
      if (status && status.status === "thinking") {
        // typing bubble — same paper-tint as agent rows, dots animate (and
        // freeze under prefers-reduced-motion via the .typing-dots rule).
        statusHtml =
          '<div class="chat-status thinking">' +
            '<span class="typing-dots" aria-label="agent is typing"><span></span><span></span><span></span></span>' +
          '</div>';
      } else if (status && status.status === "respawning") {
        statusHtml = '<div class="chat-status respawn">reconnecting…</div>';
      } else if (status && status.status === "error") {
        statusHtml = '<div class="chat-status error">error: ' + escapeHtml(status.message || "agent stopped") + '</div>';
      }
      // clear/reset now lives in the detail title row (the always-visible reset
      // button); the thread-head only carries the "show N earlier" toggle.
      const headHtml = toggleHtml
        ? '<div class="chat-thread-head">' + toggleHtml + '</div>'
        : '';
      dChatThread.innerHTML = headHtml + visibleHtml + statusHtml;

      const toggleBtn = dChatThread.querySelector('.chat-history-toggle');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
          if (expandedThreads.has(sessionKey)) expandedThreads.delete(sessionKey);
          else expandedThreads.add(sessionKey);
          renderChatThread(sess);
        });
      }

      dChatThread.querySelectorAll('.to-agent-copy').forEach(b => {
        b.addEventListener('click', () => {
          const el = document.getElementById(b.dataset.copyTarget);
          if (!el) return;
          const txt = el.textContent || "";
          const done = () => {
            const orig = b.textContent;
            b.textContent = ui().copied;
            b.classList.add('copied');
            setTimeout(() => { b.textContent = orig; b.classList.remove('copied'); }, 1200);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(txt).then(done).catch(() => {});
          } else {
            const r = document.createRange(); r.selectNode(el);
            const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
            try { document.execCommand('copy'); done(); } catch (e) {}
            sel.removeAllRanges();
          }
        });
      });
    }

    function refresh() {
      // preserve scroll across a re-render so a background sidebar/detail update
      // never yanks the page position out from under the user.
      const sy = window.scrollY;
      renderInbox();
      renderDetail();
      if (window.scrollY !== sy) window.scrollTo(0, sy);
    }
    window.addEventListener("hashchange", () => {
      const sid = selectedSessionId();
      if (sid) markViewed(sid);
      refresh();
    });
    (() => { const sid = selectedSessionId(); if (sid) markViewed(sid); })();

    setInterval(refresh, 5000);

    function upsertSession(snap) {
      if (!snap || !snap.info) return;
      const key = keyForSnapshot(snap);
      sessionsByKey.set(key, {
        key,
        info: snap.info,
        events: Array.isArray(snap.events) ? snap.events.slice() : [],
        threads: Array.isArray(snap.threads) ? snap.threads.slice() : [],
        lastEventTs: snap.lastEventTs || 0,
        model: snap.model,
        contextTokens: snap.contextTokens || 0,
        totalOutputTokens: snap.totalOutputTokens || 0,
        summary: snap.summary || "",
        summaryTs: snap.summaryTs || 0,
        summaryLang: snap.summaryLang || "",
        displayName: snap.displayName || null,
        chatContextTurns: clampCtxTurns(snap.chatContextTurns),
      });
      // chat thread + status come alongside the snapshot — restore on hello
      // so a page reload doesn't wipe a live conversation.
      if (Array.isArray(snap.chatThread) && snap.chatThread.length) {
        chatThreadByKey.set(key, snap.chatThread.slice());
      }
      if (snap.chatStatus && typeof snap.chatStatus.status === "string") {
        chatStatusByKey.set(key, { status: snap.chatStatus.status, message: snap.chatStatus.message, ts: snap.chatStatus.ts || 0 });
      }
      if (Array.isArray(snap.chatArchives) && snap.chatArchives.length) {
        chatArchivesByKey.set(key, snap.chatArchives.slice());
      }
    }

    function appendEvent(sessionKey, ev) {
      const s = sessionsByKey.get(sessionKey);
      if (!s) return false;
      s.events.push(ev);
      if (s.events.length > 6000) s.events.splice(0, s.events.length - 6000);
      if (typeof ev.ts === "number" && ev.ts > (s.lastEventTs || 0)) s.lastEventTs = ev.ts;
      if (ev.kind === "assistant_text") {
        if (ev.model) s.model = ev.model;
        if (typeof ev.inputTokens === "number") s.contextTokens = ev.inputTokens;
        if (typeof ev.tokens === "number") s.totalOutputTokens = (s.totalOutputTokens || 0) + ev.tokens;
      }
      return true;
    }

    async function maybeAutoExplain(sessionKey, ev) {
      if (autoExplainThreshold <= 0 || currentAuth.status !== "ready" || ev?.kind !== "stop") return;
      const sess = sessionsByKey.get(sessionKey);
      if (!sess || isInternalSession(sess)) return;
      const turns = deriveTurns(sess.events || []);
      const turn = turns.length ? turns[turns.length - 1] : null;
      if (!turn?.id || !turn.agentText || wordCount(turn.agentText) < autoExplainThreshold) return;

      const action = ui().presets?.[0];
      const autoKey = `${sessionKey}::${turn.id}`;
      if (!action || autoExplainSent.has(autoKey) || autoExplainInFlight.has(autoKey)) return;
      autoExplainInFlight.add(autoKey);
      try {
        const res = await fetch("/chat/send", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionKey,
            text: action,
            kind: "auto",
            sourceTurnId: turn.id,
          }),
        });
        if (!res.ok) {
          console.warn("[auto-explain] send failed", res.status, await res.text());
          return;
        }
        autoExplainSent.add(autoKey);
      } catch (err) {
        console.warn("[auto-explain] send error", err);
      } finally {
        autoExplainInFlight.delete(autoKey);
      }
    }

    function appendThread(sessionKey, thread) {
      const s = sessionsByKey.get(sessionKey);
      if (!s) return false;
      s.threads.push(thread);
      return true;
    }

    // recover from a stale URL hash: if `#session/<sid>` points at a sid the
    // server no longer has (e.g. after a server restart, or after the user
    // navigates from a bookmark to a session that's since been pruned), drop
    // the hash silently. earlier we tried reloading on every upstream agent
    // message but that nuked in-progress chat-agent threads on every cc
    // reply — the chat-agent state is server-side, but the textarea draft +
    // expand state are browser-side, and a reload mid-typing is brutal.
    function maybeRecoverStaleHash() {
      const sid = selectedSessionId();
      if (!sid) return;
      const known = new Set();
      for (const s of sessionsByKey.values()) {
        if (s?.info?.sessionId) known.add(s.info.sessionId);
      }
      if (!known.has(sid)) {
        history.replaceState(null, "", location.pathname + location.search);
      }
    }

    function connect() {
      const ws = new WebSocket("ws://" + location.host + "/ws");
      ws.addEventListener("open", () => { reconnectIndicator.hidden = true; });
      ws.addEventListener("message", e => {
        let msg; try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.kind === "hello") {
          // adopt the server's language only if this browser has no saved choice.
          if (typeof msg.language === "string" && !localStorage.getItem(LANG_KEY)) {
            explainLang = msg.language;
            paintLang();
          }
          const helloAuth = msg.auth || {
            status: msg.needsClaudeAuth === true ? "missing" : "ready",
            method: "none",
          };
          if (helloAuth.status === "failed") authSetupForced = true;
          paintAuth(helloAuth);
          paintUsageControl(msg.usage);
          sessionsByKey.clear();
          const list = Array.isArray(msg.sessions) ? msg.sessions : [];
          for (const snap of list) upsertSession(snap);
          maybeRecoverStaleHash();
          refresh();
        } else if (msg.kind === "session:upsert") {
          upsertSession(msg.session);
          refresh();
        } else if (msg.kind === "event") {
          if (appendEvent(msg.sessionKey, msg.event)) {
            void maybeAutoExplain(msg.sessionKey, msg.event);
            refresh();
          }
        } else if (msg.kind === "thread:new") {
          if (appendThread(msg.sessionKey, msg.thread)) refresh();
        } else if (msg.kind === "session:summary") {
          const s = sessionsByKey.get(msg.sessionKey);
          if (s && typeof msg.summary === "string") {
            s.summary = msg.summary;
            s.summaryTs = msg.summaryTs || Date.now();
            s.summaryLang = msg.summaryLang || s.summaryLang;
            refresh();
          }
        } else if (msg.kind === "chat:chunk") {
          if (msg.chunk && typeof msg.chunk.role === "string" && typeof msg.chunk.text === "string") {
            let arr = chatThreadByKey.get(msg.sessionKey);
            if (!arr) { arr = []; chatThreadByKey.set(msg.sessionKey, arr); }
            arr.push({ role: msg.chunk.role, text: msg.chunk.text, ts: msg.chunk.ts || Date.now(), ...(msg.chunk.kind ? { kind: msg.chunk.kind } : {}) });
            if (arr.length > 200) arr.splice(0, arr.length - 200);
            refresh();
          }
        } else if (msg.kind === "chat:status") {
          if (typeof msg.status === "string") {
            chatStatusByKey.set(msg.sessionKey, { status: msg.status, message: msg.message, ts: msg.ts || Date.now() });
            refresh();
          }
        } else if (msg.kind === "auth:state") {
          if (msg.auth?.status === "failed") authSetupForced = true;
          paintAuth(msg.auth);
          renderDetail();
        } else if (msg.kind === "usage:state") {
          paintUsageControl(msg.usage);
        } else if (msg.kind === "chat:cleared") {
          chatThreadByKey.delete(msg.sessionKey);
          chatStatusByKey.delete(msg.sessionKey);
          expandedThreads.delete(msg.sessionKey);
          refresh();
        } else if (msg.kind === "chat:archived" || msg.kind === "chat:restored") {
          if (Array.isArray(msg.archives)) {
            if (msg.archives.length) chatArchivesByKey.set(msg.sessionKey, msg.archives.slice());
            else chatArchivesByKey.delete(msg.sessionKey);
          }
          if (msg.kind === "chat:restored" && Array.isArray(msg.thread)) {
            chatThreadByKey.set(msg.sessionKey, msg.thread.slice());
            chatStatusByKey.delete(msg.sessionKey);
            // restored threads are usually longer than the collapse window —
            // open them so the user lands on what they asked to see.
            expandedThreads.add(msg.sessionKey);
            archiveOpenPanels.delete(msg.sessionKey);
          }
          refresh();
        } else if (msg.kind === "session:remove") {
          // process-driven discovery says this session's agent is gone (and
          // its grace window passed) — drop it from the inbox.
          sessionsByKey.delete(msg.sessionKey);
          maybeRecoverStaleHash();
          refresh();
        } else if (msg.kind === "settings:language") {
          if (typeof msg.language === "string") {
            explainLang = msg.language;
            localStorage.setItem(LANG_KEY, explainLang);
            paintLang();
            refresh();
          }
        } else if (msg.kind === "chat:context-turns") {
          const s = sessionsByKey.get(msg.sessionKey);
          if (s && typeof msg.turns === "number" && s.chatContextTurns !== msg.turns) {
            s.chatContextTurns = msg.turns;
            refresh();
          }
        } else if (msg.kind === "session:rename") {
          const s = sessionsByKey.get(msg.sessionKey);
          if (s) {
            if (typeof msg.customName === "string" && msg.customName) s.customName = msg.customName;
            else delete s.customName;
            if (editingNameSessionId === msg.sessionKey) cancelNameEdit();
            refresh();
          }
        }
      });
      ws.addEventListener("close", () => {
        reconnectIndicator.hidden = false;
        setTimeout(connect, 1000);
      });
      ws.addEventListener("error", () => {
        reconnectIndicator.hidden = false;
      });
    }

    connect();
    refresh();
