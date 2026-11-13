// Contenido de los manuales. Cada capítulo: t (título), p (párrafos), pasos, img [[archivo, epígrafe]], nota, ojo.
// Las imágenes de celular («m»: true) van de a varias por fila; las del panel, a lo ancho.
const URL_APP = 'gestion-visitas-eight.vercel.app'

// ── Capítulos comunes de la app de calle (vendedor y visitadora) ──
const entrar = (pref) => ({
  t: 'Entrar a la app e instalarla en el celular',
  p: [`Abrí <b>${URL_APP}</b> en Chrome (Android) o Safari (iPhone) y tocá <b>Ingresar con Google</b> con tu cuenta de la empresa. La primera vez te pide permiso para ver tu ubicación: tocá <b>Permitir</b>.`],
  pasos: ['Para tenerla como una app: en Chrome, menú <b>⋮</b> → <b>Agregar a la pantalla principal</b>. En iPhone: <b>Compartir</b> → <b>Agregar a inicio</b>.',
    'Si no te deja entrar, avisale a tu supervisor: tiene que darte acceso con tu correo.'],
  img: [[`${pref}-login`, 'Pantalla de ingreso']], m: true,
})
const jornada = (pref, quien = 'tu supervisor') => ({
  t: 'Empezar y terminar la jornada',
  p: [`Al llegar a la calle tocá <b>Iniciar jornada</b>. Desde ese momento ${quien} ve dónde estás y tu recorrido. La barra de arriba muestra desde qué hora estás en jornada.`,
    'Al terminar el día tocá <b>Terminar</b> y confirmá con <b>Sí, terminar</b>. Fuera de la jornada no se comparte tu ubicación.'],
  img: [[`${pref}-sin-jornada`, 'Antes de empezar: «Iniciar jornada»'], [`${pref}-hoy`, 'Con la jornada abierta: barra arriba con «Terminar»']], m: true,
  nota: 'Si aparece «Pendientes de subir», son datos guardados sin señal: se suben solos cuando vuelve la conexión. No cierres sesión mientras haya pendientes.',
})
const sinSenal = {
  t: 'Sin señal',
  p: ['La app sigue funcionando sin internet: ves tu ruta y tus clientes guardados, y las visitas que cargues quedan en el celular. Arriba aparece «Sin señal: lo que cargues se guarda y se sube solo».',
    'Cuando vuelve la señal se suben solas. No borres los datos del navegador ni desinstales la app mientras haya pendientes.'],
}
const gps = (pref) => ({
  t: 'GPS en segundo plano (Traccar)',
  p: ['Con el celular bloqueado, la app deja de registrar tu recorrido. Para que quede completo se usa <b>Traccar Client</b>, una app gratis que manda la ubicación <b>solo mientras tu jornada está abierta</b> y muestra un aviso fijo en la barra del celular.'],
  pasos: ['En la app, al pie de cualquier pantalla, tocá <b>GPS en segundo plano</b>.', 'Instalá <b>Traccar Client</b> con el botón de tu celular (Android o iPhone).',
    'En Traccar, copiá el <b>Identificador del dispositivo</b> y la <b>URL del servidor</b> que te muestra la pantalla (botones de copiar).', 'Configurá precisión <b>alta</b>, frecuencia <b>30</b> segundos y distancia <b>50</b> metros, y activá el servicio.',
    'Volvé a la pantalla: tiene que decir «Último envío de Traccar: recién».'],
  img: [[`${pref}-gps`, 'Pantalla «GPS en segundo plano»'], [`${pref}-gps-completa`, 'Los datos para Traccar']], m: true,
  ojo: 'Si la barra de jornada dice «Activá el GPS en segundo plano», Traccar no está mandando: abrilo y fijate que el servicio esté prendido.',
})
const tema = (pref) => ({
  t: 'Modo claro u oscuro',
  p: ['Al pie de la app elegís <b>Claro</b>, <b>Oscuro</b> o <b>Auto</b> (sigue al celular).'],
  img: [[`${pref}-hoy-oscuro`, 'Modo oscuro']], m: true,
})

function manualVendedor(pref) {
  return [
    entrar(pref),
    jornada(pref),
    { t: 'Hoy: tu ruta del día', p: ['En <b>Hoy</b> ves cuántas visitas llevás contra tu meta del día y de la semana, el mapa con las paradas numeradas en orden, y la lista de clientes a visitar.',
      'Cada parada muestra el estado del cliente (verde activo, azul potencial, rojo sin movimiento, naranja «no le interesa»), la última visita y lo último que se anotó.'],
      pasos: ['<b>Abrir en Google Maps</b> arma el recorrido completo en Maps.', 'En cada parada: <b>Cómo llegar</b> (Maps a ese cliente), <b>Saltar</b> (lo saca del recorrido de hoy; se puede volver a incluir), llamar o WhatsApp.',
        'Al llegar al cliente tocá <b>Llegué · Registrar visita</b>.'],
      img: [[`${pref}-hoy`, 'Metas, buscador y mapa'], [`${pref}-hoy-completa`, 'La lista de paradas']], m: true },
    { t: 'Registrar una visita', p: ['La visita guarda la hora y tu ubicación. Arriba ves la precisión del GPS y a qué distancia estás del cliente.'],
      pasos: ['Elegí el <b>Resultado</b> (Pedido, Cotización, Volver otro día, Cobranza, No le interesa…).', 'Marcá si <b>hizo pedido</b> o <b>cobranza</b> (con el monto).',
        'Escribí <b>Observaciones</b>: qué pasó, qué necesita, a quién ver la próxima vez. Con «No le interesa» es obligatorio decir por qué.',
        'Si quedaste en volver, poné la <b>Próxima visita</b>: te la recuerda en Hoy.', 'Opcional: foto de la fachada. Tocá <b>Guardar visita</b>.'],
      img: [[`${pref}-visita`, 'Arriba: GPS y resultado'], [`${pref}-visita-abajo`, 'Pedido, cobranza, observaciones y guardar'], [`${pref}-visita-error`, 'Si falta algo, el error sale debajo del campo']], m: true,
      nota: 'Si estás lejos de donde figura el cliente, al guardar te pregunta si corregimos su ubicación. Si te equivocás de pantalla con datos cargados, la app pregunta antes de salir.' },
    { t: 'Visitar a un cliente que no está en tu ruta', p: ['En Hoy, en <b>¿Visitar a otro cliente?</b>, escribí el nombre, la ciudad o el RUC y tocá <b>Visitar</b>. La visita cuenta en el día y figura como «fuera de ruta».'],
      img: [[`${pref}-buscar`, 'Buscar otro cliente']], m: true },
    { t: 'Dar de alta un cliente nuevo', p: ['Hacelo <b>parado en el local</b>: se guarda la ubicación del GPS. El alta ya cuenta como visita y después completás el resultado.'],
      pasos: ['Tocá <b>Nuevo cliente</b> abajo.', 'Esperá que la precisión del GPS sea buena (verde).', 'Completá razón social, teléfono, ciudad (de la lista) y, si tenés, RUC, dirección y notas.', 'Tocá <b>Guardar cliente</b>. Si parece repetido te muestra los parecidos: tocá <b>Es este</b> o <b>No, es otro: crear igual</b>.'],
      img: [[`${pref}-nuevo-cliente`, 'Alta de cliente']], m: true,
      nota: 'Si la ciudad es de la zona de otro vendedor o hay clientes de otro vendedor muy cerca, la app te avisa. Podés darlo de alta igual: tu supervisor lo revisa.' },
    { t: 'Mis clientes: lista y mapa', p: ['En <b>Clientes</b> está tu cartera. En <b>Lista</b> buscás por nombre, ciudad o RUC, filtrás por estado y ordenás por última visita, ventas o nombre. Cada cliente tiene <b>Visitar</b>, <b>Llamar</b>, <b>WhatsApp</b> y <b>Cómo llegar</b>.',
      'En <b>Mapa</b> ves dónde están, con colores por estado, y podés buscar los que están cerca tuyo (2, 5 o 10 km).'],
      img: [[`${pref}-clientes`, 'Lista'], [`${pref}-clientes-mapa`, 'Mapa']], m: true },
    { t: 'Mis visitas', p: ['En <b>Visitas</b> ves lo que hiciste: <b>Por día</b> (7, 30 o 90 días, o un día puntual) o <b>Por cliente</b>, con resultado, pedido, cobranza, próxima visita y observaciones. Las que todavía no se subieron aparecen marcadas.'],
      img: [[`${pref}-mis-visitas`, 'Mis visitas por día']], m: true },
    sinSenal, gps(pref), tema(pref),
  ]
}

const vendC44 = { archivo: 'Camping 44 - Manual del vendedor', empresa: 'c44', titulo: 'Manual del vendedor', para: 'Vendedores de Camping 44 · App en el celular', caps: manualVendedor('v') }
const vendVit = { archivo: 'Vitalica - Manual del vendedor', empresa: 'vit', titulo: 'Manual del vendedor', para: 'Vendedores de Vitalica · App en el celular', caps: manualVendedor('h') }

const visitadora = {
  archivo: 'Vitalica - Manual de la visitadora médica', empresa: 'vit', titulo: 'Manual de la visitadora médica', para: 'Visita médica · App en el celular',
  caps: [
    entrar('h'),
    { ...jornada('m', 'tu supervisor'), img: [['h-sin-jornada', 'Antes de empezar: «Iniciar jornada»'], ['m-hoy', 'Con la jornada abierta: barra arriba con «Terminar»']] },
    { t: 'Hoy: los lugares del día', p: ['En <b>Hoy</b> están los lugares de tu ruta (hospitales, sanatorios, consultorios) con a quién ver, y la hora a la que llegaste a cada uno. Si no tenés ruta cargada, armás la ruta en la calle: cada lugar al que llegás se suma solo.'],
      pasos: ['Tocá un lugar para abrirlo (o buscalo en <b>¿Ir a otro lugar?</b>).', 'Desde el lugar marcás la llegada y registrás las visitas a los médicos.'],
      img: [[`m-hoy`, 'Hoy'], [`m-hoy-completa`, 'Lugares del día']], m: true },
    { t: 'Llegué acá: marcar la llegada a un lugar', p: ['Al entrar a un hospital o consultorio, abrilo y tocá <b>Llegué acá</b>. Queda la hora y tu ubicación, el lugar se suma a tu ruta de hoy y tu supervisor lo ve en el momento.'],
      pasos: ['Si el GPS dice que estás a más de 500 m, pregunta «¿Seguro que llegaste acá?».', 'Si marcaste el lugar equivocado, en los primeros 30 minutos aparece <b>Me equivoqué de lugar, quitar</b>.',
        '¿Volvés al mismo lugar más tarde (por ejemplo, a la tarde por otro médico)? Pasada media hora aparece <b>Volví, llegué de nuevo</b>: quedan las dos horas.'],
      img: [[`m-lugar-llegar`, 'Antes de llegar: «Llegué acá»'], [`m-lugar-llego`, 'Después: la hora y «Volví, llegué de nuevo»']], m: true },
    { t: 'Registrar la visita a un médico', p: ['En el lugar, cada médico tiene <b>Registrar visita</b>. Los que «tocan visita» (pasó su frecuencia) y los de tu ruta de hoy aparecen primero.'],
      pasos: ['Elegí el <b>Resultado</b> (Presentó productos, Dejó muestras, Pidió volver otro día, No atendió, Sin acceso).', 'Marcá los <b>productos presentados</b> y, si dejaste, la cantidad de <b>muestras</b> de cada uno.',
        'Escribí observaciones y, si quedaste en volver, la próxima visita.', 'Tocá <b>Guardar visita</b>.'],
      img: [[`m-visita`, 'Resultado'], [`m-visita-productos`, 'Productos y muestras']], m: true },
    { t: 'Cargar un médico', p: ['En el lugar tocá <b>Agregar médico acá</b> (o en <b>Médicos</b>, el botón <b>+ Médico</b>).'],
      pasos: ['Nombre (obligatorio), especialidad, celular y cada cuántos días visitarlo.', 'En <b>Dónde atiende</b> marcá el lugar o los lugares y escribí el <b>horario</b> de cada uno (por ejemplo «Martes y Jueves 17:00 Hs.»). Con los días escritos así, tu supervisor puede ver qué médicos atienden cada día.',
        'Tocá <b>Guardar médico</b>.'],
      img: [[`m-medico-nuevo`, 'Nuevo médico'], [`m-medico-nuevo-completa`, 'Dónde atiende y horario']], m: true,
      nota: 'Si el médico ya está cargado en otro lugar, no lo cargues de nuevo: en el lugar tocá <b>Ya lo tengo cargado</b>, elegilo y poné el horario de ahí.' },
    { t: 'Ya lo tengo cargado: sumar un médico a otro lugar', p: ['Para el mismo médico que atiende en varios lugares. Queda uno solo, con todos sus lugares y horarios.'],
      img: [[`m-ya-cargado`, 'Sumar un médico que ya cargaste']], m: true },
    { t: 'Mis médicos', p: ['En <b>Médicos</b> buscás por nombre, especialidad o lugar, y filtrás los que <b>les toca visita</b>. Cada médico muestra dónde atiende y cuándo lo visitaste. <b>Editar</b> abre su ficha (ahí está <b>Borrar médico</b> si ya no lo visitás).'],
      img: [[`m-medicos`, 'Mis médicos']], m: true },
    { t: 'Cargar un lugar nuevo', p: ['Hacelo <b>parado en el lugar</b>: se guarda la ubicación. En <b>Lugares</b> tocá <b>+ Nuevo lugar</b>, completá nombre, tipo, ciudad, dirección, teléfono y notas (piso, recepción, horario de visitadores) y guardá. Cargarlo ya cuenta como llegada.'],
      img: [[`m-lugar-nuevo`, 'Nuevo lugar'], [`m-lugares`, 'Mis lugares']], m: true,
      nota: 'Si un lugar no lo visitás más, al pie del lugar está <b>Quitar este lugar</b>. Las visitas que hiciste quedan.' },
    { t: 'Mis visitas', p: ['En <b>Visitas</b> ves lo que hiciste por día o por lugar.'], img: [[`m-mis-visitas`, 'Mis visitas']], m: true },
    sinSenal, gps('h'),
  ],
}

// ── Panel de supervisores ──
const panelEntrar = (pref, extra = '') => ({
  t: 'Entrar al panel', p: [`Desde la computadora abrí <b>${URL_APP}</b> e ingresá con Google. El menú de la izquierda lleva a cada sección; abajo elegís modo claro u oscuro y <b>Salir</b>.${extra}`,
    'Arriba aparecen avisos cuando hay algo para revisar (por ejemplo, altas de clientes en zona de otro vendedor).'],
})
const tablero = (pref) => ({ t: 'Tablero semanal', p: ['Por vendedor y por día: visitas realizadas contra la meta (verde la cumple, amarillo cerca, rojo lejos), lo planificado, con pedido, fuera de ruta, km y horas. Con las flechas cambiás de semana.',
  '<b>Tocá un número</b> (por ejemplo 7 / 8) o el total de la semana para ver el detalle: a quién visitó (hora, resultado, observaciones, visita anterior), qué clientes de la ruta no visitó y qué clientes de su zona quedaron sin visitar. Se baja a Excel.'],
  img: [[`${pref}-tablero`, 'Tablero semanal']] })
const reportes = (pref) => ({ t: 'Reportes', p: ['Para un período (esta semana, la pasada, el mes o fechas a elección): visitas, pedidos, cobrado, km, horas y clientes nuevos; el detalle por vendedor; qué pasó en las visitas; cobertura por zona y clientes sin visitar hace tiempo. Cada tabla tiene su Excel.'],
  img: [[`${pref}-reportes`, 'Reportes']] })
const enVivo = (pref, rec) => ({ t: 'En vivo y recorrido del día', p: ['El mapa muestra dónde está cada uno con la jornada abierta: verde si mandó posición hace menos de 5 minutos, amarillo entre 5 y 15, gris sin señal. A la derecha, cuántas visitas lleva y su próxima parada.',
  'Abajo, <b>Recorrido del día</b>: elegí la persona y el día. En azul el recorrido con GPS, en <b>rojo punteado</b> los tramos sin GPS (con el motivo y la batería), las visitas numeradas, las paradas de 10 minutos o más (en clientes sin visita o fuera de ruta) y los excesos de velocidad. La tabla de abajo cuenta todo en orden y se baja a Excel. «Ajustar a calles» dibuja el trazo sobre las calles (aproximado).'],
  img: [[`${pref}-en-vivo`, 'En vivo'], [rec, 'Recorrido del día']], nota: 'Para que el recorrido salga completo, cada uno tiene que tener Traccar activo (ver el manual del vendedor). Solo se registra con la jornada abierta.' })
const usuarios = (pref) => ({ t: 'Usuarios y accesos', p: ['Lista de la gente con su rol (Vendedor, Visitadora médica, Supervisor, Admin), metas del día y la semana, si ya ingresó, si aceptó el GPS y el último envío de Traccar.',
  'Un admin da acceso en el recuadro <b>Dar acceso</b>: nombre, correo de Google de la empresa, celular y rol, y <b>Dar acceso y enviar invitación</b> (la invitación sale por correo; también se puede mandar por WhatsApp). Para quitar el acceso, destildá la casilla de la columna «activo» (pide confirmación). Nadie puede cambiar su propio rol. Los supervisores ven la lista pero no la cambian.'],
  img: [[`${pref}-usuarios`, 'Usuarios']] })
const verComo = (pref) => ({ t: 'Ver la app como…', p: ['Abrí la app del celular de un vendedor o de la visitadora tal como la ve: su ruta de hoy, sus clientes o lugares y sus visitas. Es <b>solo para mirar</b>: no inicia jornada ni guarda nada. Para volver, «Salir de la vista» arriba.'],
  img: [[`${pref}-ver-como`, 'Ver la app como…']] })

const supC44 = {
  archivo: 'Camping 44 - Manual del supervisor', empresa: 'c44', titulo: 'Manual del supervisor', para: 'Supervisores y admin de Camping 44 · Panel en la computadora',
  caps: [
    panelEntrar('s'), tablero('s'),
    { t: 'Detalle de un día o de la semana', p: ['Al tocar un número del tablero se abre abajo el detalle. Sirve para ver por qué no se llegó a la meta: qué clientes quedaron sin visitar de la ruta y de la zona.'], img: [['s-tablero-detalle', 'Detalle de un día']] },
    reportes('s'),
    { t: 'Rutas de la semana', p: ['En <b>Rutas</b> están las rutas de la semana. Para crear una: elegí vendedor, zona y nombre y tocá <b>Crear y planificar</b>.',
      'En el planificador, a la izquierda están los clientes (de la zona, de la cartera del vendedor o todos), con filtro por ciudad. Tocá la letra del día (Lun, Mar…) para sumarlo a ese día, o «Agregar los N de <ciudad>». A la derecha, las paradas del día elegido: subir, bajar, quitar (pide confirmación) u <b>Ordenar</b> por cercanía. <b>Sugerir paradas</b> propone clientes según la meta.',
      'Cuando está lista, <b>Publicar</b>: el vendedor la ve en su Hoy. Abajo se puede <b>Duplicar</b> a otra semana.'],
      img: [['s-rutas', 'Rutas de la semana'], ['s-ruta-planificador', 'Planificador']] },
    enVivo('s', 's-recorrido'),
    { t: 'Recorrido: el detalle', p: ['Cada fila es algo que pasó: inicio, visitas, tramos sin GPS con su motivo, paradas y fin. «Mapa» muestra ese punto.'], img: [['s-recorrido-detalle', 'Detalle cronológico']] },
    { t: 'Clientes', p: ['Buscá por nombre, RUC o ciudad y filtrá por estado, zona o vendedor (los filtros quedan en la dirección: podés recargar o pasar el link).',
      'Tocá un cliente para ver su ficha: última factura, ventas de 6 meses, última visita, ubicación en el mapa e historial de ubicaciones. Ahí podés <b>corregir la ubicación</b> pegando coordenadas o un link de Google Maps (solo en la app, no en Odoo; el motivo es obligatorio).',
      'Para cambiar varios a la vez: marcalos, elegí la zona o el vendedor y tocá <b>Aplicar</b> (pide confirmación).'],
      img: [['s-clientes', 'Clientes'], ['s-cliente-detalle', 'Ficha del cliente'], ['s-clientes-masivo', 'Asignar vendedor a varios']] },
    { t: 'Altas a revisar', p: ['Cuando un vendedor da de alta un cliente en la zona de otro, o a menos de 300 m de clientes de otro, aparece acá (y una franja amarilla arriba). Decidí si lo pasás al vendedor de la zona o queda con quien lo cargó. La visita del alta queda siempre a nombre de quien la hizo.'],
      img: [['s-altas', 'Altas a revisar']] },
    { t: 'Zonas', p: ['Cada zona tiene ciudades, semanas del mes en que se trabaja, frecuencia y responsable. Un cliente nuevo toma la zona de su ciudad. <b>Asignar clientes sin zona por ciudad</b> completa los que falten.'], img: [['s-zonas', 'Zonas']] },
    usuarios('s'), verComo('s'),
  ],
}

const supVit = {
  archivo: 'Vitalica - Manual del supervisor y admin', empresa: 'vit', titulo: 'Manual del supervisor y admin', para: 'Vitalica · Panel en la computadora · Ventas y visita médica',
  caps: [
    panelEntrar('t', ' Arriba del menú está el botón <b>Ventas | Visita médica</b>: cada vista tiene su menú.'),
    { t: 'Las dos vistas: Ventas y Visita médica', p: ['<b>Ventas</b>: los vendedores (por ejemplo Hugo) y sus clientes: tablero, reportes, rutas, en vivo y clientes. La visitadora no aparece acá.',
      '<b>Visita médica</b>: todo lo de la visitadora: actividad del día, médicos, consultorios y lugares, especialidades, ruteo, en vivo y productos. Usuarios y «Ver la app como…» están en las dos.'],
      img: [['t-tablero-ventas', 'Vista Ventas: tablero de los vendedores']] },
    { t: 'Ventas: tablero y reportes', p: ['Igual que en el manual de Camping 44: el tablero muestra visitas contra la meta por día (tocá un número para ver el detalle) y Reportes resume el período con Excel.'], img: [['t-reportes', 'Reportes']] },
    { t: 'Ventas: rutas y clientes', p: ['En <b>Rutas</b> armás la semana del vendedor (crear, planificar por día, publicar). En <b>Clientes</b> buscás, filtrás, abrís la ficha, corregís ubicaciones y asignás vendedor a varios a la vez.'],
      img: [['t-rutas', 'Rutas'], ['t-clientes', 'Clientes']] },
    { t: 'Ventas: en vivo y recorrido', p: ['Dónde está cada vendedor y, abajo, el <b>Recorrido del día</b>: en azul con GPS, en rojo punteado sin GPS (con motivo y batería), visitas, paradas fuera de ruta y excesos de velocidad.'],
      img: [['t-en-vivo-ventas', 'En vivo'], ['t-recorrido', 'Recorrido del día']] },
    { t: 'Visita médica: Actividad', p: ['Qué hizo la visitadora en el día, <b>hora por hora</b>: a qué hora inició la jornada, a qué lugar llegó, a qué médico vio (especialidad y lugar) y qué dejó: resultado, productos, muestras, observaciones y próxima visita.',
      'Con las flechas cambiás de día. A la derecha, los últimos 7 días (lugares, médicos, muestras): tocá un día para ver su detalle. <b>Excel del día</b> baja todo.'],
      img: [['t-actividad', 'Actividad del día']] },
    { t: 'Visita médica: Médicos', p: ['Todos los médicos: especialidad, dónde atienden, qué días (Lun, Mar…, leídos del horario que escribe la visitadora), horario, cada cuánto se visitan y la última visita.',
      'Filtrá por especialidad, consultorio, <b>día que atiende</b> o «le toca visita». Tocá un médico para ver <b>todas sus visitas</b> (fecha, lugar, resultado, productos y observaciones). Excel.'],
      img: [['t-medicos-martes', 'Médicos que atienden el martes'], ['t-medico-historial', 'Historial de un médico']],
      nota: 'Si un médico no tiene horario cargado, no aparece al filtrar por día. Pedile a la visitadora que lo complete en su ficha.' },
    { t: 'Visita médica: Consultorios y lugares', p: ['Cada hospital, sanatorio o consultorio con cuántos médicos tiene, sus especialidades, la <b>última llegada</b> de la visitadora y la última visita. Tocá un lugar para ver sus médicos con días y horarios, abrirlo en Google Maps o ver esos médicos con sus visitas.',
      'Abajo, <b>Cargar lugares</b>: pegá una lista (uno por renglón, la dirección después de « - ») para tenerlos antes de que pase la visitadora. La ubicación la toma ella al llegar.'],
      img: [['t-lugares', 'Consultorios y lugares']] },
    { t: 'Visita médica: Especialidades', p: ['Cuántos médicos hay de cada especialidad, en cuántos lugares, cuántos se visitaron en el período (30, 60 o 90 días) y a cuántos les toca visita. Las escritas distinto («Clínica Medica» y «Clínica médica») se cuentan juntas. Tocá una para ver sus médicos.'],
      img: [['t-especialidades', 'Especialidades']] },
    { t: 'Visita médica: Ruteo de la semana', p: ['Por día: los lugares, a qué médico o especialidad ir, la llegada aproximada (≈) o la <b>hora real</b> en que marcó «Llegué acá» (en verde; si volvió en el día, todas las horas), el resultado y el estado (Pendiente, Visitado, Llegó, Reprogramado, Sin acceso, No atendió, No visitado). Excel.',
      'Abajo, <b>Cargar ruteo</b>: copiá la planilla de Google Sheets con los títulos (Centro médico / Consultorio, Especialidad, Dr, Día de visita) y pegala. Crea los lugares y médicos que falten y arma la semana.'],
      img: [['t-ruteo', 'Ruteo de la semana']] },
    { t: 'Visita médica: En vivo', p: ['Dónde está la visitadora ahora, en qué lugar está y desde qué hora, y su recorrido del día (abajo).'], img: [['t-en-vivo', 'Visitadoras en vivo']] },
    { t: 'Visita médica: Productos y muestras', p: ['Qué productos se presentaron en el período, a cuántos médicos y cuántas muestras se dejaron. La lista de productos llega sola de Odoo (lo que facturó Vitalica en 12 meses); un admin puede ocultar o agregar productos.'],
      img: [['t-productos', 'Productos y muestras']] },
    usuarios('t'), verComo('t'),
  ],
}

export const MANUALES = [vendC44, supC44, vendVit, visitadora, supVit]
