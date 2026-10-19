import './style.css'
let dispose: (() => void) | undefined
let generation = 0
const progress = document.querySelector<HTMLProgressElement>('#load-progress')!
const status = document.querySelector('#load-status')!
function report(value: number, message: string) { progress.value = value; status.textContent = message }
function fallback(message: string, title = '暂时无法打开三维场景') {
  dispose?.(); dispose = undefined
  document.querySelector<HTMLElement>('.experience')!.hidden = true
  document.querySelector<HTMLElement>('#fallback')!.hidden = false
  document.querySelector('#fallback-title')!.textContent = title
  document.querySelector('#fallback-message')!.textContent = message
}
async function start() {
  const run = ++generation
  try {
    const probe = document.createElement('canvas')
    const gl = probe.getContext('webgl2')
    if (!gl) { fallback('当前浏览器未提供WebGL 2。请启用硬件加速或使用支持WebGL 2的现代浏览器；以下静态图仍可查看。', '这里需要浏览器的三维能力'); return }
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    report(15, '载入渲染内核与科技数据')
    const { mount } = await import('./main')
    if (run !== generation) return
    dispose = await mount(report, message => fallback(message))
    if (run !== generation) { dispose(); dispose = undefined }
  } catch (error) {
    console.error('Knowledge tree loading failed', error)
    if (run === generation) fallback('场景资源未能完整加载。请检查网络后重新加载；静态介绍和返回官网仍可使用。')
  }
}
document.querySelector('#retry')!.addEventListener('click', () => location.reload())
window.addEventListener('pagehide', () => { generation++; dispose?.(); dispose = undefined })
window.addEventListener('pageshow', event => { if (event.persisted) void start() })
void start()
