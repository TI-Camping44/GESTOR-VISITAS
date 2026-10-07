import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import { _resetOdooCache, m2o, odooCall, odooDatetime, searchReadAll, type OdooMetodo } from '../lib/odoo';

type Llamada = { service: string; method: string; args: unknown[] };

// Odoo falso: registra cada llamada y responde según `responder`.
let llamadas: Llamada[] = [];
let responder: (l: Llamada) => { result?: unknown; error?: unknown } = () => ({ result: [] });
let server: Server;

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const { params } = JSON.parse(body) as { params: Llamada };
      llamadas.push(params);
      const r = params.service === 'common' && params.method === 'login' ? { result: 7 } : responder(params);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, ...r }));
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  process.env.ODOO_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  process.env.ODOO_DB = 'db';
  process.env.ODOO_USER = 'tecnico';
  process.env.ODOO_API_KEY = 'clave-secreta';
  process.env.ODOO_COMPANY_ID = '1';
});

after(() => server.close());

beforeEach(() => {
  llamadas = [];
  responder = () => ({ result: [] });
  _resetOdooCache();
});

const execs = () => llamadas.filter((l) => l.method === 'execute_kw');

describe('lista blanca de métodos', () => {
  for (const metodo of ['write', 'create', 'unlink', 'copy', 'action_post', 'message_post', 'read', 'search']) {
    it(`rechaza "${metodo}" sin llamar a Odoo`, async () => {
      await assert.rejects(odooCall('res.partner', metodo as OdooMetodo, [[1], { name: 'x' }]), /no permitido/);
      assert.equal(llamadas.length, 0);
    });
  }

  it('acepta los 4 métodos de lectura', async () => {
    for (const m of ['search_read', 'read_group', 'search_count', 'fields_get'] as const) {
      await odooCall('res.partner', m, [[]], m === 'search_read' ? { fields: ['name'] } : {});
    }
    assert.deepEqual(execs().map((l) => l.args[4]), ['search_read', 'read_group', 'search_count', 'fields_get']);
  });

  it('exige fields en search_read', async () => {
    await assert.rejects(odooCall('res.partner', 'search_read', [[]]), /sin "fields"/);
    await assert.rejects(odooCall('res.partner', 'search_read', [[]], { fields: [] }), /sin "fields"/);
    assert.equal(llamadas.length, 0);
  });
});

describe('odooCall', () => {
  it('cachea el UID y pasa allowed_company_ids', async () => {
    await odooCall('res.partner', 'search_count', [[]]);
    await odooCall('res.partner', 'search_count', [[]]);
    assert.equal(llamadas.filter((l) => l.method === 'login').length, 1);
    const [db, uid, key, modelo, , , kw] = execs()[0]!.args as [string, number, string, string, string, unknown[], { context: unknown }];
    assert.deepEqual([db, uid, key, modelo], ['db', 7, 'clave-secreta', 'res.partner']);
    assert.deepEqual(kw.context, { allowed_company_ids: [1] });
  });

  it('desanida error.data.message', async () => {
    responder = () => ({ error: { message: 'Odoo Server Error', data: { name: 'odoo.exceptions.AccessError', message: 'No tenés acceso a Facturas' } } });
    await assert.rejects(odooCall('account.move', 'search_count', [[]]), /AccessError: No tenés acceso a Facturas/);
    assert.equal(execs().length, 1, 'un error que no es de sesión no se reintenta');
  });

  it('ante error de sesión renueva el login y reintenta una sola vez', async () => {
    responder = () => ({ error: { message: 'x', data: { name: 'odoo.exceptions.AccessDenied', message: 'Access Denied' } } });
    await assert.rejects(odooCall('res.partner', 'search_count', [[]]), /AccessDenied/);
    assert.equal(execs().length, 2);
    assert.equal(llamadas.filter((l) => l.method === 'login').length, 2);
  });
});

describe('searchReadAll', () => {
  it('pagina hasta la última página', async () => {
    const total = 1203;
    responder = (l) => {
      const { limit, offset } = l.args[6] as { limit: number; offset: number };
      return { result: Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => ({ id: offset + i + 1 })) };
    };
    const filas = await searchReadAll('res.partner', [], ['id'], { pageSize: 500 });
    assert.equal(filas.length, total);
    assert.equal(execs().length, 3);
  });
});

describe('helpers', () => {
  it('m2o normaliza [id, nombre] y false', () => {
    assert.deepEqual(m2o([5, 'Antonio']), { id: 5, name: 'Antonio' });
    assert.equal(m2o(false), null);
    assert.equal(m2o([]), null);
    assert.equal(m2o([1, 2]), null, 'una lista many2many no es many2one');
  });

  it('odooDatetime interpreta UTC', () => {
    assert.equal(odooDatetime('2026-10-07 03:30:00')?.toISOString(), '2026-10-07T03:30:00.000Z');
    assert.equal(odooDatetime(false), null);
  });
});
