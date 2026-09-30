// ===== Dedicated Web Worker · conversión a STL =====
// Corre en un hilo aparte del hilo principal (main thread). Aquí sucede la
// "tarea pesada": parsear la malla y exportar el STL. Así la UI nunca se congela.
//
// Comunicación por paso de mensajes (postMessage / onmessage). No hay acceso al
// DOM ni a variables del hilo principal: todo entra y sale serializado.

'use strict';

// Reutiliza el mismo motor de geometría que el hilo principal.
// La ruta es relativa a ESTE archivo (js/), así que resuelve a js/geometry.js.
importScripts('geometry.js');

self.onmessage = function (e) {
  const msg = e.data;
  if (msg.tipo !== 'convertir') return;

  const { id, ext, nombre, data, segmentos } = msg;

  try {
    self.postMessage({ tipo: 'inicio', id });

    // Fase 1: obtener la malla (0 → 40%).
    // 'esfera' = malla de prueba generada aquí mismo; el resto = archivo real.
    const malla = ext === 'esfera'
      ? self.Geometria.generarEsfera(segmentos)
      : self.Geometria.parsearModelo(ext, data, nombre);
    self.postMessage({ tipo: 'progreso', id, pct: 40 });

    // Fase 2: exportación a STL binario (40 → 100%).
    const stl = self.Geometria.exportSTLbinario(malla, (f) => {
      self.postMessage({ tipo: 'progreso', id, pct: 40 + Math.round(f * 60) });
    });

    const nVerts = malla.positions.length / 3;
    const nTris = malla.indices.length / 3;

    // Malla reducida para la vista previa 2D (el DOM/canvas solo existe en el
    // hilo principal; el worker solo prepara los datos).
    const preview = self.Geometria.mallaPreviewSoup(malla, 20000);

    // El STL y la preview se TRANSFIEREN (Transferable Objects): no se copian,
    // se mueven los ArrayBuffer al hilo principal → menor latencia.
    self.postMessage(
      { tipo: 'resultado', id, stl, nVerts, nTris, preview: preview.buffer },
      [stl, preview.buffer]
    );
  } catch (err) {
    self.postMessage({ tipo: 'error', id, mensaje: err.message });
  }
};
