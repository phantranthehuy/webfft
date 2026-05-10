import { suspendSharedAudioContext } from "../audioEngine.js";

/**
 * @typedef {object} UiMode
 * @property {string} id
 * @property {boolean} [isRealtimeAudio] — true nếu tab cần AudioContext chạy liên tục (micro / phân tích).
 * @property {() => void} enter
 * @property {() => void | Promise<void>} exit
 */

/**
 * @param {{
 *   tabs: HTMLButtonElement[],
 *   panels: HTMLElement[],
 *   modes: Record<string, UiMode>,
 * }} opts
 */
export function createUiManager(opts) {
  const { tabs, panels, modes } = opts;
  const validIds = new Set(Object.keys(modes));

  /** @type {string | null} */
  let activeTabId = null;

  /**
   * @param {string} tabId
   */
  function applyTabDom(tabId) {
    for (const tab of tabs) {
      const isActive = tab.dataset.tab === tabId;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
      tab.tabIndex = isActive ? 0 : -1;
    }
    for (const panel of panels) {
      const isActive = panel.id === `panel-${tabId}`;
      panel.classList.toggle("is-active", isActive);
      panel.hidden = !isActive;
    }
    if (location.hash.slice(1) !== tabId) {
      history.replaceState(null, "", `#${tabId}`);
    }
  }

  /**
   * Thoát chế độ cũ, cập nhật tab/panel, vào chế độ mới; suspend context nếu không còn tab real-time.
   * @param {string} tabId
   * @returns {Promise<void>}
   */
  async function showTab(tabId) {
    if (!validIds.has(tabId)) {
      return;
    }
    if (activeTabId === tabId) {
      return;
    }

    if (activeTabId) {
      const prev = modes[activeTabId];
      if (prev) {
        await Promise.resolve(prev.exit());
      }
    }

    activeTabId = tabId;
    applyTabDom(tabId);

    const next = modes[tabId];
    if (next) {
      next.enter();
    }

    if (!next?.isRealtimeAudio) {
      await suspendSharedAudioContext();
    }
  }

  /**
   * @returns {string | null}
   */
  function getActiveTab() {
    return activeTabId;
  }

  return {
    showTab,
    getActiveTab,
    validTabIds: validIds,
  };
}
