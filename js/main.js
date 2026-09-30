// ===== Conversor 3D Concurrente · hilo principal (Main Thread) =====
// Commit 2: conversión funcional OBJ/PLY/OFF/STL/GLB -> STL.
// (Todavía corre en el hilo principal; en el commit 3 se mueve a un Web Worker.)

'use strict';

/** Escribe una línea en el panel de log de la UI. */
function log(mensaje) {
  const el = document.getElementById('log');
  if (!el) return;
  const hora = new Date().toLocaleTimeString('es-MX');
  el.textContent += `[${hora}] ${mensaje}\n`;
  el.scrollTop = el.scrollHeight;
}

/** Formatea un tamaño en bytes a algo legible. */
function formatoTamano(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(2) + ' MB';
}

/** Lee un File como texto o ArrayBuffer según el formato. */
function leerArchivo(file, binario) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    if (binario) fr.readAsArrayBuffer(file);
    else fr.readAsText(file);
  });
}

/** Dispara la descarga de un Blob con el nombre dado. */
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

/** Convierte un solo archivo y agrega su tarjeta con enlace de descarga. */
async function convertirArchivo(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const nombreBase = file.name.replace(/\.[^.]+$/, '');
  log(`Procesando "${file.name}" (.${ext})...`);

  try {
    const binario = Geometria.esFormatoBinario(ext);
    const data = await leerArchivo(file, binario);

    const t0 = performance.now();
    const malla = Geometria.parsearModelo(ext, data, nombreBase);
    const stl = Geometria.exportSTLbinario(malla);
    const ms = (performance.now() - t0).toFixed(1);

    const nVerts = malla.positions.length / 3;
    const nTris = malla.indices.length / 3;
    const blob = new Blob([stl], { type: 'model/stl' });

    log(`✔ "${file.name}": ${nVerts} vértices, ${nTris} triángulos en ${ms} ms.`);
    agregarTarjeta(nombreBase + '.stl', nVerts, nTris, blob);
  } catch (err) {
    log(`✖ Error en "${file.name}": ${err.message}`);
  }
}

/** Agrega una tarjeta de resultado a la lista de trabajos. */
function agregarTarjeta(nombre, nVerts, nTris, blob) {
  const li = document.createElement('li');
  li.className = 'trabajo';
  li.innerHTML =
    `<strong>${nombre}</strong>` +
    `<span class="meta">${nTris.toLocaleString('es-MX')} triángulos · ${formatoTamano(blob.size)}</span>`;
  const btn = document.createElement('button');
  btn.textContent = 'Descargar STL';
  btn.className = 'btn-descargar';
  btn.addEventListener('click', () => descargar(blob, nombre));
  li.appendChild(btn);
  document.getElementById('lista-trabajos').appendChild(li);
}

/** Procesa una lista de archivos (FileList o array). */
function procesarArchivos(files) {
  for (const f of files) convertirArchivo(f);
}

function init() {
  log('App iniciada. Motor de conversión listo (OBJ/PLY/OFF/STL/GLB → STL).');

  const dropzone = document.getElementById('dropzone');
  const input = document.getElementById('file-input');

  dropzone.addEventListener('click', () => input.click());
  input.addEventListener('change', (e) => procesarArchivos(e.target.files));

  // Arrastrar y soltar.
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
