/**
 * Cliente JSON-RPC mínimo para Odoo 17 — SOLO LECTURA.
 *
 * - Uso exclusivo del lado servidor (scripts, Route Handlers, Server Actions, cron).
 *   Nunca importar desde un componente de cliente: lee ODOO_API_KEY del entorno.
 * - Solo expone los métodos de la lista blanca. Cualquier otro (write, create,
 *   unlink, action_*, ...) tira error antes de salir a la red.
 */

const METODOS_PERMITIDOS = ['search_read', 'read_group', 'search_count', 'fields_get'] as const;
export type OdooMetodo = (typeof METODOS_PERMITIDOS)[number];

export type OdooDominio = unknown[];
export type OdooKwargs = Record<string, unknown> & { context?: Record<string, unknown> };

export class OdooError extends Error {
  constructor(
    message: string,
    /** Nombre de la excepción en Odoo, ej. "odoo.exceptions.AccessError". */
    readonly nombre?: string,
    readonly debug?: string,
  ) {
    super(message);
    this.name = 'OdooError';
  }
}

export interface OdooConfig {
  url: string;
  db: string;
  user: string;
  apiKey: string;
  companyId: number | null;
}

export function odooConfig(): OdooConfig {
  const faltan = ['ODOO_URL', 'ODOO_DB', 'ODOO_USER', 'ODOO_API_KEY'].filter((k) => !process.env[k]?.trim());
  if (faltan.length) throw new Error(`Faltan variables de entorno de Odoo: ${faltan.join(', ')}`);

  const companyRaw = process.env.ODOO_COMPANY_ID?.trim();
  const companyId = companyRaw ? Number(companyRaw) : null;
  if (companyId !== null && !Number.isInteger(companyId)) {
    throw new Error(`ODOO_COMPANY_ID debe ser un entero, vino "${companyRaw}"`);
  }

  return {
    url: process.env.ODOO_URL!.trim().replace(/\/+$/, ''),
    db: process.env.ODOO_DB!.trim(),
    user: process.env.ODOO_USER!.trim(),
    apiKey: process.env.ODOO_API_KEY!.trim(),
    companyId,
  };
}

interface RespuestaRpc<T> {
  result?: T;
  error?: { message?: string; data?: { name?: string; message?: string; debug?: string } };
}

async function rpc<T>(service: 'common' | 'object', method: string, args: unknown[]): Promise<T> {
  const { url } = odooConfig();
  const resp = await fetch(`${url}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: Date.now() }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!resp.ok) throw new OdooError(`Odoo HTTP ${resp.status} ${resp.statusText}`);

  const body = (await resp.json()) as RespuestaRpc<T>;
  if (body.error) {
    // El mensaje útil viene anidado en error.data.message.
    const d = body.error.data ?? {};
    throw new OdooError(`Odoo ${d.name ?? 'error'}: ${d.message ?? body.error.message ?? 'sin mensaje'}`, d.name, d.debug);
  }
  return body.result as T;
}

let uidCache: number | null = null;

/** Login contra el servicio `common`; el UID queda cacheado en el módulo. */
export async function odooLogin(forzar = false): Promise<number> {
  if (uidCache !== null && !forzar) return uidCache;
  const { db, user, apiKey } = odooConfig();
  const uid = await rpc<number | false>('common', 'login', [db, user, apiKey]);
  if (!uid) throw new OdooError('Odoo: login rechazado — revisar ODOO_USER, ODOO_API_KEY y ODOO_DB');
  uidCache = uid;
  return uid;
}

/** Versión del servidor (no requiere login). */
export async function odooVersion(): Promise<Record<string, unknown>> {
  return rpc<Record<string, unknown>>('common', 'version', []);
}

function esErrorDeSesion(e: unknown): boolean {
  return e instanceof OdooError && /AccessDenied|SessionExpired/i.test(e.nombre ?? e.message);
}

export async function odooCall<T = unknown>(
  model: string,
  method: OdooMetodo,
  args: unknown[] = [],
  kwargs: OdooKwargs = {},
): Promise<T> {
  // Chequeo en tiempo de ejecución además del tipo: nadie llega a la red con un método de escritura.
  if (!(METODOS_PERMITIDOS as readonly string[]).includes(method)) {
    throw new Error(`Método de Odoo no permitido: "${String(method)}". Este cliente es de solo lectura.`);
  }
  if (method === 'search_read' && !(Array.isArray(kwargs.fields) && kwargs.fields.length > 0)) {
    throw new Error(`search_read sobre ${model} sin "fields": declarar siempre los campos.`);
  }

  const { db, apiKey, companyId } = odooConfig();
  const kw: OdooKwargs = {
    ...kwargs,
    context: { ...(companyId !== null ? { allowed_company_ids: [companyId] } : {}), ...kwargs.context },
  };

  const ejecutar = async () => rpc<T>('object', 'execute_kw', [db, await odooLogin(), apiKey, model, method, args, kw]);
  try {
    return await ejecutar();
  } catch (e) {
    if (!esErrorDeSesion(e)) throw e;
    // Un solo reintento con UID nuevo.
    await odooLogin(true);
    return ejecutar();
  }
}

/** search_read paginado. `fields` es obligatorio. */
export async function searchReadAll<T = Record<string, unknown>>(
  model: string,
  domain: OdooDominio,
  fields: string[],
  opts: { pageSize?: number; order?: string; context?: Record<string, unknown> } = {},
): Promise<T[]> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 500, 1), 1000);
  const filas: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const pagina = await odooCall<T[]>(model, 'search_read', [domain], {
      fields,
      limit: pageSize,
      offset,
      order: opts.order ?? 'id asc',
      ...(opts.context ? { context: opts.context } : {}),
    });
    filas.push(...pagina);
    if (pagina.length < pageSize) return filas;
  }
}

/** many2one de Odoo: `[id, "nombre"]` o `false` → `{ id, name } | null`. */
export function m2o(v: unknown): { id: number; name: string } | null {
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'string') return { id: v[0], name: v[1] };
  return null;
}

/** Datetime de Odoo ("YYYY-MM-DD HH:mm:ss", siempre UTC) → Date. `false` → null. */
export function odooDatetime(v: unknown): Date | null {
  if (typeof v !== 'string' || !v) return null;
  const d = new Date(`${v.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Solo para tests. */
export function _resetOdooCache(): void {
  uidCache = null;
}
