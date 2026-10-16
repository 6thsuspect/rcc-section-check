import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applySettings, readSettings } from './settings'

// Before the first paint, not after the first effect: a stored dark theme (or a
// smaller interface size) must never flash the default light one.
applySettings(readSettings(), document.documentElement)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
