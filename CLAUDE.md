# Gestor de Visitas y Rutas (C44 · vis)

El plan completo está en `BRIEF.md`. Trabajar por fases y **parar al final de cada una** hasta que Facundo confirme.

## Estado (12/10/2026)

- **Sync con Odoo (22/10, Facundo pidió activarlo):** corre en Vercel (este entorno no llega a Odoo). `lib/sync/odoo.ts` (+ reglas puras en `lib/sync/reglas.ts`, tests en `tests/sync.test.ts`): vendedores por email (res.users.login ↔ vis_vendedores.email → `odoo_user_id`), ventas por cliente (última factura, 6 meses) y clientes (facturaron en 2 años, ya en la app, o cartera de un vendedor de la app). Vendedor del cliente = el de su última factura de 12 meses; si no, el `user_id` de la ficha; si no está en la app, el que tenía; nunca le saca un cliente a un vendedor de otra empresa. No pisa ubicaciones manual/gps_visita, zonas ni notas. Panel: Sync Odoo → «Revisar conexión» / «Sincronizar ahora» (server actions, solo admin). Cron diario `/api/cron/sync` (CRON_SECRET) a las 05:00. Variables en Vercel: ODOO_URL, ODOO_DB, ODOO_USER, ODOO_API_KEY, ODOO_COMPANY_ID, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET. Pendiente: import de visitas de Odoo (`x_reportes_de_visita`) y facturas de Vitalica.
- **Fase 1 sin Odoo: hecha.** Migraciones 0001–0016 aplicadas en Supabase **GESTOR-VISITAS** (`fhbnqvqxgmukukwlyune`, São Paulo). Pantallas de vendedor y supervisor, PWA, cola offline, tracking y mapa en vivo.
- Zonas reales cargadas (0007): ciudades, semana del mes y responsable. Asunción está en dos zonas (quincenas) → esos clientes se asignan a mano.
- Extras pedidos por Facundo: Reportes con km y Excel (0008), próximas visitas pendientes y ruta sugerida (0009).
- **Mis visitas** en la app del vendedor (`/visitas`, 0015 `vis_mis_visitas`): sus visitas por día y por cliente (7/30/90 días o un día), con las que quedaron sin enviar. Solo las propias.
- **Señal débil (21/10, vendedor en la frontera):** `public/sw.js` v2 no espera la red más de 4 s (2 s en "/"): muestra la página guardada y la actualiza en segundo plano; los datos RSC fallan rápido y Next abre la página completa desde lo guardado. Con señal, la app pide «precargar» Hoy, Visitas, Mapa, Nuevo cliente y Visita con sus scripts. La visita es `/visita?c=<id>` (una copia sirve para cualquier cliente; `/visita/<id>` redirige). El cliente Supabase del navegador corta a los 12 s (fotos 60 s) → la visita va a la cola offline. Al abrir con señal se guardan cartera, resultados y jornada en IndexedDB.
- El alta de un cliente cuenta como visita (resultado "Cliente nuevo", 0011); el formulario que sigue completa esa misma visita (`visita_id`), no crea otra.
- Ciudad del alta de cliente: se elige de una lista (ciudades de las zonas). Las abreviaturas van en `vis_zonas.ciudades_alias` (0010): reconocen la zona pero no salen en la lista.
- **Multi empresa (0012, 16/10):** Camping 44 y Vitalica en la misma app. Clientes compartidos (mismos contactos de Odoo); vendedores, zonas, rutas, visitas, jornadas y en vivo separados por empresa (`vis_empresas`, `vis_vendedores.empresa_id`, `vis_zonas.empresa_id`, RLS con `vis_mi_empresa()` / `vis_vendedor_visible()`). Lo existente quedó en Camping 44. Facundo tiene `multi_empresa` y elige la empresa en el panel (`vis_cambiar_empresa`). El color de la interfaz sale de la empresa (`data-empresa`, `temaEmpresa()`): Camping 44 negro/rojo, Vitalica gris/naranja. La empresa de cada usuario (una o «Ambas» = `multi_empresa`) se elige en **Usuarios** (`/vendedores`) con `vis_asignar_empresa` (0014): solo un admin con ambas (`vis_soy_admin_multi()`); el admin de una empresa gestiona solo la suya (grants por columna + RLS). Quien tiene ambas aparece en la lista de las dos.
- **Equipos (0016, 22/10):** dentro de una empresa (`vis_equipos`; Camping 44: Mayorista y Venta externa). `vis_vendedores.equipo_id` y `vis_zonas.equipo_id` (null = todos/compartida). Cada supervisor con equipo ve solo su equipo: `vis_mi_equipo()` entra en `vis_vendedor_visible()` y en las políticas de vendedores y zonas, así rutas, visitas, jornadas, en vivo, tablero y reportes quedan por equipo. Clientes compartidos. El equipo lo cambia un admin sin equipo de esa empresa o TI (`vis_asignar_equipo`), en Usuarios; zonas desde Zonas. Mayorista: Jorge (supervisor), Humberto, Dan, Antonio y las zonas cargadas. Venta externa: Alejandro Rahi (supervisor). Un vendedor sin equipo en una empresa con equipos no lo ve ningún supervisor de equipo (aviso en Usuarios).
- **Tema claro/oscuro/automático** (`components/SelectorTema.tsx`, `data-tema` en `<html>`, script antes de pintar en `app/layout.tsx`; variante `dark` de Tailwind en `globals.css`). En el menú del panel y al pie de la app del vendedor.
- **Visitar fuera de ruta:** buscador «¿Visitar a otro cliente?» en Hoy (`components/vendedor/BuscarCliente.tsx`): cartera guardada (sin señal) + base con señal. La visita cuenta en el día y figura como fuera de ruta.
- Accesos: Diego Kemper (gerente general, supervisor, ambas, diegokemper@camping44.com.py). Camping 44: Facundo (admin, ambas), Jorge Lezcano (supervisor), Humberto Benítez, Dan Velastiqui y Antonio Fernández (vendedores). Vitalica: Sergio Divano (admin, sergiodivano@camping44.com.py) y Hugo Jara (vendedor, hugojara@vitalica.com.py, 8 clientes de su cartera de Odoo). Login con **Google** (cliente OAuth del proyecto Google Cloud `visitas-c44`; si queda como "Interno" solo entran cuentas de la organización camping44). El link por email usa el SMTP por defecto de Supabase (≈2 mails/hora): no depender de él.
- Invitaciones (Vendedores → «Enviar invitación», y sola al dar acceso): correo propio por Gmail SMTP (`lib/correo.ts`, server action `app/(admin)/vendedores/acciones.ts`) con `SMTP_USER` + `SMTP_PASS` (contraseña de aplicación) solo en Vercel. Solo un admin, solo a gente de su empresa. WhatsApp y Copiar como respaldo.
- Clientes: 365 cargados el 09/10 desde un export de Contactos de Odoo (no versionado): 108 de la cartera con vendedor en Odoo + 257 empresas con compras. Vendedor asignado por cartera o por el responsable de la zona; 88 sin vendedor (vendedores de Odoo que no están en la app, o sin ciudad). Sin facturación todavía → todos figuran "sin movimiento" hasta cargar facturas o el sync.
- Vercel: equipo C44 (`c49`), proyecto `gestion-visitas`, plan **Hobby** (cron 1×/día), región `gru1`.
- Producción: https://gestion-visitas-eight.vercel.app (rama `main`, PRs #1 a #11 mergeados). URLs de Supabase Auth configuradas. Login con Google (y link por email como respaldo).
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
