const screens = {
  scan: {
    src: "assets/scan.webp",
    alt: "Marx scan configuration with project, branch, SAST and SCA controls",
    text: "Choose the local source, confirm its Checkmarx project, and review scanner options before the official CLI uploads anything.",
  },
  results: {
    src: "assets/results.webp",
    alt: "Marx results list with scanner, severity and state filters",
    text: "Findings stay connected to their scan and project. Filter the evidence, inspect a finding, and prepare a focused next step.",
  },
  workbench: {
    src: "assets/workbench.webp",
    alt: "Marx remediation workbench with pinned findings and session notes",
    text: "Keep the original findings pinned in a remediation session. Record the change and compare a verification scan without overwriting the baseline.",
  },
};
const tabs = Array.from(document.querySelectorAll("[data-screen]"));
function selectTab(tab) {
  const state = screens[tab.dataset.screen];
  if (!state) return;
  for (const item of tabs) {
    item.setAttribute("aria-selected", String(item === tab));
    item.tabIndex = item === tab ? 0 : -1;
  }
  const image = document.getElementById("feature-screen");
  image.src = state.src;
  image.alt = state.alt;
  document.getElementById("feature-description").textContent = state.text;
  document
    .getElementById("feature-panel")
    .setAttribute("aria-labelledby", tab.id);
}
for (const tab of tabs) {
  tab.addEventListener("click", () => selectTab(tab));
  tab.addEventListener("keydown", (event) => {
    let index = tabs.indexOf(tab);
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      index = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      index = (index + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = tabs.length - 1;
    else return;
    event.preventDefault();
    selectTab(tabs[index]);
    tabs[index].focus();
  });
}
