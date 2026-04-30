import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const createManualChunks = (id: string) => {
  if (id.includes('node_modules')) {
    if (id.includes('react-router') || id.includes('react-dom') || id.includes('/react/')) {
      return 'vendor-react';
    }
    if (id.includes('@supabase')) {
      return 'vendor-supabase';
    }
    if (id.includes('recharts')) {
      return 'vendor-charts';
    }
    if (id.includes('framer-motion') || id.includes('react-hook-form')) {
      return 'vendor-ui';
    }
    return undefined;
  }

  if (id.includes('/src/pages/Analytics') || id.includes('/src/services/analytics.service')) {
    return 'page-analytics';
  }
  if (id.includes('/src/pages/Refunds') || id.includes('/src/pages/Rent') || id.includes('/src/services/payment.service')) {
    return 'page-payments';
  }
  if (id.includes('/src/pages/Bookings') || id.includes('/src/components/bookings/')) {
    return 'page-bookings';
  }

  return undefined;
};


// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
  ],
  esbuild: mode === 'production'
    ? {
        drop: ['console', 'debugger'],
        legalComments: 'none',
      }
    : undefined,
  build: {
    target: 'es2020',
    minify: 'esbuild',
    reportCompressedSize: false,
    chunkSizeWarningLimit: 1024,
    rollupOptions: {
      output: {
        manualChunks: createManualChunks,
      },
    },
  },
  resolve: {
    alias: {
      '@components': '/src/components',
      '@services': '/src/services',
      '@pages': '/src/pages',
      '@utils': '/src/utils',
      '@types': '/src/types',
      '@contexts': '/src/contexts',
      '@hooks': '/src/hooks',
    },
  },
  server: {
    port: 5175,
    strictPort: true,
    host: true,
    hmr: true,
    headers: {
      'Content-Security-Policy': "frame-ancestors 'none'",
      'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), accelerometer=(), gyroscope=(), magnetometer=(), display-capture=(), usb=(), serial=(), bluetooth=()',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
    }
  }
}))
