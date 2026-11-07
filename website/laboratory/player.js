(() => {
  const frame = document.querySelector('#course-frame');
  const shell = document.querySelector('.player-shell');
  const button = document.querySelector('#fullscreen');
  const status = document.querySelector('#player-status');
  if (!frame || !shell || !button || !status) return;
  frame.addEventListener('load', () => { status.textContent = '课件文件已载入 · 按页面提示开始探索'; });
  // A cached iframe may finish before the deferred script executes.
  if (document.readyState === 'complete') status.textContent = '课件文件已载入 · 按页面提示开始探索';
  window.addEventListener('load', () => { status.textContent = '课件文件已载入 · 按页面提示开始探索'; }, { once: true });
  if (document.fullscreenEnabled && shell.requestFullscreen) {
    button.hidden = false;
    button.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await shell.requestFullscreen();
      } catch {
        status.textContent = '浏览器未能进入全屏，可继续在此操作或下载离线课件。';
      }
    });
    document.addEventListener('fullscreenchange', () => {
      button.textContent = document.fullscreenElement ? '退出全屏 ×' : '全屏探索 ⛶';
    });
  }
})();
