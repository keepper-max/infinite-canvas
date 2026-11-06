'use strict';
const filters = [...document.querySelectorAll('[data-filter]')];
if (filters.length) {
  const requested = new URLSearchParams(location.search).get('category');
  const active = filters.some(link=>link.dataset.filter===requested) ? requested : 'all';
  filters.find(link=>link.dataset.filter===active).setAttribute('aria-current','page');
  for (const card of document.querySelectorAll('[data-group]')) {
    card.hidden = active !== 'all' && card.dataset.group !== active;
  }
}
const back = document.querySelector('.demo-return');
if (back && document.referrer) {
  const from = new URL(document.referrer);
  if (from.origin === location.origin && from.pathname === '/demos/') back.href = from.pathname + from.search;
  if (from.origin === location.origin && from.pathname === '/') {
    back.href = '/#demos';
    back.textContent = '← 返回首页技术演示';
  }
}
const video = document.querySelector('video');
if (video) {
  // Some browsers require the visitor to press the native play button after navigation.
  video.play().catch(()=>{});
  back.addEventListener('click',()=>video.pause());
  window.addEventListener('pagehide',()=>video.pause());
}
const reader = document.querySelector('.slide-reader');
if (reader) {
  const slide = document.querySelector('#slide');
  const full = document.querySelector('#slide-full');
  const prev = document.querySelector('#prev');
  const next = document.querySelector('#next');
  const count = Number(reader.dataset.pages);
  let page = 1;
  function turn(amount) {
    page = Math.max(1,Math.min(count,page+amount));
    slide.src = full.href = reader.dataset.media + page + '.webp';
    slide.alt = document.querySelector('h1').textContent + '，第 ' + page + ' 页';
    document.querySelector('#counter').textContent = page + ' / ' + count;
    prev.disabled = page===1;
    next.disabled = page===count;
    if (prev.disabled && document.activeElement===prev) next.focus();
    if (next.disabled && document.activeElement===next) prev.focus();
  }
  prev.addEventListener('click',()=>turn(-1));
  next.addEventListener('click',()=>turn(1));
  document.addEventListener('keydown',event=>{
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      turn(event.key === 'ArrowLeft' ? -1 : 1);
    }
  });
}
if (back) document.addEventListener('keydown',event=>{
  if (event.key === 'Escape' && !document.fullscreenElement) back.click();
});
