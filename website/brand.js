'use strict';
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const icon = id => `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;
const content = typeof websiteContent === 'object' && websiteContent !== null ? websiteContent : {};
const projects = Array.isArray(content.projects) ? content.projects : [];
const articles = Array.isArray(content.articles) ? content.articles : [];
const news = Array.isArray(content.news) ? content.news : [];
const safeSource = value => { try { const url = new URL(value); return url.protocol === 'https:' ? escapeHTML(url.href) : null; } catch { return null; } };
document.querySelector('#project-list').innerHTML = projects.slice(0, 2).map((project, index) => `
<article class="project-card"><figure><img src="/website-assets/20261026-site09/${index === 0 ? 'quality' : 'factory'}-interface.webp" width="${index === 0 ? 1265 : 1270}" height="${index === 0 ? 712 : 714}" loading="lazy" decoding="async" alt="${index === 0 ? '品控审核系统实际界面：知识依据、审核记录与包装审核输入页' : '工厂运营 Copilot 实际界面：产品定位输入与运营模块导航'}"><figcaption>实际项目界面</figcaption></figure><div class="project-copy"><span class="project-type">${escapeHTML(project.type)}</span><h3>${escapeHTML(project.name)}</h3><p>${escapeHTML(project.intro)}</p><dl class="project-facts"><dt>业务问题</dt><dd>${escapeHTML(project.problem)}</dd><dt>实现方式</dt><dd>${escapeHTML(project.approach)}</dd><dt>已有能力</dt><dd>${escapeHTML(project.deliverable)}</dd></dl><details><summary>了解项目详情</summary><p class="project-boundary">${escapeHTML(project.boundary)}</p><a class="text-link" href="#contact" data-consult>讨论类似需求${icon('arrow')}</a></details></div></article>`).join('') + `
<article class="project-card" id="knowledge-tree"><figure><a href="/lab/polytech-tree/" aria-label="进入互动知识树演示"><img src="/website-assets/polytech-tree/cover-f67e358e16e5.webp" width="1200" height="675" loading="lazy" decoding="async" alt="真实科技知识节点按时代延展，不同领域通过关联线连接"></a><figcaption>互动教学展项</figcaption></figure><div class="project-copy"><span class="project-type">教育应用 × 知识可视化</span><h3>互动知识树</h3><p>把复杂知识，变成可以探索的空间。</p><dl class="project-facts"><dt>学习问题</dt><dd>知识分散在不同领域，单看文字难以理解科技发展脉络与相互关系。</dd><dt>实现方式</dt><dd>以时间、领域与真实依赖关系组织知识，结合分层展示与搜索定位探索网络。</dd><dt>已有能力</dt><dd>知识搜索、节点详情、关系聚焦与全景探索，可直接进入互动演示。</dd></dl><a class="text-link project-action" href="/lab/polytech-tree/">进入互动演示${icon('external')}</a></div></article>`;

const articleCovers = ['enterprise','knowledge','agent'];
document.querySelector('#article-list').innerHTML = articles.slice(0, 4).map((article, index) => `<article class="article-card"><img class="article-cover" src="/website-assets/20261026-site09/service-${articleCovers[index % articleCovers.length]}.webp" width="480" height="300" loading="lazy" decoding="async" alt=""><div class="article-copy"><span class="article-category">${['行业 AI 应用观察','技术与产品实践','工作流方法'][index] || '研究与洞察'}</span><h3>${escapeHTML(article.title)}</h3><p>${escapeHTML((article.paragraphs?.[0] || '').split('。')[0])}。</p><details><summary>阅读全文</summary><div class="article-body">${(Array.isArray(article.paragraphs) ? article.paragraphs : []).map(paragraph => `<p>${escapeHTML(paragraph)}</p>`).join('')}</div></details></div></article>`).join('') || '<p class="content-error">文章暂未加载，请刷新页面重试。</p>';

document.querySelector('#news-list').innerHTML = news.slice(0, 5).map(item => { const source = safeSource(item.url); return `<article class="news-story"><div class="news-meta"><time datetime="${escapeHTML(item.date)}">${escapeHTML(item.date)}</time><span>${escapeHTML(item.category)}</span></div><h3>${escapeHTML(item.title)}</h3><p>${escapeHTML(item.summary)}</p><details><summary>阅读我们的观察</summary><p>${escapeHTML(item.observation)}</p></details>${source ? `<a class="news-source" href="${source}" target="_blank" rel="noopener">来源：${escapeHTML(item.source)} · 阅读原文 ↗</a>` : ''}</article>`; }).join('') || '<p class="content-error">资讯暂未加载，请刷新页面重试；不影响咨询与产品入口。</p>';
const header = document.querySelector('#site-header');
const menuToggle = document.querySelector('.menu-toggle');
const menu = document.querySelector('#primary-nav');
function closeMenu() { menuToggle.setAttribute('aria-expanded', 'false'); menuToggle.setAttribute('aria-label', '打开导航'); menu.classList.remove('is-open'); }
menuToggle.addEventListener('click', () => { const open = menuToggle.getAttribute('aria-expanded') !== 'true'; menuToggle.setAttribute('aria-expanded', String(open)); menuToggle.setAttribute('aria-label', open ? '关闭导航' : '打开导航'); menu.classList.toggle('is-open', open); });
menu.addEventListener('click', event => { if (event.target.closest('a')) closeMenu(); });
document.addEventListener('click', event => { if (!header.contains(event.target)) closeMenu(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && menuToggle.getAttribute('aria-expanded') === 'true') { closeMenu(); menuToggle.focus(); } });
matchMedia('(min-width:1101px)').addEventListener('change', closeMenu);
const syncHeader = () => header.classList.toggle('is-scrolled', scrollY > 80);
window.addEventListener('scroll', syncHeader, {passive:true}); syncHeader();
document.querySelector('#copyright-year').textContent = String(new Date().getFullYear());
document.addEventListener('click', event => { if (!event.target.closest('[data-consult]')) return; event.preventDefault(); document.querySelector('#contact').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'}); document.querySelector('#inquiry-content').focus({preventScroll:true}); });
function revealHashTarget() { let id; try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; } const target = document.getElementById(id); if (target?.tagName === 'DETAILS') target.open = true; }
window.addEventListener('hashchange', revealHashTarget); revealHashTarget();
// Preserve existing inquiry API, stable retry id and failure retention; no browser storage.
document.querySelector('#inquiry-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget;
  if (form.dataset.busy || !form.reportValidity()) return;
  const text = form.elements.content.value.trim(), contact = form.elements.contact.value.trim(), result = form.querySelector('#inquiry-result');
  if (text.length < 2 || !contact) { result.textContent = '请填写具体需求和联系方式。'; result.dataset.state = 'error'; return; }
  const signature = JSON.stringify([text, contact]);
  if (form.dataset.signature !== signature) { form.dataset.signature = signature; form.dataset.requestId = crypto.randomUUID(); }
  form.dataset.busy = '1'; form.setAttribute('aria-busy', 'true');
  const button = form.querySelector('button[type=submit]'); button.disabled = true; button.textContent = '正在提交…'; result.textContent = ''; delete result.dataset.state;
  for (const input of form.querySelectorAll('input,textarea')) input.disabled = true;
  try {
    const response = await fetch('/api/website/inquiries', {method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:form.dataset.requestId,content:text,contact,consent:true})});
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.data?.id !== form.dataset.requestId) throw new Error(payload?.error?.message || '暂时无法提交，请稍后重试，或直接邮件联系。');
    result.textContent = '需求已收到。我们会通过你留下的联系方式沟通。记录编号：' + payload.data.id;
    result.dataset.state = 'success'; form.reset(); delete form.dataset.signature; delete form.dataset.requestId;
  } catch (error) { result.textContent = error instanceof Error ? error.message : '提交失败，内容已保留，请重试或直接邮件联系。'; result.dataset.state = 'error'; }
  finally { delete form.dataset.busy; form.removeAttribute('aria-busy'); button.disabled = false; button.innerHTML = '提交需求' + icon('arrow'); for (const input of form.querySelectorAll('input,textarea')) input.disabled = false; }
});
// Fail closed if this file is blocked or initialization failed before the handler was attached.
document.querySelector('.inquiry-fields').disabled = false;
document.querySelector('#inquiry-form button[type=submit]').disabled = false;
document.querySelector('#inquiry-availability').hidden = true;
