import "./ui/dftSimulator.js";

const tabs = Array.from(document.querySelectorAll(".tab"));
const panels = Array.from(document.querySelectorAll(".panel"));
const startAudioButton = document.getElementById("start-audio");
const validTabs = new Set(tabs.map((tab) => tab.dataset.tab));

const setActiveTab = (tabId) => {
  if (!validTabs.has(tabId)) {
    return;
  }

  tabs.forEach((tab) => {
    const isActive = tab.dataset.tab === tabId;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
  });

  panels.forEach((panel) => {
    const isActive = panel.id === `panel-${tabId}`;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  });

  if (location.hash.slice(1) !== tabId) {
    history.replaceState(null, "", `#${tabId}`);
  }
};

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    setActiveTab(tab.dataset.tab);
  });
});

const initialTab = validTabs.has(location.hash.slice(1))
  ? location.hash.slice(1)
  : "simulator";

setActiveTab(initialTab);

startAudioButton?.addEventListener("click", () => {
  startAudioButton.textContent = "Audio Ready";
  startAudioButton.disabled = true;
  document.dispatchEvent(new CustomEvent("webfft:start-audio"));
});
