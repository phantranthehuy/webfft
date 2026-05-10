import {
  ensureMicStream,
  hasLiveMicStream,
  releaseSharedMic,
  setResumeUiSuppressed,
} from "./audioEngine.js";
import { createUiManager } from "./ui/uiManager.js";
import { createDftSimulatorMode } from "./ui/dftSimulator.js";
import { createSpectrumAnalyzerMode } from "./ui/spectrumAnalyzer.js";
import { createDtmfDecoderMode } from "./ui/dtmfDecoder.js";
import { createNoiseReductionMode } from "./ui/noiseReduction.js";
import { createTunerMode } from "./ui/tuner.js";

const TAB_ORDER = /** @type {const} */ ([
  "simulator",
  "analyzer",
  "dtmf",
  "noise",
  "tuner",
]);

const MIC_ICON_OFF = "assets/icons/mic_off.svg";
const MIC_ICON_ON = "assets/icons/mic_on.svg";

const tabs = /** @type {HTMLButtonElement[]} */ (
  Array.from(document.querySelectorAll(".tab"))
);
const panels = /** @type {HTMLElement[]} */ (
  Array.from(document.querySelectorAll(".panels .panel"))
);

const modes = {
  simulator: createDftSimulatorMode(),
  analyzer: createSpectrumAnalyzerMode(
    document.getElementById("spectrum-analyzer"),
  ),
  dtmf: createDtmfDecoderMode(document.getElementById("dtmf-decoder")),
  noise: createNoiseReductionMode(document.getElementById("noise-reduction")),
  tuner: createTunerMode(document.getElementById("tuner")),
};

const ui = createUiManager({ tabs, panels, modes });

const audioFabStack = document.getElementById("audio-fab-stack");
const micFab = document.getElementById("mic-fab");
const micFabIcon = document.getElementById("mic-fab-icon");

/**
 * @param {{ loading?: boolean }} [opts]
 */
function syncMicFabAppearance(opts = {}) {
  const loading = opts.loading ?? false;
  if (!micFab || !micFabIcon) return;
  const live = hasLiveMicStream();
  micFabIcon.src = live ? MIC_ICON_ON : MIC_ICON_OFF;
  micFab.setAttribute("aria-pressed", live ? "true" : "false");
  const label = live ? "Tắt micro" : "Bật micro";
  micFab.setAttribute("aria-label", label);
  if (!loading) {
    micFab.title = label;
  }
  micFab.disabled = loading;
}

function bindMicFab() {
  if (!micFab) return;

  let lastToggleAt = -Infinity;
  let inFlight = false;

  micFab.addEventListener("click", () => {
    void (async () => {
      const now = performance.now();
      if (inFlight || now - lastToggleAt < 450) return;
      lastToggleAt = now;

      if (hasLiveMicStream()) {
        releaseSharedMic();
        document.dispatchEvent(new CustomEvent("webfft:stop-audio"));
        syncMicFabAppearance({ loading: false });
        return;
      }

      inFlight = true;
      syncMicFabAppearance({ loading: true });
      micFab.removeAttribute("title");
      try {
        await ensureMicStream();
        document.dispatchEvent(new CustomEvent("webfft:start-audio"));
        syncMicFabAppearance({ loading: false });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        micFab.title = msg;
        syncMicFabAppearance({ loading: false });
      } finally {
        inFlight = false;
      }
    })();
  });
}

/**
 * @param {string} tabId
 */
async function showTabWithShell(tabId) {
  await ui.showTab(tabId);
  const realtime = modes[tabId]?.isRealtimeAudio === true;
  setResumeUiSuppressed(!realtime);
  if (audioFabStack) {
    audioFabStack.hidden = !realtime;
  }
  if (!realtime) {
    releaseSharedMic();
    document.dispatchEvent(new CustomEvent("webfft:stop-audio"));
  }
  syncMicFabAppearance({ loading: false });
}

function tabIdFromHash() {
  const id = location.hash.slice(1);
  return ui.validTabIds.has(id) ? id : "simulator";
}

function bindTabClicks() {
  for (const tab of tabs) {
    const id = tab.dataset.tab;
    if (!id || !ui.validTabIds.has(id)) continue;
    tab.addEventListener("click", () => {
      void showTabWithShell(id);
    });
  }
}

function bindHashNavigation() {
  window.addEventListener("hashchange", () => {
    void showTabWithShell(tabIdFromHash());
  });
}

bindTabClicks();
bindHashNavigation();
bindMicFab();

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const swUrl = new URL("../sw.js", import.meta.url);
  const scopeUrl = new URL("../", import.meta.url);
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register(swUrl, { scope: scopeUrl.href })
      .catch(() => {});
  });
}

registerServiceWorker();

void showTabWithShell(tabIdFromHash());

/** Điều hướng bàn phím giữa các tab (mũi tên trái/phải). */
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
  const ae = document.activeElement;
  if (!(ae instanceof HTMLButtonElement) || !ae.classList.contains("tab")) {
    return;
  }
  const current = ui.getActiveTab();
  if (!current) return;
  const idx = TAB_ORDER.indexOf(
    /** @type {(typeof TAB_ORDER)[number]} */ (current),
  );
  if (idx < 0) return;
  ev.preventDefault();
  const nextIdx =
    ev.key === "ArrowRight"
      ? Math.min(TAB_ORDER.length - 1, idx + 1)
      : Math.max(0, idx - 1);
  const nextId = TAB_ORDER[nextIdx];
  void showTabWithShell(nextId);
  const nextBtn = tabs.find((t) => t.dataset.tab === nextId);
  nextBtn?.focus();
});
