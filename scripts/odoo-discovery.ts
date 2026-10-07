/**
 * Fase 0 — Descubrimiento de campos en Odoo (SOLO LECTURA).
 *
 *   npx tsx scripts/odoo-discovery.ts
 *
 * Lee las variables ODOO_* del entorno (o de .env.local si existe) y escribe:
 *   .discovery/odoo-discovery-<fecha>.md   reporte para armar docs/odoo-campos.md
 *   .discovery/fields-<modelo>.json        fields_get completo de cada modelo
 *
 * .discovery/ está en .gitignore: el reporte trae datos reales de clientes.
 * Si alguna sección falla, el reporte lo dice y el script sale con código 1.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { m2o, odooCall, odooConfig, odooLogin, odooVersion, searchReadAll } from '../lib/odoo';

try {
  process.loadEnvFile('.env.local');
} catch {
  // Sin .env.local: se usan las variables del entorno.
}

const TZ = 'America/Asuncion';
const MODELO_VISITAS = 'x_reportes_de_visita';
const DOMINIO_CLIENTES = [['customer_rank', '>', 0], ['parent_id', '=', false], ['active', '=', true]];

type Meta = {
  string: string;
  type: string;
  relation?: string;
  required?: boolean;
  readonly?: boolean;
  store?: boolean;
  selection?: [string, string][];
};
type Campos = Record<string, Meta>;
type Fila = Record<string, unknown>;

// ── Reporte ────────────────────────────────────────────────────────────────
const md: string[] = [];
const avisos: string[] = [];
const errores: string[] = [];

const celda = (v: unknown) => String(v ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ⏎ ');
const recortar = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const tabla = (cab: string[], filas: unknown[][]) => {
  md.push(`| ${cab.join(' | ')} |`, `|${cab.map(() => '---').join('|')}|`);
  for (const f of filas) md.push(`| ${f.map(celda).join(' | ')} |`);
  md.push('');
};
const json = (v: unknown) => md.push('```json', JSON.stringify(v, null, 2), '```', '');
const aviso = (s: string) => {
  avisos.push(s);
  md.push(`> ⚠️ ${s}`, '');
};

async function seccion(titulo: string, fn: () => Promise<void>) {
  md.push(`## ${titulo}`, '');
  process.stdout.write(`• ${titulo}… `);
  try {
    await fn();
    console.log('ok');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errores.push(`${titulo}: ${msg}`);
    md.push(`> ❌ **Error**: ${celda(msg)}`, '');
    console.log(`ERROR\n    ${msg}`);
  }
}

// ── Utilidades ─────────────────────────────────────────────────────────────
const sinAcentos = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Valor "vacío" en Odoo: false, null, '', 0, []. */
const vacio = (v: unknown) => v === false || v === null || v === undefined || v === '' || v === 0 || (Array.isArray(v) && v.length === 0);

/** Clave legible de un valor para contar distintos. */
function clave(v: unknown): string {
  const r = m2o(v);
  if (r) return `${r.name} [${r.id}]`;
  if (Array.isArray(v)) return `[${v.join(', ')}]`;
  if (typeof v === 'string') return v.trim();
  return String(v);
}

function contar(filas: Fila[], campo: string, meta?: Meta): [string, number][] {
  const etiquetas = new Map(meta?.selection ?? []);
  const m = new Map<string, number>();
  for (const f of filas) {
    const v = f[campo];
    const k = vacio(v) && v !== 0 ? '(vacío)' : etiquetas.has(String(v)) ? `${String(v)} (${etiquetas.get(String(v))})` : clave(v);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function hoyAsuncion(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function haceMeses(fechaIso: string, meses: number): string {
  const [y, m, d] = fechaIso.split('-').map(Number);
  const f = new Date(Date.UTC(y!, m! - 1 - meses, d!));
  return f.toISOString().slice(0, 10);
}

const NO_LEIBLES = new Set(['binary', 'one2many', 'html']);

async function fieldsGet(modelo: string): Promise<Campos> {
  const campos = await odooCall<Campos>(modelo, 'fields_get', [], {
    attributes: ['string', 'type', 'relation', 'required', 'readonly', 'store', 'selection'],
  });
  writeFileSync(join(DIR, `fields-${modelo}.json`), JSON.stringify(campos, null, 2));
  return campos;
}

function tablaEsperados(campos: Campos, esperados: string[]) {
  const faltan = esperados.filter((c) => !campos[c]);
  tabla(
    ['Campo', '¿Existe?', 'Tipo', 'Etiqueta', 'Relación', 'Almacenado'],
    esperados.map((c) => {
      const m = campos[c];
      return m ? [`\`${c}\``, '✅', m.type, m.string, m.relation ?? '', m.store === false ? 'no' : 'sí'] : [`\`${c}\``, '❌ NO', '', '', '', ''];
    }),
  );
  if (faltan.length) aviso(`Campos esperados que no existen: ${faltan.map((c) => `\`${c}\``).join(', ')}`);
}

function tablaCampos(campos: Campos, filtro: (nombre: string, m: Meta) => boolean) {
  const filas = Object.entries(campos)
    .filter(([n, m]) => filtro(n, m))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([n, m]) => [
      `\`${n}\``,
      m.type,
      m.string,
      m.relation ?? '',
      m.store === false ? 'no' : 'sí',
      m.selection?.length ? m.selection.map(([k, v]) => `${k}=${v}`).join('; ') : '',
    ]);
  if (!filas.length) {
    md.push('_Ninguno._', '');
    return;
  }
  tabla(['Campo', 'Tipo', 'Etiqueta', 'Relación', 'Almacenado', 'Opciones (selection)'], filas);
}

const legibles = (campos: Campos, nombres: string[]) => nombres.filter((c) => campos[c] && !NO_LEIBLES.has(campos[c]!.type));

// ── Main ───────────────────────────────────────────────────────────────────
const DIR = '.discovery';

async function main() {
  mkdirSync(DIR, { recursive: true });
  const cfg = odooConfig();
  const ahora = new Date();
  const sello = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }).format(ahora).replace(/[: ]/g, '').replace(/-/g, '');
  const hoy = hoyAsuncion();
  const desde6m = haceMeses(hoy, 6);

  md.push(
    '# Descubrimiento Odoo — reporte crudo',
    '',
    `- Generado: ${new Intl.DateTimeFormat('es-PY', { timeZone: TZ, dateStyle: 'short', timeStyle: 'medium' }).format(ahora)} (${TZ})`,
    `- Servidor: ${cfg.url} · base \`${cfg.db}\` · usuario \`${cfg.user}\``,
    `- ODOO_COMPANY_ID: ${cfg.companyId ?? '(sin definir — se lee sin filtro de compañía)'}`,
    `- "Últimos 6 meses" = desde ${desde6m} (hoy en Asunción: ${hoy})`,
    '',
    '> Reporte generado por `scripts/odoo-discovery.ts`. Contiene datos reales: no se versiona.',
    '',
  );
  if (cfg.companyId === null) aviso('ODOO_COMPANY_ID no está definido. Elegí el id de Camping 44 S.A. de la tabla de compañías.');

  // 1. Conexión
  let uid = 0;
  await seccion('1. Conexión y usuario técnico', async () => {
    const v = await odooVersion();
    uid = await odooLogin();
    md.push(`- Versión del servidor: \`${String(v.server_version ?? '?')}\``, `- UID del usuario técnico: ${uid}`, '');
    const [u] = await odooCall<Fila[]>('res.users', 'search_read', [[['id', '=', uid]]], {
      fields: ['name', 'login', 'company_id', 'company_ids', 'share'],
    });
    if (u) md.push(`- Nombre: ${u.name} · login: ${u.login} · compañía actual: ${clave(u.company_id)} · compañías permitidas: ${clave(u.company_ids)}`, '');
    try {
      const grupos = await odooCall<Fila[]>('res.groups', 'search_read', [[['users', 'in', [uid]]]], { fields: ['full_name'], order: 'full_name asc' });
      md.push('**Grupos del usuario técnico:**', '', ...grupos.map((g) => `- ${g.full_name}`), '');
      const admin = grupos.filter((g) => /administra|settings|ajustes|configuraci/i.test(String(g.full_name)));
      if (admin.length) aviso(`El usuario técnico tiene grupos de administración (${admin.map((g) => g.full_name).join(', ')}). Debería ser un usuario de solo lectura.`);
    } catch (e) {
      md.push(`_No se pudieron leer los grupos: ${celda(e instanceof Error ? e.message : e)}_`, '');
    }
  });
  if (!uid) throw new Error('Sin login no hay nada más que descubrir.');

  // 2. Compañías
  await seccion('2. Compañías (para ODOO_COMPANY_ID)', async () => {
    const cias = await odooCall<Fila[]>('res.company', 'search_read', [[]], {
      fields: ['id', 'name', 'vat', 'currency_id'],
      order: 'id asc',
      context: { allowed_company_ids: undefined },
    });
    tabla(['id', 'Nombre', 'RUC', 'Moneda'], cias.map((c) => [c.id, c.name, c.vat || '', clave(c.currency_id)]));
  });

  // 3. res.partner
  let camposPartner: Campos = {};
  await seccion('3. res.partner (clientes)', async () => {
    camposPartner = await fieldsGet('res.partner');
    const esperados = ['id', 'name', 'vat', 'phone', 'mobile', 'street', 'street2', 'city', 'state_id', 'country_id', 'partner_latitude', 'partner_longitude', 'user_id', 'category_id', 'customer_rank', 'is_company', 'parent_id', 'commercial_partner_id', 'create_date', 'write_date', 'active'];
    tablaEsperados(camposPartner, esperados);

    md.push('### Campos que parecen coordenadas', '');
    tablaCampos(camposPartner, (n, m) => /lat|lng|lon|coord|gps|geo/i.test(`${n} ${m.string}`));
    md.push('### Campos personalizados (`x_*`)', '');
    tablaCampos(camposPartner, (n) => n.startsWith('x_'));

    const total = await odooCall<number>('res.partner', 'search_count', [DOMINIO_CLIENTES]);
    const filas: unknown[][] = [['Clientes (customer_rank>0, sin padre, activos)', total]];
    if (camposPartner.partner_latitude) {
      const conCoord = await odooCall<number>('res.partner', 'search_count', [[...DOMINIO_CLIENTES, '|', ['partner_latitude', '!=', 0], ['partner_longitude', '!=', 0]]]);
      filas.push(['… con partner_latitude/longitude ≠ 0', conCoord]);
    }
    filas.push(['… con vendedor (user_id)', await odooCall<number>('res.partner', 'search_count', [[...DOMINIO_CLIENTES, ['user_id', '!=', false]]])]);
    filas.push(['… con RUC (vat)', await odooCall<number>('res.partner', 'search_count', [[...DOMINIO_CLIENTES, ['vat', '!=', false]]])]);
    filas.push(['… creados en los últimos 6 meses', await odooCall<number>('res.partner', 'search_count', [[...DOMINIO_CLIENTES, ['create_date', '>=', `${desde6m} 00:00:00`]]])]);
    md.push('### Conteos', '');
    tabla(['Qué', 'Cantidad'], filas);

    for (const [campo, titulo] of [['user_id', 'Clientes por vendedor (user_id)'], ['state_id', 'Clientes por departamento (state_id)'], ['city', 'Clientes por ciudad (city) — top 60']] as const) {
      const grupos = await odooCall<Fila[]>('res.partner', 'read_group', [DOMINIO_CLIENTES, [campo], [campo]], { lazy: false, orderby: '__count desc' });
      md.push(`### ${titulo}`, '');
      tabla([campo, 'Clientes'], grupos.slice(0, 60).map((g) => [vacio(g[campo]) ? '(vacío)' : clave(g[campo]), g.__count]));
    }

    const muestra = await odooCall<Fila[]>('res.partner', 'search_read', [DOMINIO_CLIENTES], {
      fields: legibles(camposPartner, esperados),
      limit: 5,
      order: 'write_date desc',
    });
    md.push('### Muestra (5 clientes modificados más recientemente)', '');
    json(muestra);
  });

  // 4. account.move
  await seccion('4. account.move (facturación)', async () => {
    const campos = await fieldsGet('account.move');
    tablaEsperados(campos, ['move_type', 'state', 'invoice_date', 'commercial_partner_id', 'partner_id', 'amount_untaxed_signed', 'amount_total_signed', 'company_id', 'currency_id']);

    const base = [['move_type', '=', 'out_invoice'], ['state', '=', 'posted']];
    const porCia = await odooCall<Fila[]>('account.move', 'read_group', [base, ['company_id', 'amount_untaxed_signed:sum', 'primera:min(invoice_date)', 'ultima:max(invoice_date)'], ['company_id']], { lazy: false });
    md.push('### Facturas de cliente publicadas, por compañía (histórico)', '');
    tabla(['Compañía', 'Facturas', 'Base imponible (Gs.)', 'Primera', 'Última'], porCia.map((g) => [clave(g.company_id), g.__count, Math.round(Number(g.amount_untaxed_signed ?? 0)).toLocaleString('es-PY'), g.primera || '', g.ultima || '']));

    const dom6m = [...base, ['invoice_date', '>=', desde6m], ...(cfg.companyId !== null ? [['company_id', '=', cfg.companyId]] : [])];
    const porCliente = await odooCall<Fila[]>('account.move', 'read_group', [dom6m, ['commercial_partner_id', 'amount_untaxed_signed:sum'], ['commercial_partner_id']], { lazy: false });
    const total = porCliente.reduce((s, g) => s + Number(g.amount_untaxed_signed ?? 0), 0);
    md.push(
      '### Últimos 6 meses',
      '',
      `- Clientes comerciales con al menos una factura publicada: **${porCliente.length}** (vista previa de los 🟢 activos)`,
      `- Facturas: ${porCliente.reduce((s, g) => s + Number(g.__count ?? 0), 0)} · base imponible: Gs. ${Math.round(total).toLocaleString('es-PY')}`,
      cfg.companyId === null ? '- ⚠️ Sin ODOO_COMPANY_ID: incluye todas las compañías.' : `- Filtrado por company_id = ${cfg.companyId}.`,
      '',
    );

    const muestra = await odooCall<Fila[]>('account.move', 'search_read', [base], {
      fields: legibles(campos, ['id', 'name', 'move_type', 'state', 'invoice_date', 'partner_id', 'commercial_partner_id', 'amount_untaxed_signed', 'company_id']),
      limit: 3,
      order: 'invoice_date desc',
    });
    md.push('### Muestra (3 facturas más recientes)', '');
    json(muestra);
  });

  // 5. x_reportes_de_visita
  let camposVis: Campos = {};
  let visitas: Fila[] = [];
  const usuariosVisitas = new Set<number>();
  await seccion(`5. ${MODELO_VISITAS} (visitas cargadas en Studio)`, async () => {
    camposVis = await fieldsGet(MODELO_VISITAS);
    const conocidos = ['x_name', 'x_studio_cliente', 'x_studio_date', 'x_studio_latitud', 'x_studio_longitud', 'x_studio_lat_visita', 'x_studio_long_visita', 'x_studio_gps_visita', 'x_studio_precisin_m', 'x_studio_distancia_al_cliente_m', 'x_studio_capturado_el', 'x_studio_capturado_por', 'x_studio_hizo_cobranza', 'x_studio_monto_cobrado', 'x_studio_foto_fachada_cliente'];
    md.push('### Campos ya conocidos', '');
    tablaEsperados(camposVis, conocidos);
    md.push('### Todos los campos personalizados (`x_*`)', '');
    tablaCampos(camposVis, (n) => n.startsWith('x_'));

    const leer = [...new Set(['id', 'create_uid', 'create_date', 'write_uid', 'write_date', ...Object.keys(camposVis).filter((n) => n.startsWith('x_'))])];
    visitas = await searchReadAll(MODELO_VISITAS, [], legibles(camposVis, leer), { pageSize: 500 });
    md.push(`**Registros leídos:** ${visitas.length}`, '');

    // Candidatos para los campos "a descubrir"
    const conceptos: [string, RegExp][] = [
      ['Responsable / Vendedor', /respons|vendedor|usuario|user|asesor|comercial|capturado_por/],
      ['Observaciones', /observ|coment|nota|detalle|resultado|motivo/],
      ['Teléfono', /tel|phone|celular|movil|whatsapp/],
      ['Zona / Ciudad', /zona|ciudad|city|barrio|depart|localidad|region/],
      ['Tipo de cliente', /tipo|categ|clase|segment/],
      ['¿Hizo pedido?', /pedido|order|venta/],
      ['Próxima visita', /proxim|siguiente|next|seguimiento/],
    ];
    md.push('### Candidatos para los campos a descubrir', '', '_Detectados por nombre técnico y etiqueta. Hay que confirmarlos a ojo con los valores de abajo._', '');
    tabla(
      ['Concepto', 'Candidatos'],
      conceptos.map(([concepto, re]) => {
        const cands = Object.entries(camposVis)
          .filter(([n, m]) => re.test(sinAcentos(`${n} ${m.string}`)) || (concepto.startsWith('Responsable') && m.relation === 'res.users'))
          .map(([n, m]) => `\`${n}\` (${m.type}${m.relation ? ` → ${m.relation}` : ''}, "${m.string}")`);
        return [concepto, cands.join('<br>') || '—'];
      }),
    );

    // Estadística por campo
    md.push('### Llenado y valores por campo', '');
    tabla(
      ['Campo', 'Tipo', 'Etiqueta', 'Con valor', 'Distintos', 'Valores más frecuentes'],
      legibles(camposVis, leer).map((n) => {
        const cuenta = contar(visitas, n, camposVis[n]);
        const conValor = visitas.filter((f) => !vacio(f[n])).length;
        const top = cuenta.filter(([k]) => k !== '(vacío)').slice(0, 5).map(([k, c]) => `${recortar(k, 40)} (${c})`).join('; ');
        return [`\`${n}\``, camposVis[n]!.type, camposVis[n]!.string, `${conValor} / ${visitas.length}`, cuenta.length, top];
      }),
    );

    // x_name: zona en texto libre
    md.push('### Valores distintos de `x_name` (hoy se usa como zona)', '');
    tabla(
      ['x_name', 'Visitas', 'Parece'],
      contar(visitas, 'x_name').map(([valor, c]) => {
        const v = sinAcentos(valor);
        const esCliente = visitas.some((f) => f.x_name && sinAcentos(String(f.x_name).trim()) === v && m2o(f.x_studio_cliente) && sinAcentos(m2o(f.x_studio_cliente)!.name).includes(v));
        return [valor, c, /^zona\b/.test(v) ? 'zona' : esCliente ? 'nombre del cliente' : '?'];
      }),
    );

    // Valores distintos completos de los candidatos a Observaciones
    const obs = Object.entries(camposVis).filter(([n, m]) => /observ|coment|nota|detalle|resultado|motivo/.test(sinAcentos(`${n} ${m.string}`)) && !NO_LEIBLES.has(m.type));
    for (const [n, m] of obs) {
      md.push(`### Valores distintos de \`${n}\` ("${m.string}", ${m.type})`, '');
      if (m.selection?.length) md.push(`Opciones definidas: ${m.selection.map(([k, v]) => `\`${k}\`=${v}`).join(', ')}`, '');
      tabla(['Valor', 'Visitas'], contar(visitas, n, m).map(([k, c]) => [recortar(k, 200), c]));
    }

    // GPS
    const gpsOk = visitas.filter((f) => Number(f.x_studio_lat_visita) && Number(f.x_studio_long_visita)).length;
    const dirOk = visitas.filter((f) => Number(f.x_studio_latitud) && Number(f.x_studio_longitud)).length;
    md.push('### Coordenadas', '', `- Con GPS de la visita (lat/long_visita ≠ 0): **${gpsOk} / ${visitas.length}**`, `- Con coordenadas de la dirección del cliente (latitud/longitud ≠ 0): **${dirOk} / ${visitas.length}**`, '');

    // Rango de fechas
    for (const campo of ['x_studio_date', 'x_studio_capturado_el', 'create_date']) {
      if (!camposVis[campo]) continue;
      const vals = visitas.map((f) => f[campo]).filter((v): v is string => typeof v === 'string' && !!v).sort();
      md.push(`- \`${campo}\` (${camposVis[campo]!.type}): ${vals[0] ?? '—'} → ${vals.at(-1) ?? '—'}${camposVis[campo]!.type === 'datetime' ? ' (UTC)' : ''}`);
    }
    md.push('');

    for (const [n, m] of Object.entries(camposVis)) {
      if (m.relation !== 'res.users') continue;
      for (const f of visitas) {
        const r = m2o(f[n]);
        if (r) usuariosVisitas.add(r.id);
      }
    }

    md.push('### Muestra (5 visitas más recientes)', '');
    json([...visitas].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 5));
  });

  // 6. Clientes de las visitas: ¿son entidades comerciales o contactos hijos?
  await seccion('6. Clientes referenciados por las visitas', async () => {
    const campoCliente = camposVis.x_studio_cliente;
    if (!campoCliente) throw new Error('x_studio_cliente no existe en el modelo de visitas.');
    md.push(`\`x_studio_cliente\` es ${campoCliente.type} → ${campoCliente.relation ?? '?'}`, '');
    const ids = [...new Set(visitas.map((f) => m2o(f.x_studio_cliente)?.id).filter((id): id is number => !!id))];
    const partners = ids.length
      ? await searchReadAll<Fila>('res.partner', [['id', 'in', ids]], ['id', 'name', 'parent_id', 'commercial_partner_id', 'customer_rank', 'active'], { context: { active_test: false } })
      : [];
    const hijos = partners.filter((p) => m2o(p.parent_id));
    tabla(
      ['Qué', 'Cantidad'],
      [
        ['Visitas sin cliente', visitas.filter((f) => !m2o(f.x_studio_cliente)).length],
        ['Clientes distintos visitados', ids.length],
        ['… que son contactos hijos (parent_id ≠ false) → mapear a commercial_partner_id', hijos.length],
        ['… con customer_rank = 0', partners.filter((p) => !Number(p.customer_rank)).length],
        ['… archivados', partners.filter((p) => p.active === false).length],
      ],
    );
  });

  // 7. Vendedores
  await seccion('7. Vendedores (res.users)', async () => {
    const grupos = await odooCall<Fila[]>('res.partner', 'read_group', [[...DOMINIO_CLIENTES, ['user_id', '!=', false]], ['user_id'], ['user_id']], { lazy: false });
    const deClientes = new Map(grupos.flatMap((g) => { const u = m2o(g.user_id); return u ? [[u.id, Number(g.__count)] as const] : []; }));
    const visitasPorUsuario = new Map<number, number>();
    const camposUsuario = Object.entries(camposVis).filter(([n, m]) => m.relation === 'res.users' && n !== 'write_uid').map(([n]) => n);
    for (const f of visitas) {
      for (const n of camposUsuario) {
        const r = m2o(f[n]);
        if (r) visitasPorUsuario.set(r.id, (visitasPorUsuario.get(r.id) ?? 0) + 1);
      }
    }
    const ids = [...new Set([...deClientes.keys(), ...usuariosVisitas])];
    const usuarios = ids.length
      ? await searchReadAll<Fila>('res.users', [['id', 'in', ids]], ['id', 'name', 'login', 'active', 'share'], { context: { active_test: false }, order: 'name asc' })
      : [];
    md.push(`Campos de visitas que apuntan a res.users: ${camposUsuario.map((n) => `\`${n}\``).join(', ') || '—'}`, '');
    tabla(
      ['id', 'Nombre', 'Login', 'Activo', 'Clientes asignados', 'Apariciones en visitas'],
      usuarios.map((u) => [u.id, u.name, u.login, u.active ? 'sí' : 'no', deClientes.get(Number(u.id)) ?? 0, visitasPorUsuario.get(Number(u.id)) ?? 0]),
    );
  });

  // Resumen arriba del reporte
  const resumen = [
    '## Resumen',
    '',
    errores.length ? `❌ **${errores.length} sección(es) con error:**` : '✅ Todas las secciones se leyeron sin error.',
    ...errores.map((e) => `- ${celda(e)}`),
    ...(avisos.length ? ['', '**Avisos:**', ...avisos.map((a) => `- ${a}`)] : []),
    '',
  ];
  const indice = md.findIndex((l) => l.startsWith('## '));
  md.splice(indice === -1 ? md.length : indice, 0, ...resumen);

  const archivo = join(DIR, `odoo-discovery-${sello}.md`);
  writeFileSync(archivo, md.join('\n'));
  console.log(`\nReporte: ${archivo}`);
  if (avisos.length) console.log(`Avisos:\n${avisos.map((a) => `  - ${a}`).join('\n')}`);
  if (errores.length) {
    console.error(`\n${errores.length} sección(es) fallaron:\n${errores.map((e) => `  - ${e}`).join('\n')}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`\nDescubrimiento abortado: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
