// supabase-js arma el cliente de Realtime (WebSocket) al crearse y falla si el runtime no
// tiene WebSocket (Vercel Edge, Node < 22). En el servidor nunca usamos Realtime: le pasamos
// un transporte que solo falla si alguien intenta conectarse.
class SinWebSocket {
  constructor() {
    throw new Error('Realtime no está disponible del lado del servidor.')
  }
}

export const opcionesRealtimeServidor = {
  transport: ((globalThis as { WebSocket?: unknown }).WebSocket ?? SinWebSocket) as never,
}
