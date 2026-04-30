import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
    if (id.includes('framer-motion') || id.includes('lottie-react')) {
      return 'vendor-motion';
    }
    if (id.includes('lucide-react') || id.includes('react-icons')) {
      return 'vendor-icons';
    }
    if (id.includes('date-fns')) {
      return 'vendor-data';
    }
    return undefined;
  }

  return undefined;
};

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
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
    },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5174,
    strictPort: true,
    host: true,
    allowedHosts: true,
    hmr: true,
    headers: {
      'Content-Security-Policy': "frame-ancestors 'none'",
      'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), accelerometer=(), gyroscope=(), magnetometer=(), display-capture=(), usb=(), serial=(), bluetooth=()',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
    },
  },
}))
