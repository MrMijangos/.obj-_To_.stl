// ===== Visualizador 3D en Canvas 2D (Vanilla, sin WebGL ni librerías) =====
// Proyecta una malla (sopa de triángulos) a 2D, con rotación por arrastre,
// sombreado plano + culling de caras traseras y ordenado por profundidad
// (algoritmo del pintor). NOTA: corre en el hilo principal porque necesita el DOM.

'use strict';

const Visor = (function () {
  let cvs, ctx;
  let tris = null;      // Float32Array: 9 floats por triángulo (x,y,z * 3)
  let nTri = 0;
  let centro = [0, 0, 0];
  let escala = 1;
  let rotX = 0.5, rotY = 0.6;
  let modo = 'solido';  // 'solido' | 'wireframe'
  let arrastrando = false, lastX = 0, lastY = 0;
  let pendiente = false;

  function init() {
    cvs = document.getElementById('visor');
    if (!cvs) return;
    ctx = cvs.getContext('2d');

    cvs.addEventListener('mousedown', (e) => {
      arrastrando = true; lastX = e.clientX; lastY = e.clientY;
    });
    window.addEventListener('mouseup', () => { arrastrando = false; });
    window.addEventListener('mousemove', (e) => {
      if (!arrastrando) return;
      rotY += (e.clientX - lastX) * 0.01;
      rotX += (e.clientY - lastY) * 0.01;
      lastX = e.clientX; lastY = e.clientY;
      solicitarRender();
    });

    dibujarMensaje('Convierte o genera un modelo para verlo aquí');
  }

  /** Carga una malla (sopa de triángulos) y la centra/escala para encuadrarla. */
  function setModelo(soup) {
    tris = soup;
    nTri = soup.length / 9;

    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < soup.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = soup[i + k];
        if (v < min[k]) min[k] = v;
        if (v > max[k]) max[k] = v;
      }
    }
    centro = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const d = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
    escala = 1 / d;
    solicitarRender();
  }

  function setModo(m) { modo = m; solicitarRender(); }

  function solicitarRender() {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(() => { pendiente = false; render(); });
  }

  /** Centra, escala y rota un punto; devuelve coords proyectadas (y hacia arriba). */
  function proyecta(x, y, z) {
    x = (x - centro[0]) * escala;
    y = (y - centro[1]) * escala;
    z = (z - centro[2]) * escala;
    // Rotación en Y
    const cy = Math.cos(rotY), sy = Math.sin(rotY);
    let x1 = x * cy + z * sy;
    let z1 = -x * sy + z * cy;
    // Rotación en X
    const cx = Math.cos(rotX), sx = Math.sin(rotX);
    let y1 = y * cx - z1 * sx;
    let z2 = y * sx + z1 * cx;
    return [x1, y1, z2]; // z2 = profundidad (viewer en +z)
  }

  function render() {
    if (!ctx) return;
    const W = cvs.width, H = cvs.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0a0c12';
    ctx.fillRect(0, 0, W, H);
    if (!tris) return;

    const s = Math.min(W, H) * 0.42;
    const ox = W / 2, oy = H / 2;

    // Proyectar todos los vértices y calcular profundidad media por triángulo.
    const px = new Float32Array(nTri * 3);
    const py = new Float32Array(nTri * 3);
    const pz = new Float32Array(nTri * 3);
    const prof = new Float32Array(nTri);
    for (let t = 0; t < nTri; t++) {
      let zsum = 0;
      for (let v = 0; v < 3; v++) {
        const idx = t * 9 + v * 3;
        const p = proyecta(tris[idx], tris[idx + 1], tris[idx + 2]);
        px[t * 3 + v] = p[0];
        py[t * 3 + v] = p[1];
        pz[t * 3 + v] = p[2];
        zsum += p[2];
      }
      prof[t] = zsum / 3;
    }

    if (modo === 'wireframe') {
      ctx.strokeStyle = 'rgba(91,140,255,0.7)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let t = 0; t < nTri; t++) {
        const a = t * 3;
        ctx.moveTo(ox + px[a] * s, oy - py[a] * s);
        ctx.lineTo(ox + px[a + 1] * s, oy - py[a + 1] * s);
        ctx.lineTo(ox + px[a + 2] * s, oy - py[a + 2] * s);
        ctx.closePath();
      }
      ctx.stroke();
      return;
    }

    // Sólido: ordenar por profundidad (lejos → cerca) y rellenar con sombreado.
    const orden = Array.from({ length: nTri }, (_, i) => i);
    orden.sort((a, b) => prof[a] - prof[b]);

    // Luz normalizada.
    let lx = 0.4, ly = 0.5, lz = 0.75;
    const ll = Math.hypot(lx, ly, lz); lx /= ll; ly /= ll; lz /= ll;

    for (const t of orden) {
      const a = t * 3;
      const ax = px[a], ay = py[a], az = pz[a];
      const bx = px[a + 1], by = py[a + 1], bz = pz[a + 1];
      const cx = px[a + 2], cy = py[a + 2], cz = pz[a + 2];

      // Normal de la cara (en espacio proyectado).
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;

      if (nz < 0) continue; // culling: cara trasera

      let shade = nx * lx + ny * ly + nz * lz;
      shade = Math.max(0.15, Math.min(1, shade));
      const r = Math.round(70 * shade);
      const g = Math.round(120 * shade);
      const b = Math.round(230 * shade);

      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.beginPath();
      ctx.moveTo(ox + ax * s, oy - ay * s);
      ctx.lineTo(ox + bx * s, oy - by * s);
      ctx.lineTo(ox + cx * s, oy - cy * s);
      ctx.closePath();
      ctx.fill();
    }
  }

  function dibujarMensaje(texto) {
    if (!ctx) return;
    ctx.fillStyle = '#0a0c12';
    ctx.fillRect(0, 0, cvs.width, cvs.height);
    ctx.fillStyle = '#9aa0b0';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(texto, cvs.width / 2, cvs.height / 2);
    ctx.textAlign = 'start';
  }

  return { init, setModelo, setModo };
})();
