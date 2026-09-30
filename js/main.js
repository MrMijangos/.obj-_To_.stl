// ===== Conversor 3D Concurrente · hilo principal (Main Thread) =====
// Commit 1: solo la estructura base y utilidades de log.
// La lógica de conversión, workers y visor se agrega en commits siguientes.

'use strict';

/** Escribe una línea en el panel de log de la UI. */
function log(mensaje, tipo = 'info') {
  const el = document.getElementById('log');
  if (!el) return;
  const hora = new Date().toLocaleTimeString('es-MX');
  el.textContent += `[${hora}] ${mensaje}\n`;
  el.scrollTop = el.scrollHeight;
}

function init() {
  log('App iniciada. Estructura base lista.');
  log('Pendiente: parser OBJ, Web Worker, visor y Service Worker.');

  // Abrir el selector de archivos al hacer clic en la zona de arrastre.
  const dropzone = document.getElementById('dropzone');
  const input = document.getElementById('file-input');
  if (dropzone && input) {
    dropzone.addEventListener('click', () => input.click());
  }
}

document.addEventListener('DOMContentLoaded', init);
