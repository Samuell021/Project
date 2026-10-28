import { defineConfig } from 'vite'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'


const SOURCE_FINGERPRINT_PATH = path.resolve(
  __dirname,
  '../ZaminexB/static/frontend/.vite/build-sources.json',
)


function ZaminexSourceFingerprint() {
  return {
    name: 'Zaminex-source-fingerprint',
    apply: 'build',
    generateBundle(this: { getModuleIds: () => Iterable<string> }) {
      const sources: Record<string, string> = {}
      for (const id of this.getModuleIds()) {
        if (!id || id.startsWith('\0') || !path.isAbsolute(id)) continue
        let stats: fs.Stats
        try {
          stats = fs.statSync(id)
        } catch {
          continue
        }
        if (!stats.isFile()) continue
        const relative = path.relative(__dirname, id).split(path.sep).join('/')
        if (relative.startsWith('..') || relative.startsWith('node_modules/')) continue
        sources[relative] = crypto
          .createHash('sha256')
          .update(fs.readFileSync(id))
          .digest('hex')
      }

      const payload = {
        generatedAt: new Date().toISOString(),
        entry: 'src/main.tsx',
        sources: Object.fromEntries(
          Object.entries(sources).sort(([left], [right]) => left.localeCompare(right)),
        ),
      }

      fs.mkdirSync(path.dirname(SOURCE_FINGERPRINT_PATH), { recursive: true })
      fs.writeFileSync(
        SOURCE_FINGERPRINT_PATH,
        `${JSON.stringify(payload, null, 2)}\n`,
        'utf-8',
      )
    },
  }
}


function ZaminexAssetResolver() {
  return {
    name: 'Zaminex-asset-resolver',
    resolveId(id) {
      if (id.startsWith('Zaminex:asset/')) {
        const filename = id.replace('Zaminex:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig({
  plugins: [
    ZaminexAssetResolver(),
    react(),
    tailwindcss(),
    ZaminexSourceFingerprint(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  base: '/static/frontend/',

  build: {
    outDir: path.resolve(__dirname, '../ZaminexB/static/frontend'),

    emptyOutDir: true,

    manifest: true,

    rollupOptions: {
      input: path.resolve(__dirname, 'src/main.tsx'),
    },
  },

  assetsInclude: ['**/*.svg', '**/*.csv'],
})
