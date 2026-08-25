import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { registrarServiceWorker } from './pwa'
import './estilos/app.css'

const raiz = document.getElementById('raiz')
if (!raiz) throw new Error('Elemento #raiz não encontrado no index.html')

registrarServiceWorker()

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
