-- Un médico no se carga dos veces (23/11): entre los activos de una empresa no puede haber dos con la misma clave de
-- nombre (sin títulos, tildes, signos ni espacios de más). Frena el doble toque con señal mala y la carga repetida;
-- la app y el panel avisan «ya está cargado» y ofrecen usar ese. Los de la papelera no cuentan.
create unique index if not exists vis_medicos_nombre_unico on vis_medicos (empresa_id, vis_clave_nombre(nombre))
  where activo and vis_clave_nombre(nombre) <> '';
