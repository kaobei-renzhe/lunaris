// 首屏上色：在 React 启动前先把主题与皮肤写到 <html>，避免闪一下白/错色
// 必须是阻塞式外链脚本（放在 head 里），不能改成 module，否则会延后到解析完成才执行
;(function () {
  try {
    var stored = localStorage.getItem('moonnest:theme')
    var dark =
      stored === 'dark' ||
      (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    var skin = localStorage.getItem('moonnest:skin')
    if (skin && skin !== 'classic') {
      document.documentElement.dataset.skin = skin
    }
  } catch (error) {
    document.documentElement.dataset.theme = 'dark'
  }
})()
