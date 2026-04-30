import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import './utils/consoleFilter'
import { initializeSettings } from './utils/initializeSettings';
import { captureMonitoringError, initializeMonitoring } from './utils/monitoring';

// Initialize System Settings
initializeMonitoring();
initializeSettings().catch((error) => {
    captureMonitoringError(error, { stage: 'initializeSettings' });
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
// Root mounted
