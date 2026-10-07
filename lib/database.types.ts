// Generado desde Supabase (proyecto GESTOR-VISITAS) después de aplicar las migraciones 0001–0005.
// Regenerar cuando cambie el esquema.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

type Rel = { foreignKeyName: string; columns: string[]; isOneToOne: boolean; referencedRelation: string; referencedColumns: string[] }

export type Database = {
  __InternalSupabase: { PostgrestVersion: '14.18' }
  public: {
    Tables: {
      vis_cliente_ubicaciones_hist: {
        Row: { cliente_id: string; created_at: string; id: number; lat: number; lng: number; motivo: string | null; origen: Database['public']['Enums']['vis_origen_ubic']; precision_m: number | null; usuario_id: string | null }
        Insert: { cliente_id: string; created_at?: string; id?: number; lat: number; lng: number; motivo?: string | null; origen: Database['public']['Enums']['vis_origen_ubic']; precision_m?: number | null; usuario_id?: string | null }
        Update: { cliente_id?: string; created_at?: string; id?: number; lat?: number; lng?: number; motivo?: string | null; origen?: Database['public']['Enums']['vis_origen_ubic']; precision_m?: number | null; usuario_id?: string | null }
        Relationships: Rel[]
      }
      vis_clientes: {
        Row: {
          activo: boolean; ciudad: string | null; creado_por: string | null; created_at: string; departamento: string | null
          direccion: string | null; es_ejemplo: boolean; facturas_6m: number; id: string; lat: number | null; lat_odoo: number | null
          lng: number | null; lng_odoo: number | null; notas: string | null; odoo_alta_fecha: string | null; odoo_partner_id: number | null
          origen_ubicacion: Database['public']['Enums']['vis_origen_ubic'] | null; razon_social: string; ruc: string | null
          telefono: string | null; telefono_norm: string | null; ubicacion: unknown; ubicacion_actualizada_el: string | null
          ubicacion_actualizada_por: string | null; ubicacion_precision_m: number | null; ultima_factura_fecha: string | null
          updated_at: string; vendedor_id: string | null; ventas_6m_gs: number; zona_id: string | null
        }
        Insert: {
          activo?: boolean; ciudad?: string | null; creado_por?: string | null; created_at?: string; departamento?: string | null
          direccion?: string | null; es_ejemplo?: boolean; facturas_6m?: number; id?: string; lat?: number | null; lat_odoo?: number | null
          lng?: number | null; lng_odoo?: number | null; notas?: string | null; odoo_alta_fecha?: string | null; odoo_partner_id?: number | null
          origen_ubicacion?: Database['public']['Enums']['vis_origen_ubic'] | null; razon_social: string; ruc?: string | null
          telefono?: string | null; ubicacion_actualizada_el?: string | null; ubicacion_actualizada_por?: string | null
          ubicacion_precision_m?: number | null; ultima_factura_fecha?: string | null; updated_at?: string; vendedor_id?: string | null
          ventas_6m_gs?: number; zona_id?: string | null
        }
        Update: Partial<Database['public']['Tables']['vis_clientes']['Insert']>
        Relationships: Rel[]
      }
      vis_config: {
        Row: { base_lat: number | null; base_lng: number | null; dist_alerta_m: number; duplicado_radio_m: number; duplicado_similitud: number; gps_precision_max_m: number; id: boolean; jornada_cierre_auto: string; track_precision_max_m: number }
        Insert: { base_lat?: number | null; base_lng?: number | null; dist_alerta_m?: number; duplicado_radio_m?: number; duplicado_similitud?: number; gps_precision_max_m?: number; id?: boolean; jornada_cierre_auto?: string; track_precision_max_m?: number }
        Update: Partial<Database['public']['Tables']['vis_config']['Insert']>
        Relationships: []
      }
      vis_jornadas: {
        Row: { cierre_auto: boolean; fin: string | null; id: string; inicio: string; inicio_lat: number | null; inicio_lng: number | null; km_recorridos: number | null; vendedor_id: string }
        Insert: { cierre_auto?: boolean; fin?: string | null; id?: string; inicio?: string; inicio_lat?: number | null; inicio_lng?: number | null; km_recorridos?: number | null; vendedor_id: string }
        Update: Partial<Database['public']['Tables']['vis_jornadas']['Insert']>
        Relationships: Rel[]
      }
      vis_posicion_actual: {
        Row: { bateria_pct: number | null; en_jornada: boolean; fecha_hora: string; jornada_id: string | null; lat: number; lng: number; precision_m: number | null; vendedor_id: string }
        Insert: { bateria_pct?: number | null; en_jornada?: boolean; fecha_hora: string; jornada_id?: string | null; lat: number; lng: number; precision_m?: number | null; vendedor_id: string }
        Update: Partial<Database['public']['Tables']['vis_posicion_actual']['Insert']>
        Relationships: Rel[]
      }
      vis_posiciones: {
        Row: { bateria_pct: number | null; fecha_hora: string; id: number; jornada_id: string; lat: number; lng: number; origen: string; precision_m: number | null; recibido_el: string; velocidad_kmh: number | null; vendedor_id: string }
        Insert: { bateria_pct?: number | null; fecha_hora: string; id?: number; jornada_id: string; lat: number; lng: number; origen?: string; precision_m?: number | null; recibido_el?: string; velocidad_kmh?: number | null; vendedor_id: string }
        Update: Partial<Database['public']['Tables']['vis_posiciones']['Insert']>
        Relationships: Rel[]
      }
      vis_resultados: {
        Row: { activo: boolean; es_venta: boolean; id: number; nombre: string; orden: number }
        Insert: { activo?: boolean; es_venta?: boolean; id?: number; nombre: string; orden?: number }
        Update: Partial<Database['public']['Tables']['vis_resultados']['Insert']>
        Relationships: []
      }
      vis_ruta_paradas: {
        Row: { cliente_id: string; dia: string; id: string; orden: number; ruta_id: string }
        Insert: { cliente_id: string; dia: string; id?: string; orden?: number; ruta_id: string }
        Update: Partial<Database['public']['Tables']['vis_ruta_paradas']['Insert']>
        Relationships: Rel[]
      }
      vis_rutas: {
        Row: { creado_por: string | null; created_at: string; estado: Database['public']['Enums']['vis_estado_ruta']; id: string; nombre: string; notas: string | null; semana_inicio: string; vendedor_id: string; zona_id: string | null }
        Insert: { creado_por?: string | null; created_at?: string; estado?: Database['public']['Enums']['vis_estado_ruta']; id?: string; nombre: string; notas?: string | null; semana_inicio: string; vendedor_id: string; zona_id?: string | null }
        Update: Partial<Database['public']['Tables']['vis_rutas']['Insert']>
        Relationships: Rel[]
      }
      vis_sync_log: {
        Row: { actualizados: number | null; error: string | null; fin: string | null; id: number; inicio: string; insertados: number | null; leidos: number | null; ok: boolean | null; proceso: string; visto_el: string | null; visto_por: string | null }
        Insert: { actualizados?: number | null; error?: string | null; fin?: string | null; id?: number; inicio?: string; insertados?: number | null; leidos?: number | null; ok?: boolean | null; proceso: string; visto_el?: string | null; visto_por?: string | null }
        Update: Partial<Database['public']['Tables']['vis_sync_log']['Insert']>
        Relationships: Rel[]
      }
      vis_vendedores: {
        Row: { activo: boolean; auth_user_id: string | null; base_lat: number | null; base_lng: number | null; created_at: string; email: string; id: string; meta_diaria: number; meta_semanal: number; nombre: string; odoo_user_id: number | null; rol: Database['public']['Enums']['vis_rol']; telefono: string | null; tracking_aceptado_el: string | null }
        Insert: { activo?: boolean; auth_user_id?: string | null; base_lat?: number | null; base_lng?: number | null; created_at?: string; email: string; id?: string; meta_diaria?: number; meta_semanal?: number; nombre: string; odoo_user_id?: number | null; rol?: Database['public']['Enums']['vis_rol']; telefono?: string | null; tracking_aceptado_el?: string | null }
        Update: Partial<Database['public']['Tables']['vis_vendedores']['Insert']>
        Relationships: []
      }
      vis_visitas: {
        Row: {
          capturada_offline: boolean; client_uuid: string | null; cliente_id: string; created_at: string; distancia_cliente_m: number | null
          fecha_hora: string; fotos: string[]; hizo_cobranza: boolean; hizo_pedido: boolean; id: string; lat: number | null; lng: number | null
          monto_cobrado_gs: number | null; observaciones: string | null; odoo_visita_id: number | null; origen: Database['public']['Enums']['vis_origen_visita']
          precision_m: number | null; proxima_visita: string | null; resultado_id: number | null; ruta_parada_id: string | null
          vendedor_id: string | null; zona_id: string | null
        }
        Insert: {
          capturada_offline?: boolean; client_uuid?: string | null; cliente_id: string; created_at?: string; distancia_cliente_m?: number | null
          fecha_hora?: string; fotos?: string[]; hizo_cobranza?: boolean; hizo_pedido?: boolean; id?: string; lat?: number | null; lng?: number | null
          monto_cobrado_gs?: number | null; observaciones?: string | null; odoo_visita_id?: number | null; origen?: Database['public']['Enums']['vis_origen_visita']
          precision_m?: number | null; proxima_visita?: string | null; resultado_id?: number | null; ruta_parada_id?: string | null
          vendedor_id?: string | null; zona_id?: string | null
        }
        Update: Partial<Database['public']['Tables']['vis_visitas']['Insert']>
        Relationships: Rel[]
      }
      vis_zonas: {
        Row: { activo: boolean; color: string; created_at: string; id: string; nombre: string; poligono: unknown }
        Insert: { activo?: boolean; color?: string; created_at?: string; id?: string; nombre: string; poligono?: unknown }
        Update: Partial<Database['public']['Tables']['vis_zonas']['Insert']>
        Relationships: []
      }
    }
    Views: {
      vis_clientes_v: {
        Row: { [K in keyof Database['public']['Tables']['vis_clientes']['Row']]: Database['public']['Tables']['vis_clientes']['Row'][K] | null } & {
          estado: EstadoCliente | null; ultima_visita: string | null
        }
        Relationships: Rel[]
      }
      vis_resumen_diario: {
        Row: { clientes_distintos: number | null; con_pedido: number | null; dia: string | null; fuera_de_ruta: number | null; semana_inicio: string | null; vendedor_id: string | null; visitas: number | null }
        Relationships: Rel[]
      }
    }
    Functions: {
      vis_aceptar_tracking: { Args: never; Returns: string }
      vis_actualizar_ubicacion: {
        Args: { p_cliente: string; p_lat: number; p_lng: number; p_motivo: string; p_origen: Database['public']['Enums']['vis_origen_ubic']; p_precision: number }
        Returns: undefined
      }
      vis_buscar_duplicados: {
        Args: { p_lat: number; p_lng: number; p_razon_social: string; p_ruc: string; p_telefono: string }
        Returns: Duplicado[]
      }
      vis_cerrar_jornadas_olvidadas: { Args: never; Returns: number }
      vis_clientes_cercanos: {
        Args: { p_lat: number; p_lng: number; p_radio_m?: number }
        Returns: { ciudad: string; distancia_m: number; estado: EstadoCliente; id: string; lat: number; lng: number; razon_social: string; telefono: string; telefono_norm: string; ultima_visita: string | null }[]
      }
      vis_crear_prospecto: { Args: { p: Json }; Returns: Json }
      vis_es_admin: { Args: never; Returns: boolean }
      vis_es_supervisor: { Args: never; Returns: boolean }
      vis_hoy: { Args: never; Returns: string }
      vis_iniciar_jornada: {
        Args: { p_bateria?: number; p_lat?: number; p_lng?: number; p_precision?: number }
        Returns: Database['public']['Tables']['vis_jornadas']['Row']
      }
      vis_km_jornada: { Args: { p_jornada: string }; Returns: number }
      vis_mi_id: { Args: never; Returns: string }
      vis_mi_rol: { Args: never; Returns: Database['public']['Enums']['vis_rol'] }
      vis_mis_zonas: { Args: never; Returns: string[] }
      vis_nombre_cmp: { Args: { t: string }; Returns: string }
      vis_normalizar_telefono: { Args: { t: string }; Returns: string }
      vis_paradas_dia: {
        Args: { p_dia?: string; p_vendedor?: string }
        Returns: ParadaDia[]
      }
      vis_puede_ver_cliente: { Args: { p_cliente: string }; Returns: boolean }
      vis_registrar_visita: { Args: { p: Json }; Returns: Json }
      vis_subir_posiciones: { Args: { p: Json }; Returns: number }
      vis_tablero: {
        Args: { p_semana: string; p_vendedor?: string }
        Returns: FilaTablero[]
      }
      vis_terminar_jornada: {
        Args: { p_bateria?: number; p_lat?: number; p_lng?: number; p_precision?: number }
        Returns: Database['public']['Tables']['vis_jornadas']['Row']
      }
      vis_vincular_usuario: { Args: never; Returns: Json }
      vis_zona_historial: {
        Args: { p_dias?: number; p_zona: string }
        Returns: HistorialZona[]
      }
    }
    Enums: {
      vis_estado_ruta: 'borrador' | 'publicada' | 'cerrada'
      vis_origen_ubic: 'odoo' | 'manual' | 'gps_visita'
      vis_origen_visita: 'app' | 'odoo_import'
      vis_rol: 'admin' | 'supervisor' | 'vendedor'
    }
    CompositeTypes: { [_ in never]: never }
  }
}

// ── Tipos de dominio usados en la app ────────────────────────────────
type T = Database['public']['Tables']
export type Vendedor = T['vis_vendedores']['Row']
export type Zona = T['vis_zonas']['Row']
export type Cliente = T['vis_clientes']['Row']
export type ClienteV = Database['public']['Views']['vis_clientes_v']['Row']
export type Ruta = T['vis_rutas']['Row']
export type Parada = T['vis_ruta_paradas']['Row']
export type Visita = T['vis_visitas']['Row']
export type Resultado = T['vis_resultados']['Row']
export type Jornada = T['vis_jornadas']['Row']
export type PosicionActual = T['vis_posicion_actual']['Row']
export type Rol = Database['public']['Enums']['vis_rol']
export type EstadoRuta = Database['public']['Enums']['vis_estado_ruta']
export type EstadoCliente = 'activo' | 'potencial' | 'inactivo'

export type Duplicado = { id: string; razon_social: string; telefono: string | null; ruc: string | null; ciudad: string | null; motivo: string; distancia_m: number | null }

export type ParadaDia = {
  parada_id: string; ruta_id: string; ruta_nombre: string; orden: number; cliente_id: string; razon_social: string
  telefono: string | null; telefono_norm: string | null; direccion: string | null; ciudad: string | null
  lat: number | null; lng: number | null; estado: EstadoCliente; ultima_visita: string | null
  ultimo_resultado: string | null; ultima_observacion: string | null; visitada: boolean
}

export type FilaTablero = {
  vendedor_id: string; vendedor: string; meta_diaria: number; meta_semanal: number; dia: string
  planificadas: number; realizadas: number; en_ruta: number; fuera_de_ruta: number; con_pedido: number
}

export type HistorialZona = {
  cliente_id: string; razon_social: string; ciudad: string | null; estado: EstadoCliente; visitas: number
  ultima_visita: string; ultimo_resultado: string | null; ultima_observacion: string | null; ultimo_vendedor: string | null
  hizo_pedido: number
}

export type Perfil = {
  id: string; nombre: string; email: string; rol: Rol; meta_diaria: number; meta_semanal: number
  tracking_aceptado_el: string | null
}
