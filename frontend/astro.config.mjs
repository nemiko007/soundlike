// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind'; // 正しいインポート！

// https://astro.build/config
export default defineConfig({
  integrations: [react(), tailwind()], // 正しいインテグレーション！

  vite: {
    // plugins: [tailwindcss()] // 削除！
  }
});