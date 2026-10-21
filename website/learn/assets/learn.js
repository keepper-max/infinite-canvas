/* 关于页、许可页和页脚沿用当前学科；官网返回链接不携带学习参数。 */
(function () {
  'use strict';
  var subject = new URLSearchParams(location.search).get('subject');
  if (subject !== 'english' && subject !== 'math') return;
  document.querySelectorAll('.site-nav a:not(.subject-link), a.brand, .site-footer a').forEach(function (link) {
    var url = new URL(link.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/learn/')) return;
    url.searchParams.set('subject', subject);
    link.href = url.pathname + url.search + url.hash;
  });
})();
