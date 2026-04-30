import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './utils/consoleFilter'
import ErrorBoundary from './components/common/ErrorBoundary';
import { initializeMonitoring } from './utils/monitoring';
import LoadingOverlay from './components/common/LoadingOverlay';
import { loadLazyModuleWithRecovery } from './utils/lazyWithPreload';

import { HashRouter as Router } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { LayoutProvider } from './contexts/LayoutContext';
import { NetworkProvider } from './contexts/NetworkContext';
import OfflineBanner from './components/common/OfflineBanner';

const App = lazy(() => loadLazyModuleWithRecovery(() => import('./App.tsx')));

initializeMonitoring();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <NetworkProvider>
        <Router>
          <AuthProvider>
            <LayoutProvider>
              <OfflineBanner />
              <Suspense fallback={<LoadingOverlay message="Opening RoomFindR" />}>
                <App />
              </Suspense>
            </LayoutProvider>
          </AuthProvider>
        </Router>
      </NetworkProvider>
    </ErrorBoundary>
  </StrictMode>,
)
