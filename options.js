const select = document.getElementById('zoom');
const status = document.getElementById('status');

chrome.storage.sync.get({ zoom: 'Fit' }, ({ zoom }) => {
  select.value = zoom;
});

select.addEventListener('change', () => {
  chrome.storage.sync.set({ zoom: select.value }, () => {
    status.textContent = `Saved — new docs will open at ${select.value}.`;
    setTimeout(() => { status.textContent = ''; }, 2500);
  });
});
