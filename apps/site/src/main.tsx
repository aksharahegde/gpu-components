import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from './router'
import { ThemeProvider } from './theme'
import { App } from './App'
// The StyleX CSS entrypoint. The build appends all compiled atomic CSS here.
import './global.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <RouterProvider>
        <App />
      </RouterProvider>
    </ThemeProvider>
  </StrictMode>,
)
