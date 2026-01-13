/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}',
  ],
  theme: {
    extend: {
      colors: {
        'gyaru-black': '#1a1a1a',
        'gyaru-pink': '#ff69b4',
      },
    },
  },
  plugins: [],
}
