'use strict';
(() => {
 const root=document.querySelector('.gallery-view');
 if(!root)return;
 const cards=[...document.querySelectorAll('.g-card')];
 const links=[...document.querySelectorAll('[data-gallery-filter]')];
 const search=document.querySelector('#gallery-search');
 const empty=document.querySelector('#gallery-empty');
 const count=document.querySelector('#gallery-count');
 const params=new URLSearchParams(location.search);
 let active=links.some(a=>a.dataset.galleryFilter===params.get('category'))?params.get('category'):'all';
 search.value=params.get('q')||'';
 function update(){
  const query=search.value.trim().toLocaleLowerCase();let visible=0;
  for(const card of cards){const show=(active==='all'||card.dataset.group===active)&&card.textContent.toLocaleLowerCase().includes(query);card.hidden=!show;if(show)visible++;}
  for(const link of links){if(link.dataset.galleryFilter===active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}
  count.textContent=query||active!=='all'?'找到 '+visible+' 个演示':'全部 '+cards.length+' 个演示';empty.hidden=visible>0;
 }
 function url(){const state=new URL(location.href);if(active==='all')state.searchParams.delete('category');else state.searchParams.set('category',active);if(search.value.trim())state.searchParams.set('q',search.value.trim());else state.searchParams.delete('q');history.replaceState(null,'',state);}
 for(const link of links)link.addEventListener('click',event=>{if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();active=link.dataset.galleryFilter;update();url();});
 search.addEventListener('input',()=>{update();url();});
 window.addEventListener('popstate',()=>{const p=new URLSearchParams(location.search);active=links.some(a=>a.dataset.galleryFilter===p.get('category'))?p.get('category'):'all';search.value=p.get('q')||'';update();});
 update();
})();
