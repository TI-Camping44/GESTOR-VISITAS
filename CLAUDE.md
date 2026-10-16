# Gestor de Visitas y Rutas (C44 · vis)

El plan completo está en `BRIEF.md`. Trabajar por fases y **parar al final de cada una** hasta que Facundo confirme.

## Estado (12/10/2026)

- **Fase 0 (Odoo): script listo, sin correr.** Facundo pidió dejar Odoo para el final. `scripts/odoo-discovery.ts` + `lib/odoo.ts`. Cuando haya acceso: correr `npm run odoo:discovery`, escribir `docs/odoo-campos.md`, y recién ahí el sync (`lib/sync/*`, `/api/cron/sync`, `vercel.json` crons).
- **Fase 1 sin Odoo: hecha.** Migraciones 0001–0013 aplicadas en Supabase **GESTOR-VISITAS** (`fhbnqvqxgmukukwlyune`, São Paulo). Pantallas de vendedor y supervisor, PWA, cola offline, tracking y mapa en vivo.
- Zonas reales cargadas (0007): ciudades, semana del mes y responsable. Asunción está en dos zonas (quincenas) → esos clientes se asignan a mano.
- Extras pedidos por Facundo: Reportes con km y Excel (0008), próximas visitas pendientes y ruta sugerida (0009).
- El alta de un cliente cuenta como visita (resultado "Cliente nuevo", 0011); el formulario que sigue completa esa misma visita (`visita_id`), no crea otra.
- Ciudad del alta de cliente: se elige de una lista (ciudades de las zonas). Las abreviaturas van en `vis_zonas.ciudades_alias` (0010): reconocen la zona pero no salen en la lista.
- **Multi empresa (0012, 16/10):** Camping 44 y Vitalica en la misma app. Clientes compartidos (mismos contactos de Odoo); vendedores, zonas, rutas, visitas, jornadas y en vivo separados por empresa (`vis_empresas`, `vis_vendedores.empresa_id`, `vis_zonas.empresa_id`, RLS con `vis_mi_empresa()` / `vis_vendedor_visible()`). Lo existente quedó en Camping 44. Facundo tiene `multi_empresa` y elige la empresa en el panel (`vis_cambiar_empresa`). El color de la interfaz sale de la empresa (`data-empresa`, `temaEmpresa()`): Camping 44 negro/rojo, Vitalica gris/naranja. Un admin no puede tocar `empresa_id` ni `multi_empresa` (grants por columna): eso va por SQL.
- Accesos Camping 44: Facundo (admin, multi empresa), Jorge Lezcano (supervisor), Humberto Benítez, Dan Velastiqui y Antonio Fernández (vendedores). Vitalica: Sergio Divano (admin, sergiodivano@camping44.com.py) y Hugo Jara (vendedor, hugojara@vitalica.com.py, 8 clientes de su cartera de Odoo). Login con **Google** (cliente OAuth del proyecto Google Cloud `visitas-c44`; si queda como "Interno" solo entran cuentas de la organización camping44). El link por email usa el SMTP por defecto de Supabase (≈2 mails/hora): no depender de él.
- Invitaciones (Vendedores → «Enviar invitación», y sola al dar acceso): correo propio por Gmail SMTP (`lib/correo.ts`, server action `app/(admin)/vendedores/acciones.ts`) con `SMTP_USER` + `SMTP_PASS` (contraseña de aplicación) solo en Vercel. Solo un admin, solo a gente de su empresa. WhatsApp y Copiar como respaldo.
- Clientes: 365 cargados el 09/10 desde un export de Contactos de Odoo (no versionado): 108 de la cartera con vendedor en Odoo + 257 empresas con compras. Vendedor asignado por cartera o por el responsable de la zona; 88 sin vendedor (vendedores de Odoo que no están en la app, o sin ciudad). Sin facturación todavía → todos figuran "sin movimiento" hasta cargar facturas o el sync.
- Vercel: equipo C44 (`c49`), proyecto `gestion-visitas`, plan **Hobby** (cron 1×/día), región `gru1`.
- Producción: https://gestion-visitas-eight.vercel.app (rama `main`, PRs #1 a #5 mergeados). URLs de Supabase Auth configuradas. Login con Google (y link por email como respaldo).
- Piloto: **Humberto Benítez** (cambió de Antonio), semana 12–16/10 = 2da del mes → zona **Asunción 2da y 4ta**. Sus ciudades están también en Asunción 1ra y 3ra, así que los clientes se reparten a mano entre las dos quincenas. Pendiente: decidir cómo se reparten los clientes de Asunción/Central entre las dos quincenas (hoy sin zona, todos de Humberto).

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
