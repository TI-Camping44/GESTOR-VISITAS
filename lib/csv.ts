'use client'
// Exporta filas a CSV que Excel abre bien en español (separador ; y BOM UTF-8).
export function descargarCsv(nombre: string, columnas: { titulo: string; valor: (f: never) => unknown }[], filas: unknown[]) {
  const celda = (v: unknown) => {
    const s = v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v)
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lineas = [columnas.map((c) => celda(c.titulo)).join(';'), ...filas.map((f) => columnas.map((c) => celda(c.valor(f as never))).join(';'))]
  const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${nombre}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
