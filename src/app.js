import { ensureMicStream } from "./audioEngine.js";
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

const startAudioButton = document.getElementById("start-audio");

function tabIdFromHash() {
  const id = location.hash.slice(1);
  return ui.validTabIds.has(id) ? id : "simulator";
}

function bindTabClicks() {
  for (const tab of tabs) {
    const id = tab.dataset.tab;
    if (!id || !ui.validTabIds.has(id)) continue;
    tab.addEventListener("click", () => {
      void ui.showTab(id);
    });
  }
}

function bindHashNavigation() {
  window.addEventListener("hashchange", () => {
    void ui.showTab(tabIdFromHash());
  });
}

function bindStartAudio() {
  if (!startAudioButton) return;

  /** Tránh gọi hai lần trên Android (pointerup cảm ứng + click). */
  let lastStartAt = -Infinity;
  let inFlight = false;

  const run = async () => {
    const now = performance.now();
    if (inFlight || now - lastStartAt < 450) return;
    lastStartAt = now;
    inFlight = true;
    startAudioButton.disabled = true;
    startAudioButton.textContent = "Đang mở…";
    startAudioButton.removeAttribute("title");
    try {
      await ensureMicStream();
      startAudioButton.textContent = "Audio Ready";
      document.dispatchEvent(new CustomEvent("webfft:start-audio"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      startAudioButton.textContent = "Start Audio";
      startAudioButton.title = msg;
    } finally {
      inFlight = false;
      if (startAudioButton.textContent === "Audio Ready") {
        startAudioButton.disabled = true;
      } else {
        startAudioButton.disabled = false;
      }
    }
  };

  startAudioButton.addEventListener("click", () => {
    void run();
  });
  startAudioButton.addEventListener(
    "pointerup",
    (ev) => {
      if (ev.pointerType === "touch") {
        void run();
      }
    },
    { passive: true },
  );
}

bindTabClicks();
bindHashNavigation();
bindStartAudio();

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

void ui.showTab(tabIdFromHash());

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
  void ui.showTab(nextId);
  const nextBtn = tabs.find((t) => t.dataset.tab === nextId);
  nextBtn?.focus();
});
