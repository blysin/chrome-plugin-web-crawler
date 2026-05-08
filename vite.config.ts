import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { crx, defineManifest } from '@crxjs/vite-plugin'
import { resolve } from 'path'

const manifest = defineManifest({
  manifest_version: 3,
  name: 'AI Web Crawler',
  version: '1.0.0',
  description: 'AI-powered smart web crawler with visual element selection',
  permissions: [
    'storage',
    'activeTab',
    'sidePanel',
    'scripting',
    'downloads',
    'notifications',
    'alarms'
  ],
  host_permissions: ['<all_urls>'],
  side_panel: {
    default_path: 'src/sidepanel/index.html'
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module'
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle'
    }
  ]
})

export default defineConfig({
  plugins: [vue(), crx({ manifest })],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  build: {
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'src/sidepanel/index.html')
      }
    }
  }
})
