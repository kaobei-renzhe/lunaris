// 首屏上色：在 React 启动前先把主题与皮肤写到 <html>，避免闪一下白/错色
// 必须是阻塞式外链脚本（放在 head 里），不能改成 module，否则会延后到解析完成才执行
;(function () {
  try {
    // 兼容改名前的旧键（月巢 moonnest → 月相 lunaris），老用户升级后首屏也不会闪
    var read = function (key, legacy) {
      var value = localStorage.getItem(key)
      return value !== null ? value : localStorage.getItem(legacy)
    }
    var stored = read('lunaris:theme', 'moonnest:theme')
    var dark =
      stored === 'dark' ||
      (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    var skin = read('lunaris:skin', 'moonnest:skin')
    if (skin && skin !== 'classic') {
      document.documentElement.dataset.skin = skin
    }
  } catch (error) {
    document.documentElement.dataset.theme = 'dark'
  }
})()
