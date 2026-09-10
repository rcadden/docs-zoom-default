const select = document.getElementById('zoom');
const status = document.getElementById('status');

// background.js appends ?welcome=1 on first install, which turns this same page
// into a slightly roomier first-run screen instead of the toolbar popup.
const isWelcome = new URLSearchParams(location.search).get('welcome') === '1';

if (isWelcome) {
  document.body.classList.add('welcome');
  document.getElementById('heading').textContent = 'Pick your default zoom';
  document.getElementById('hint').textContent =
    'Google Docs opens every document at 100%. Choose what you would rather it use.';
}

chrome.storage.sync.get({ zoom: 'Fit' }, ({ zoom }) => {
  select.value = zoom;
  // Write the default back on first run so the stored value matches what is
  // shown, even if the user accepts it without touching the dropdown.
  if (isWelcome) chrome.storage.sync.set({ zoom });
});

select.addEventListener('change', () => {
  chrome.storage.sync.set({ zoom: select.value }, () => {
    status.textContent = `Saved — docs will open at ${select.value}.`;
    setTimeout(() => { status.textContent = ''; }, 2500);
  });
});
