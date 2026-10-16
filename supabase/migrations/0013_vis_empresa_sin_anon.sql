-- Las funciones de empresa (0012) son solo para usuarios con sesión.
revoke execute on function vis_mi_empresa(), vis_vendedor_visible(uuid), vis_cambiar_empresa(uuid) from anon, public;
