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

/* ---------------------------------------------------------------------------
 * Encolado y despacho de trabajos
 * ------------------------------------------------------------------------- */

/** Encola un trabajo (de archivo o generado) y trata de lanzarlo. */
function encolar(job) {
  job.refs = crearTarjeta(job);
  cola.push(job);
  log(`Encolado "${job.nombre}" (${cola.length} en cola, ${activos.size}/${MAX} activos).`);
  lanzarSiguientes();
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

  job.refs.meta.textContent = 'Iniciando…';

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
      job.refs.meta.textContent = 'Procesando…';
      break;

    case 'progreso':
      entry.pct = msg.pct;
      job.refs.relleno.style.width = msg.pct + '%';
      actualizarMonitor();
      break;

    case 'resultado': {
      const blob = new Blob([msg.stl], { type: 'model/stl' });
      job.refs.relleno.style.width = '100%';
      job.refs.meta.textContent =
        `${msg.nTris.toLocaleString('es-MX')} triángulos · ${formatoTamano(blob.size)}`;
      // Reemplazar el botón Cancelar por Descargar.
      job.refs.boton.textContent = 'Descargar STL';
      job.refs.boton.className = 'btn-descargar';
      const nombreArchivo = job.nombre + '.stl';
      job.refs.boton.replaceWith(job.refs.boton.cloneNode(true)); // limpiar listeners
      const nuevoBoton = job.refs.li.querySelector('.btn-descargar');
      nuevoBoton.addEventListener('click', () => descargar(blob, nombreArchivo));
      log(`✔ "${job.nombre}": ${msg.nVerts} vértices, ${msg.nTris} triángulos.`);
      terminarJob(job.id);
      lanzarSiguientes();
      break;
    }

    case 'error':
      job.refs.meta.textContent = 'Error: ' + msg.mensaje;
      job.refs.li.classList.add('trabajo-error');
      job.refs.boton.remove();
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
 * Entradas de usuario
 * ------------------------------------------------------------------------- */

function procesarArchivos(files) {
  for (const file of files) {
    const ext = file.name.split('.').pop().toLowerCase();
    const nombre = file.name.replace(/\.[^.]+$/, '');
    encolar({ id: ++seqId, origen: 'archivo', file, ext, nombre });
  }
}

function generarModeloPrueba() {
  const input = document.getElementById('seg-input');
  let segmentos = parseInt(input.value, 10) || 700;
  segmentos = Math.max(50, Math.min(4000, segmentos)); // acotar
  encolar({ id: ++seqId, origen: 'generar', segmentos, nombre: `prueba_esfera_${segmentos}` });
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
