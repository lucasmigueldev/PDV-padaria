import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerAppServiceWorker } from './services/serviceWorkerRegistration'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

function warmDevelopmentServiceWorker() {
  const controller = navigator.serviceWorker.controller
  if (!controller) return

  const resourceUrls = performance
    .getEntriesByType('resource')
    .map((entry) => entry.name)

  controller.postMessage({
    type: 'PDV360_DEV_WARM_RESOURCES',
    resourceUrls,
  })
}

if ('serviceWorker' in navigator && (import.meta.env.DEV || import.meta.env.PROD)) {
  if (import.meta.env.DEV) {
    navigator.serviceWorker.addEventListener('controllerchange', warmDevelopmentServiceWorker)
  }

  window.addEventListener('load', () => {
    const registration = registerAppServiceWorker(
      { DEV: import.meta.env.DEV, PROD: import.meta.env.PROD },
      navigator.serviceWorker,
    )
    if (!registration) return

    void registration
      .then(() => {
        if (import.meta.env.DEV) warmDevelopmentServiceWorker()
      })
      .catch((err) => {
        console.error('Falha ao registrar Service Worker do PDV:', err)
      })
  })
}
