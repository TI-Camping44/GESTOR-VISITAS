# Gestor de Visitas y Rutas (C44 · vis)

El plan completo está en `BRIEF.md`. Trabajar por fases y **parar al final de cada una** hasta que Facundo confirme.

## Estado (08/10/2026)

- **Fase 0 (Odoo): script listo, sin correr.** Facundo pidió dejar Odoo para el final. `scripts/odoo-discovery.ts` + `lib/odoo.ts`. Cuando haya acceso: correr `npm run odoo:discovery`, escribir `docs/odoo-campos.md`, y recién ahí el sync (`lib/sync/*`, `/api/cron/sync`, `vercel.json` crons).
- **Fase 1 sin Odoo: hecha.** Migraciones 0001–0010 aplicadas en Supabase **GESTOR-VISITAS** (`fhbnqvqxgmukukwlyune`, São Paulo). Pantallas de vendedor y supervisor, PWA, cola offline, tracking y mapa en vivo.
- Zonas reales cargadas (0007): ciudades, semana del mes y responsable. Asunción está en dos zonas (quincenas) → esos clientes se asignan a mano.
- Extras pedidos por Facundo: Reportes con km y Excel (0008), próximas visitas pendientes y ruta sugerida (0009).
- Ciudad del alta de cliente: se elige de una lista (ciudades de las zonas). Las abreviaturas van en `vis_zonas.ciudades_alias` (0010): reconocen la zona pero no salen en la lista.
- Accesos: solo Facundo (admin). Faltan los emails de Antonio Fernández, Dan Velastiqui y Humberto Benítez.
- Vercel: equipo C44 (`c49`), proyecto `gestion-visitas`, plan **Hobby** (cron 1×/día), región `gru1`.
- Producción: https://gestion-visitas-eight.vercel.app (rama `main`, PR #1 mergeado). URLs de Supabase Auth configuradas. Login por link de email; Google OAuth pendiente.
- Piloto: **Humberto Benítez** (cambió de Antonio), semana 12–16/10 = 2da del mes → zona **Asunción 2da y 4ta**. Sus ciudades están también en Asunción 1ra y 3ra, así que los clientes se reparten a mano entre las dos quincenas. Falta su email y los clientes (Odoo o Excel exportado).

## Cómo probar

- `npm test` (lib/odoo, geo, fechas) · `npm run typecheck` · `npm run lint` · `npm run build`.
- `npm run db:test`: migraciones + RLS en un Postgres 16 local con PostGIS que imita Supabase
  (`PGHOST=/tmp PGPORT=54329 PGUSER=postgres`). Saltea `*_cron.sql` y `*_fotos.sql`.
- Aplicar migraciones nuevas con el conector de Supabase (`apply_migration`), en orden, y regenerar `lib/database.types.ts`.

## Reglas que no se negocian

1. Credenciales de Odoo solo del lado servidor. Nunca en el bundle, nunca `NEXT_PUBLIC_*`, nunca en el repo, nunca en el chat. No imprimir ni leer `.env.local`.
2. **Cero escrituras a Odoo.** `lib/odoo.ts` solo permite `search_read`, `read_group`, `search_count`, `fields_get`. Si hace falta otra cosa, parar y preguntar.
3. `fields` declarado en todo `search_read`. Paginar de a 500–1000.
4. many2one vuelve `[id, "nombre"]` o `false` → normalizar con `m2o()`.
5. Fechas de Odoo en UTC → convertir a `America/Asuncion` antes de comparar.
6. Pasar `allowed_company_ids: [ODOO_COMPANY_ID]` en cada llamada (lo hace `odooCall`).
7. Todo job que falle, falla ruidoso (`vis_sync_log.ok=false` + aviso en el panel admin).
8. Migraciones SQL versionadas en `supabase/migrations/`. Nada de cambios de esquema a mano.
9. UI en español (Paraguay), fechas `dd/MM/yyyy`, zona `America/Asuncion`, Gs. sin decimales.
10. `.discovery/` tiene datos reales de clientes: está en `.gitignore`, no se versiona ni se copia a `docs/`.

## Comandos

```bash
npm install
npm run odoo:discovery   # lee ODOO_* del entorno o de .env.local
npm test                 # lista blanca de lib/odoo.ts, paginación, errores
npm run typecheck
```

Variables mínimas para el descubrimiento: `ODOO_DB`, `ODOO_USER`, `ODOO_API_KEY` (y `ODOO_URL=https://camping44.odoo.com`). `ODOO_COMPANY_ID` puede quedar vacío: el reporte lista las compañías.
