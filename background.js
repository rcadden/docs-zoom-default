/**
 * Service worker — first-run only.
 *
 * On a fresh install, open the settings page so the user picks a default zoom
 * immediately instead of discovering the option later. Explicitly scoped to
 * reason === 'install' so version updates never steal a tab.
 */
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'install') return;
  chrome.tabs.create({ url: chrome.runtime.getURL('options.html?welcome=1') });
});
