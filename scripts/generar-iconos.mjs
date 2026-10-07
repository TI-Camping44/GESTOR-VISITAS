// Genera los íconos PNG de la PWA a partir de un SVG, con el Chromium del entorno.
//   node scripts/generar-iconos.mjs
import { chromium } from 'playwright-core'

const svg = (maskable) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${maskable ? 0 : 112}" fill="#1f6f4a"/>
  <g transform="translate(256 ${maskable ? 236 : 226}) scale(${maskable ? 0.78 : 1})">
    <path d="M0 150 C -40 95 -118 30 -118 -38 A118 118 0 0 1 118 -38 C 118 30 40 95 0 150 Z" fill="#ffffff"/>
    <text x="0" y="-8" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="84" fill="#1f6f4a">44</text>
  </g>
</svg>`

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' }).catch(async () => chromium.launch())
const page = await browser.newPage()
for (const [archivo, tam, maskable] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-512.png', 512, true]]) {
  await page.setViewportSize({ width: tam, height: tam })
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${tam}px;height:${tam}px;display:block}</style>${svg(maskable)}`)
  await page.screenshot({ path: `public/icons/${archivo}`, omitBackground: true })
  console.log('ok', archivo)
}
await browser.close()
