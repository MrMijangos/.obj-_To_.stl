// ===== Conversor 3D Concurrente · hilo principal (Main Thread) =====
// Commit 3: la conversión pesada se ejecuta en Dedicated Web Workers.
// El hilo principal solo coordina (UI, cola, mensajes) y NUNCA se bloquea.

'use strict';

/* ---------------------------------------------------------------------------
 * Estado del pool de workers
 * ------------------------------------------------------------------------- */

const cola = [];                 // trabajos pendientes (esperando un worker libre)
const activos = new Map();       // id -> { worker, refs, pct, nombre }
const MAX = navigator.hardwareConcurrency || 4;  // workers en paralelo
let seqId = 0;                   // generador de ids de trabajo

/* ---------------------------------------------------------------------------
 * Utilidades
 * ------------------------------------------------------------------------- */

function log(mensaje) {
  const el = document.getElementById('log');
  if (!el) return;
  const hora = new Date().toLocaleTimeString('es-MX');
  el.textContent += `[${hora}] ${mensaje}\n`;
  el.scrollTop = el.scrollHeight;
}

function formatoTamano(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(2) + ' MB';
}

function leerArchivo(file, binario) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    if (binario) fr.readAsArrayBuffer(file);
    else fr.readAsText(file);
  });
}

function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ---------------------------------------------------------------------------
 * Tarjetas de trabajo (UI)
 * ------------------------------------------------------------------------- */

/** Crea la tarjeta de un trabajo y devuelve referencias a sus elementos. */
function crearTarjeta(job) {
  const li = document.createElement('li');
  li.className = 'trabajo';

  const titulo = document.createElement('strong');
  titulo.textContent = job.nombre;

  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = 'En cola…';

  const barra = document.createElement('div');
  barra.className = 'barra-progreso';
  const relleno = document.createElement('div');
  relleno.className = 'barra-relleno';
  barra.appendChild(relleno);

  const boton = document.createElement('button');
  boton.className = 'btn-cancelar';
  boton.textContent = 'Cancelar';
  boton.addEventListener('click', () => cancelarJob(job));

  li.append(titulo, meta, barra, boton);
  document.getElementById('lista-trabajos').prepend(li);

  return { li, meta, relleno, boton };
}

/** Agrega un botón de descarga del STL a una tarjeta ya terminada. */
function agregarDescarga(li, blob, nombreArchivo) {
  const b = document.createElement('button');
  b.className = 'btn-descargar';
  b.textContent = 'Descargar STL';
  b.addEventListener('click', () => descargar(blob, nombreArchivo));
  li.appendChild(b);
}

/** Agrega un botón para ver el modelo en el visor 3D. */
function agregarVer(li, preview) {
  const b = document.createElement('button');
  b.className = 'btn-ver';
  b.textContent = 'Ver 3D';
  b.addEventListener('click', () => Visor.setModelo(preview));
  li.appendChild(b);
}

/* ---------------------------------------------------------------------------
 * Encolado y despacho de trabajos
 * ------------------------------------------------------------------------- */

/** (Re)crea el botón Cancelar de una tarjeta y lo registra como refs.boton. */
function ponerCancelar(job) {
  const b = document.createElement('button');
  b.className = 'btn-cancelar';
  b.textContent = 'Cancelar';
  b.addEventListener('click', () => cancelarJob(job));
  job.refs.li.appendChild(b);
  job.refs.boton = b;
}

/** Despacha un trabajo de SOLO VISTA PREVIA (para archivos subidos). */
function encolarPreview(job) {
  job.fase = 'preview';
  job.refs = crearTarjeta(job);
  cola.push(job);
  log(`Vista previa en cola: "${job.nombre}".`);
  lanzarSiguientes();
}

/** Despacha un trabajo de CONVERSIÓN a STL (crea tarjeta si no existe). */
function encolarConversion(job) {
  job.fase = 'convertir';
  if (!job.refs) job.refs = crearTarjeta(job);

  // Modo comparativo: ejecutar en el hilo principal (bloquea la UI a propósito).
  const sinWorker = document.getElementById('modo-sin-worker');
  if (sinWorker && sinWorker.checked) {
    convertirSinWorker(job);
    return;
  }

  cola.push(job);
  log(`Conversión en cola: "${job.nombre}" (${cola.length} en cola, ${activos.size}/${MAX} activos).`);
  lanzarSiguientes();
}

/** Convierte a STL un modelo que ya está en vista previa. */
function convertirDesdePreview(job) {
  job.refs.relleno.style.width = '0%';
  job.refs.meta.textContent = 'En cola…';
  encolarConversion(job);
}

/**
 * Convierte en el HILO PRINCIPAL (sin worker). Sirve para DEMOSTRAR el problema:
 * durante el cálculo la UI se congela (FPS cae a 0, la animación se detiene).
 * NO usar en producción; es solo para comparar contra el modo con worker.
 */
async function convertirSinWorker(job) {
  if (job.refs.boton) job.refs.boton.remove(); // no se puede cancelar: el hilo se bloqueará
  job.refs.meta.textContent = 'Procesando SIN worker (la UI se congelará)…';
  log(`⚠ "${job.nombre}" corriendo en el HILO PRINCIPAL (bloqueará la UI).`);

  let data = null;
  if (job.origen !== 'generar') {
    const binario = Geometria.esFormatoBinario(job.ext);
    data = await leerArchivo(job.file, binario);
  }

  // Dar un frame para pintar el estado antes de bloquear el hilo.
  await new Promise((r) => setTimeout(r, 60));

  try {
    const t0 = performance.now();
    const malla = job.origen === 'generar'
      ? Geometria.generarEsfera(job.segmentos)
      : Geometria.parsearModelo(job.ext, data, job.nombre);
    const stl = Geometria.exportSTLbinario(malla); // sin progreso: el hilo está ocupado
    const ms = performance.now() - t0;

    const blob = new Blob([stl], { type: 'model/stl' });
    const nTris = malla.indices.length / 3;
    job.refs.relleno.style.width = '100%';
    job.refs.meta.textContent =
      `${nTris.toLocaleString('es-MX')} triángulos · ${formatoTamano(blob.size)} · ${ms.toFixed(0)} ms (main thread, bloqueó)`;
    agregarDescarga(job.refs.li, blob, job.nombre + '.stl');
    const preview = Geometria.mallaPreviewSoup(malla, 20000);
    if (!job.refs.li.querySelector('.btn-ver')) agregarVer(job.refs.li, preview);
    Visor.setModelo(preview);
    log(`✔ (sin worker) "${job.nombre}": ${nTris} triángulos en ${ms.toFixed(0)} ms — la UI estuvo congelada.`);
  } catch (err) {
    job.refs.meta.textContent = 'Error: ' + err.message;
    job.refs.li.classList.add('trabajo-error');
    log(`✖ Error en "${job.nombre}": ${err.message}`);
  }
}

/** Lanza trabajos mientras haya workers libres y cosas en la cola. */
function lanzarSiguientes() {
  while (activos.size < MAX && cola.length > 0) {
    iniciarJob(cola.shift());
  }
}

/** Inicia un trabajo en un Web Worker dedicado. */
async function iniciarJob(job) {
  // Reservar el espacio del pool YA (antes de leer el archivo, que es asíncrono)
  // para no exceder MAX si llegan varios trabajos de golpe.
  const entry = { worker: null, refs: job.refs, pct: 0, nombre: job.nombre };
  activos.set(job.id, entry);
  actualizarMonitor();

  job.refs.meta.textContent = job.fase === 'preview' ? 'Analizando…' : 'Iniciando…';

  const worker = new Worker('js/worker-conversion.js');
  entry.worker = worker;
  worker.onmessage = (e) => manejarMensaje(job, e.data);
  worker.onerror = (e) => {
    log(`✖ Error del worker en "${job.nombre}": ${e.message}`);
    job.refs.meta.textContent = 'Error del worker';
    job.refs.li.classList.add('trabajo-error');
    terminarJob(job.id);
    lanzarSiguientes();
  };

  const mensaje = { tipo: 'convertir', id: job.id, nombre: job.nombre };
  mensaje.soloPreview = job.fase === 'preview';
  let transfer = [];

  if (job.origen === 'generar') {
    // La malla pesada se genera DENTRO del worker (también es tarea pesada).
    mensaje.ext = 'esfera';
    mensaje.segmentos = job.segmentos;
  } else {
    const binario = Geometria.esFormatoBinario(job.ext);
    const data = await leerArchivo(job.file, binario);
    mensaje.ext = job.ext;
    mensaje.data = data;
    // Transferable Object: mover el ArrayBuffer de entrada al worker (sin copiar).
    if (binario && data instanceof ArrayBuffer) transfer = [data];
  }

  // El trabajo pudo cancelarse mientras se leía el archivo.
  if (!activos.has(job.id)) { worker.terminate(); return; }

  worker.postMessage(mensaje, transfer);
}

/** Procesa cada mensaje que envía el worker. */
function manejarMensaje(job, msg) {
  const entry = activos.get(job.id);
  if (!entry) return; // ya se canceló/terminó

  switch (msg.tipo) {
    case 'inicio':
      job.refs.meta.textContent = job.fase === 'preview' ? 'Analizando modelo…' : 'Convirtiendo…';
      break;

    case 'progreso':
      entry.pct = msg.pct;
      job.refs.relleno.style.width = msg.pct + '%';
      actualizarMonitor();
      break;

    case 'preview': {
      const preview = new Float32Array(msg.preview);
      job.refs.relleno.style.width = '100%';
      job.refs.meta.textContent =
        `Vista previa · ${msg.nTris.toLocaleString('es-MX')} triángulos (sin convertir aún)`;
      if (job.refs.boton) job.refs.boton.remove(); // quitar Cancelar
      // Botón para convertir a STL solo si el usuario lo decide.
      const bconv = document.createElement('button');
      bconv.className = 'btn-descargar';
      bconv.textContent = 'Convertir a STL';
      bconv.addEventListener('click', () => { bconv.remove(); convertirDesdePreview(job); });
      job.refs.li.appendChild(bconv);
      agregarVer(job.refs.li, preview);
      Visor.setModelo(preview);
      log(`👁 Vista previa "${job.nombre}": ${msg.nTris} triángulos. Pulsa "Convertir a STL" para exportar.`);
      terminarJob(job.id);
      lanzarSiguientes();
      break;
    }

    case 'resultado': {
      const blob = new Blob([msg.stl], { type: 'model/stl' });
      job.refs.relleno.style.width = '100%';
      job.refs.meta.textContent =
        `${msg.nTris.toLocaleString('es-MX')} triángulos · ${formatoTamano(blob.size)}`;
      if (job.refs.boton) job.refs.boton.remove(); // quitar Cancelar
      agregarDescarga(job.refs.li, blob, job.nombre + '.stl');
      const preview = new Float32Array(msg.preview);
      if (!job.refs.li.querySelector('.btn-ver')) agregarVer(job.refs.li, preview);
      Visor.setModelo(preview); // auto-previsualizar el más reciente
      log(`✔ "${job.nombre}": ${msg.nVerts} vértices, ${msg.nTris} triángulos.`);
      terminarJob(job.id);
      lanzarSiguientes();
      break;
    }

    case 'error':
      job.refs.meta.textContent = 'Error: ' + msg.mensaje;
      job.refs.li.classList.add('trabajo-error');
      if (job.refs.boton) job.refs.boton.remove();
      log(`✖ Error en "${job.nombre}": ${msg.mensaje}`);
      terminarJob(job.id);
      lanzarSiguientes();
      break;
  }
}

/** Termina el worker de un trabajo y lo saca del pool (evita fugas de memoria). */
function terminarJob(id) {
  const entry = activos.get(id);
  if (entry && entry.worker) entry.worker.terminate();
  activos.delete(id);
  actualizarMonitor();
}

/** Cancela un trabajo, esté en cola o en ejecución. */
function cancelarJob(job) {
  const i = cola.indexOf(job);
  if (i >= 0) cola.splice(i, 1); // aún no había arrancado
  terminarJob(job.id);           // si estaba activo, mata el worker
  job.refs.meta.textContent = 'Cancelado';
  job.refs.li.classList.add('trabajo-cancelado');
  job.refs.boton.remove();
  log(`⨯ Cancelado "${job.nombre}".`);
  lanzarSiguientes();
}

/* ---------------------------------------------------------------------------
 * Monitor de hilos (chips de workers activos)
 * ------------------------------------------------------------------------- */

function actualizarMonitor() {
  const cont = document.getElementById('pool-workers');
  cont.innerHTML = '';
  for (const [id, entry] of activos) {
    const chip = document.createElement('span');
    chip.className = 'worker-chip';
    chip.textContent = `W${id} · ${entry.pct}%`;
    cont.appendChild(chip);
  }
  if (activos.size === 0) {
    const chip = document.createElement('span');
    chip.className = 'worker-chip inactivo';
    chip.textContent = 'sin workers activos';
    cont.appendChild(chip);
  }
}

/* ---------------------------------------------------------------------------
 * Indicadores de fluidez de la UI (FPS + animación "latido")
 * Ambos dependen de requestAnimationFrame: si el hilo principal se bloquea,
 * dejan de actualizarse — evidencia visual de un congelamiento.
 * ------------------------------------------------------------------------- */

let framesFPS = 0;
let ultimoFPS = performance.now();

function loopIndicadores(now) {
  // --- FPS: contar frames y refrescar cada 500 ms ---
  framesFPS++;
  if (now - ultimoFPS >= 500) {
    const fps = Math.round((framesFPS * 1000) / (now - ultimoFPS));
    const el = document.getElementById('fps');
    el.textContent = fps + ' FPS';
    el.className = fps >= 50 ? '' : fps >= 20 ? 'fps-medio' : 'fps-malo';
    framesFPS = 0;
    ultimoFPS = now;
  }

  // --- Latido: pelota que va y viene (usa "left", propiedad de layout) ---
  const t = (now / 1000) % 2;        // ciclo de 2 s
  const p = t < 1 ? t : 2 - t;       // ping-pong 0→1→0
  const latido = document.getElementById('latido');
  if (latido) latido.style.left = (p * 90) + '%';

  requestAnimationFrame(loopIndicadores);
}

/* ---------------------------------------------------------------------------
 * Entradas de usuario
 * ------------------------------------------------------------------------- */

function procesarArchivos(files) {
  for (const file of files) {
    const ext = file.name.split('.').pop().toLowerCase();
    const nombre = file.name.replace(/\.[^.]+$/, '');
    // Los archivos subidos primero se PREVISUALIZAN; se convierten a demanda.
    encolarPreview({ id: ++seqId, origen: 'archivo', file, ext, nombre });
  }
}

function generarModeloPrueba() {
  const input = document.getElementById('seg-input');
  let segmentos = parseInt(input.value, 10) || 700;
  segmentos = Math.max(50, Math.min(4000, segmentos)); // acotar
  // El modelo de prueba (carga) sí se convierte directamente.
  encolarConversion({ id: ++seqId, origen: 'generar', segmentos, nombre: `prueba_esfera_${segmentos}` });
}

/** Muestra cuántos triángulos/tamaño aprox. generará la resolución elegida. */
function actualizarInfoResolucion() {
  const seg = parseInt(document.getElementById('seg-input').value, 10) || 0;
  const tris = seg * seg * 2;
  const mb = (84 + tris * 50) / 1048576;
  document.getElementById('seg-info').textContent =
    `≈ ${tris.toLocaleString('es-MX')} triángulos · STL ~${mb.toFixed(0)} MB`;
}

function init() {
  log(`App lista. Pool de hasta ${MAX} workers (hardwareConcurrency).`);
  actualizarMonitor();
  requestAnimationFrame(loopIndicadores); // arrancar FPS + latido
  Visor.init();

  // Botones de modo del visor.
  const btnSolido = document.getElementById('btn-solido');
  const btnWire = document.getElementById('btn-wire');
  if (btnSolido && btnWire) {
    btnSolido.addEventListener('click', () => {
      Visor.setModo('solido');
      btnSolido.classList.add('activo');
      btnWire.classList.remove('activo');
    });
    btnWire.addEventListener('click', () => {
      Visor.setModo('wireframe');
      btnWire.classList.add('activo');
      btnSolido.classList.remove('activo');
    });
  }

  // Botones de zoom / reset del visor.
  const bZin = document.getElementById('btn-zoom-in');
  const bZout = document.getElementById('btn-zoom-out');
  const bReset = document.getElementById('btn-reset');
  if (bZin) bZin.addEventListener('click', () => Visor.zoomBy(1.25));
  if (bZout) bZout.addEventListener('click', () => Visor.zoomBy(1 / 1.25));
  if (bReset) bReset.addEventListener('click', () => Visor.resetVista());

  const dropzone = document.getElementById('dropzone');
  const input = document.getElementById('file-input');
  const btnPrueba = document.getElementById('btn-generar');

  dropzone.addEventListener('click', () => input.click());
  input.addEventListener('change', (e) => procesarArchivos(e.target.files));
  if (btnPrueba) btnPrueba.addEventListener('click', generarModeloPrueba);

  const segInput = document.getElementById('seg-input');
  if (segInput) {
    segInput.addEventListener('input', actualizarInfoResolucion);
    actualizarInfoResolucion();
  }

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('activo');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('activo'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('activo');
    procesarArchivos(e.dataTransfer.files);
  });
}

document.addEventListener('DOMContentLoaded', init);
