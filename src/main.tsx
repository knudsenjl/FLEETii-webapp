// Application entry point. Mounts <App /> into the #root div (see index.html)
// inside a BrowserRouter (so client-side routing works — see App.tsx for the
// route table) and React's StrictMode (dev-only double-invoking of
// effects/render to help surface side-effect bugs early).
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
