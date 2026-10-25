import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import AppDialogHost from './components/AppDialogHost'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
    {/* 挂在最外层，欢迎页/加载中也用应用内弹窗 */}
    <AppDialogHost />
  </React.StrictMode>
)
