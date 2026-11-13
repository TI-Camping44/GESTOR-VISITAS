# Pasa las capturas (salida/shots/*.png) a JPEG para los PDFs (salida/img/). Uso: python3 manuales/imagenes.py
import os
from PIL import Image
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'salida')
os.makedirs(f'{D}/img', exist_ok=True)
# En las capturas «completas» del celular se muestra la parte de abajo (la de arriba ya está en otra captura).
OFF = {'v-hoy-completa': 1050, 'h-hoy-completa': 1050, 'm-hoy-completa': 1000, 'v-gps-completa': 1150, 'h-gps-completa': 1150, 'm-gps-completa': 1150, 'm-medico-nuevo-completa': 900}
for f in sorted(os.listdir(f'{D}/shots')):
    im = Image.open(f'{D}/shots/{f}').convert('RGB'); n = f[:-4]
    if im.width == 780 and 'completa' in n:
        y = OFF.get(n, 0); im = im.crop((0, y, 780, min(im.height, y + 1688)))
    elif 'completa' in n:
        im = im.crop((0, 0, im.width, min(im.height, 2600)))
    im.resize((im.width * 3 // 4, im.height * 3 // 4)).save(f'{D}/img/{n}.jpg', quality=82, optimize=True)
