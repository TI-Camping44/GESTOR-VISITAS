# Manuales (PDF)

Cinco manuales con capturas de la app, con **datos de ejemplo** (`mock.mjs` simula Supabase; nada es real):
Camping 44 – vendedor y supervisor; Vitalica – vendedor, visitadora médica y supervisor/admin.

```bash
# 1. App armada contra el simulador
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=anon npm run build
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=anon npx next start -p 3100 &
# 2. Capturas (levanta el simulador con cada perfil): todos | vend-c44 | vend-vit | medica | panel-c44 | panel-vit
node manuales/capturas.mjs todos
# 3. Imágenes y PDFs → manuales/salida/Manuales/
python3 manuales/imagenes.py && node manuales/gen.mjs
```

El texto está en `contenido.mjs`. Después de generar, volver a armar la app normal (`npm run build`) antes de publicar.
