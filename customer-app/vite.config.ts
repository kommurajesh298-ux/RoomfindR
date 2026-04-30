import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'
import tailwindcss from '@tailwindcss/vite'

const netlifyRedirects = () => ({
  name: 'roomfindr-netlify-redirects',
  apply: 'build' as const,
  async writeBundle() {
    const source = path.resolve(__dirname, 'public', '_redirects');
    const targetDir = path.resolve(__dirname, 'dist');
    const target = path.resolve(targetDir, '_redirects');
    const content = await readFile(source, 'utf8');
    await mkdir(targetDir, { recursive: true });
    await writeFile(target, content, 'utf8');
  }
});

const createManualChunks = (id: string) => {
  if (id.includes('node_modules')) {
    if (id.includes('react-router') || id.includes('react-dom') || id.includes('/react/')) {
      return 'vendor-react';
    }
    if (id.includes('@supabase')) {
      return 'vendor-supabase';
    }
    if (id.includes('framer-motion') || id.includes('lottie-react')) {
      return 'vendor-motion';
    }
    if (id.includes('lucide-react') || id.includes('react-icons')) {
      return 'vendor-icons';
    }
    if (id.includes('date-fns') || id.includes('dexie')) {
      return 'vendor-data';
    }
    return undefined;
  }

  if (id.includes('/src/pages/Payment')) {
    return 'page-payments';
  }
  if (id.includes('/src/pages/Chat') || id.includes('/src/components/chat/')) {
    return 'page-chat';
  }
  if (id.includes('/src/pages/PropertyDetails') || id.includes('/src/components/property/')) {
    return 'page-property';
  }
  if (id.includes('/src/pages/Home') || id.includes('/src/components/home/')) {
    return 'page-home';
  }

  return undefined;
};

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  base: process.env.VITE_APP_BASE || '/',
  plugins: [
    react(),
    legacy({
      // Keep legacy fallbacks available without forcing every production build
      // onto the older SystemJS boot path. Modern Android WebViews should use
      // the standard module entry, while older browsers can still fall back.
      targets: ['Chrome >= 61', 'Android >= 6', 'Safari >= 13', 'iOS >= 13'],
      modernPolyfills: true,
      renderLegacyChunks: true,
    }),
    tailwindcss(),
    netlifyRedirects(),
  ],
  esbuild: mode === 'production'
    ? {
        drop: ['console', 'debugger'],
        legalComments: 'none',
      }
    : undefined,
  resolve: {
    alias: {
      '@components': '/src/components',
      '@services': '/src/services',
      '@pages': '/src/pages',
      '@utils': '/src/utils',
    },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    minify: 'esbuild',
    reportCompressedSize: false,
    chunkSizeWarningLimit: 1024,
    rollupOptions: {
      output: {
        manualChunks: createManualChunks,
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: true, // Listen on all addresses
    allowedHosts: true,
    hmr: true,
    headers: {
      'Content-Security-Policy': "frame-ancestors 'none'",
      'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), accelerometer=(), gyroscope=(), magnetometer=(), display-capture=(), usb=(), serial=(), bluetooth=()',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
    },
    proxy: {
      '/firebase-storage': {
        target: 'https://firebasestorage.googleapis.com',
        changeOrigin: true,
        secure: false,
        rewrite: (path: string) => path.replace(/^\/firebase-storage/, ''),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        configure: (proxy: any) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          proxy.on('proxyRes', (proxyRes: any) => {
            proxyRes.headers['access-control-allow-origin'] = '*';
          });
        }
      }
    }
  }
}))
