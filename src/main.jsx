// main.jsx
// This is the entry point of our React application.
// It renders the root App component into the HTML DOM.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css' // Import global CSS styles
import App from './App.jsx'

// createRoot is the modern way to initialize a React 18+ application
createRoot(document.getElementById('root')).render(
  // StrictMode helps find potential problems in the application during development.
  // Note: It causes components to render twice in development mode.
  <StrictMode>
    <App />
  </StrictMode>,
)
