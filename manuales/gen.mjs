// Genera los manuales en PDF (A4) desde contenido.mjs y las capturas de img/.
import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync } from 'node:fs'
import { MANUALES } from './contenido.mjs'

const DIR = new URL('.', import.meta.url).pathname
const SALIDA = `${DIR}salida/Manuales`
mkdirSync(SALIDA, { recursive: true })
const COLOR = { c44: { marca: '#d90000', oscuro: '#141414', claro: '#fdecec', empresa: 'Camping 44' }, vit: { marca: '#b4520a', oscuro: '#3a3a3a', claro: '#fbf0e6', empresa: 'Vitalica' } }
const fecha = new Intl.DateTimeFormat('es-PY', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Asuncion' }).format(new Date())
const img = (f) => `data:image/jpeg;base64,${readFileSync(`${DIR}salida/img/${f}.jpg`).toString('base64')}`

function html(m) {
  const c = COLOR[m.empresa]
  const caps = m.caps.map((cap, i) => {
    const imgs = (cap.img ?? []).map(([f, epi]) => `<figure class="${cap.m ? 'movil' : 'panel'}"><img src="${img(f)}"><figcaption>${epi}</figcaption></figure>`).join('')
    const junta = cap.m ? (cap.img ?? []).length <= 3 : (cap.img ?? []).length <= 1
    return `<section class="${junta ? 'junta' : ''}">
      <h2><span class="n">${i + 1}</span>${cap.t}</h2>
      ${(cap.p ?? []).map((x) => `<p>${x}</p>`).join('')}
      ${cap.pasos ? `<ol>${cap.pasos.map((x) => `<li>${x}</li>`).join('')}</ol>` : ''}
      ${cap.nota ? `<div class="nota"><b>Tené en cuenta:</b> ${cap.nota}</div>` : ''}
      ${cap.ojo ? `<div class="ojo"><b>Ojo:</b> ${cap.ojo}</div>` : ''}
      ${imgs ? `<div class="figs ${cap.m ? 'fila' : ''}">${imgs}</div>` : ''}
    </section>`
  }).join('')
  return `<!doctype html><html lang="es-PY"><head><meta charset="utf-8"><title>${m.archivo}</title>
<style>
  @page { size: A4; margin: 16mm 15mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: 'IBM Plex Sans', 'Liberation Sans', Arial, sans-serif; color: #1c1c1c; font-size: 10.5pt; line-height: 1.5; margin: 0; }
  .portada { height: 255mm; display: flex; flex-direction: column; page-break-after: always; }
  .banda { background: ${c.oscuro}; color: #fff; border-radius: 6mm; padding: 14mm 12mm 12mm; }
  .banda .emp { color: ${c.marca === '#d90000' ? '#ff5a5a' : '#ffbe8a'}; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; font-size: 10pt; }
  .banda h1 { font-size: 30pt; line-height: 1.15; margin: 4mm 0 2mm; }
  .banda .para { font-size: 12pt; opacity: .85; }
  .app { margin-top: 3mm; font-size: 10pt; opacity: .75; }
  .indice { margin-top: 10mm; columns: 2; column-gap: 10mm; }
  .indice h3 { column-span: all; font-size: 12pt; margin: 0 0 3mm; color: ${c.marca}; }
  .indice div { break-inside: avoid; padding: 1.4mm 0; border-bottom: 0.3mm solid #e6e6e6; }
  .indice span { display: inline-block; width: 8mm; font-weight: 700; color: ${c.marca}; }
  .pie { margin-top: auto; font-size: 9pt; color: #6b6b6b; }
  section { break-inside: auto; margin-bottom: 7mm; }
  section.junta { break-inside: avoid; }
  h2 { font-size: 15pt; margin: 0 0 2.5mm; display: flex; align-items: center; gap: 3mm; break-after: avoid; color: #111; }
  h2 .n { flex: none; display: inline-grid; place-items: center; width: 8.5mm; height: 8.5mm; border-radius: 50%; background: ${c.marca}; color: #fff; font-size: 11pt; }
  p { margin: 0 0 2mm; }
  ol { margin: 0 0 2.5mm; padding-left: 6mm; }
  li { margin-bottom: 1mm; }
  b { color: #000; }
  .nota, .ojo { border-radius: 2.5mm; padding: 2.5mm 3.5mm; margin: 2mm 0 3mm; font-size: 9.8pt; break-inside: avoid; }
  .nota { background: ${c.claro}; border-left: 1.2mm solid ${c.marca}; }
  .ojo { background: #fff6dd; border-left: 1.2mm solid #d9a400; }
  .figs { display: flex; flex-direction: column; gap: 4mm; margin-top: 3mm; }
  .figs.fila { flex-direction: row; flex-wrap: wrap; gap: 5mm; }
  figure { margin: 0; break-inside: avoid; }
  figure.movil { width: 54mm; }
  figure.movil img { width: 54mm; border-radius: 4mm; border: 0.4mm solid #d6d6d6; display: block; max-height: 118mm; object-fit: cover; object-position: top; }
  figure.panel img { width: 100%; border-radius: 2mm; border: 0.3mm solid #d6d6d6; display: block; }
  figcaption { font-size: 8.8pt; color: #555; margin-top: 1.2mm; }
</style></head><body>
  <div class="portada">
    <div class="banda">
      <div class="emp">${c.empresa} · Visitas y rutas</div>
      <h1>${m.titulo}</h1>
      <div class="para">${m.para}</div>
      <div class="app">gestion-visitas-eight.vercel.app · actualizado al ${fecha}</div>
    </div>
    <div class="indice"><h3>Contenido</h3>${m.caps.map((cap, i) => `<div><span>${i + 1}</span>${cap.t}</div>`).join('')}</div>
    <div class="pie">Las capturas usan datos de ejemplo: los nombres de clientes, médicos y lugares no son reales.</div>
  </div>
  ${caps}
</body></html>`
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' })
const page = await browser.newPage()
for (const m of MANUALES) {
  const h = html(m)
    await page.setContent(h, { waitUntil: 'load' })
  await page.pdf({ path: `${SALIDA}/${m.archivo}.pdf`, format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: `<div style="font-size:8px;color:#888;width:100%;padding:0 15mm;display:flex;justify-content:space-between;font-family:Arial"><span>${m.archivo}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    margin: { top: '16mm', bottom: '18mm', left: '15mm', right: '15mm' } })
  console.log('✓', m.archivo)
}
await browser.close()
