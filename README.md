# Gestor de Visitas y Rutas (C44 · vis)

App web (PWA) para planificar rutas y registrar visitas de vendedores. Lee de Odoo 17, **nunca escribe**; los datos propios viven en Supabase.

## Fase 0 — Descubrimiento en Odoo

Requiere Node 22+ y las variables `ODOO_*` (en el entorno o en `.env.local`, ver `.env.example`).

```bash
npm install
npm run odoo:discovery     # = npx tsx scripts/odoo-discovery.ts
```

Escribe `.discovery/odoo-discovery-<fecha>.md` y `.discovery/fields-<modelo>.json`. Esa carpeta está en `.gitignore` porque tiene datos reales de clientes. El mapeo revisado va a `docs/odoo-campos.md`.

## Tests

```bash
npm test          # lista blanca de métodos de lib/odoo.ts, paginación, errores
npm run typecheck
```
