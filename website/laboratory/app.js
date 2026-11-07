(() => {
  const controls = document.querySelector('.controls');
  if (!controls) return;
  const cards = [...document.querySelectorAll('.course-card')];
  const filters = [...document.querySelectorAll('[data-filter]')];
  const input = document.querySelector('#search');
  const status = document.querySelector('.result-count');
  const empty = document.querySelector('.empty');
  const allowed = new Set(filters.map(button => button.dataset.filter));
  const params = new URLSearchParams(location.search);
  let subject = allowed.has(params.get('subject')) ? params.get('subject') : 'all';
  input.value = params.get('q') || '';
  controls.hidden = false;
  function filter(updateURL = true) {
    const words = input.value.trim().toLocaleLowerCase('zh-CN').split(/\s+/).filter(Boolean);
    let count = 0;
    for (const card of cards) {
      const text = card.dataset.search.toLocaleLowerCase('zh-CN');
      const visible = (subject === 'all' || card.dataset.subject === subject) && words.every(word => text.includes(word));
      card.hidden = !visible;
      if (visible) count++;
    }
    filters.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === subject)));
    status.textContent = `找到 ${count} 个互动课件`;
    empty.hidden = count > 0;
    if (updateURL) {
      const url = new URL(location.href);
      if (subject === 'all') url.searchParams.delete('subject'); else url.searchParams.set('subject', subject);
      if (input.value.trim()) url.searchParams.set('q', input.value.trim()); else url.searchParams.delete('q');
      history.replaceState(null, '', url);
    }
  }
  filters.forEach(button => button.addEventListener('click', () => { subject = button.dataset.filter; filter(); }));
  input.addEventListener('input', () => filter());
  document.querySelector('#clear-search').addEventListener('click', () => { subject = 'all'; input.value = ''; filter(); input.focus(); });
  window.addEventListener('pageshow', () => filter(false));
  filter(false);
})();
