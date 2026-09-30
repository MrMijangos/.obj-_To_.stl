// ===== Motor de geometría · funciones puras (sin DOM) =====
// Se usa tanto en el hilo principal como dentro del Web Worker.
//
// Representación interna de una malla:
//   {
//     positions: Float32Array,  // [x0,y0,z0, x1,y1,z1, ...]  (3 por vértice)
//     indices:   Uint32Array,   // [a,b,c, ...]  (3 por triángulo)
//     name:      string
//   }
//
// Formatos de ENTRADA soportados:  OBJ, PLY (ascii), OFF, STL (ascii/binario), GLB
// Formato de SALIDA:               STL (ascii o binario)

'use strict';

/* ---------------------------------------------------------------------------
 * Utilidades vectoriales mínimas
 * ------------------------------------------------------------------------- */

/** Normal unitaria de un triángulo (a, b, c son [x,y,z]). */
function normalTriangulo(ax, ay, az, bx, by, bz, cx, cy, cz) {
  // u = b - a ;  v = c - a ;  n = u x v
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

/* ---------------------------------------------------------------------------
 * PARSERS DE ENTRADA
 * ------------------------------------------------------------------------- */

/** OBJ: vértices "v x y z" y caras "f a b c ..." (con triangulación en abanico). */
function parseOBJ(texto, name) {
  const verts = [];   // posiciones planas
  const idx = [];     // índices de triángulos
  const lineas = texto.split('\n');

  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i].trim();
    if (l.length === 0 || l[0] === '#') continue;
    const p = l.split(/\s+/);

    if (p[0] === 'v') {
      verts.push(+p[1], +p[2], +p[3]);
    } else if (p[0] === 'f') {
      // Cada token puede ser "v", "v/vt", "v/vt/vn" o "v//vn".
      // Los índices OBJ son base 1; los negativos son relativos al final.
      const nVerts = verts.length / 3;
      const cara = [];
      for (let k = 1; k < p.length; k++) {
        let vi = parseInt(p[k].split('/')[0], 10);
        if (vi < 0) vi = nVerts + vi; else vi = vi - 1;
        cara.push(vi);
      }
      // Abanico: (0, k, k+1) para polígonos de 3+ lados.
      for (let k = 1; k < cara.length - 1; k++) {
        idx.push(cara[0], cara[k], cara[k + 1]);
      }
    }
  }
  return crearMalla(verts, idx, name);
}

/** OFF: cabecera "OFF", conteos "V F E", V vértices y F caras. */
function parseOFF(texto, name) {
  // Tokens ignorando comentarios y líneas vacías.
  const tokens = texto
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length && l[0] !== '#');

  let i = 0;
  if (tokens[i].toUpperCase().startsWith('OFF')) {
    // La cabecera puede ser "OFF" sola o "OFF" con los conteos en la misma línea.
    const resto = tokens[i].slice(3).trim();
    if (resto.length === 0) i++;
    else tokens[i] = resto;
  }

  const [nV, nF] = tokens[i++].split(/\s+/).map(Number);
  const verts = [];
  const idx = [];

  for (let v = 0; v < nV; v++) {
    const c = tokens[i++].split(/\s+/).map(Number);
    verts.push(c[0], c[1], c[2]);
  }
  for (let f = 0; f < nF; f++) {
    const c = tokens[i++].split(/\s+/).map(Number);
    const n = c[0];
    for (let k = 1; k < n - 1; k++) {
      idx.push(c[1], c[1 + k], c[2 + k]);
    }
  }
  return crearMalla(verts, idx, name);
}

/** PLY ASCII: lee la cabecera, ubica x/y/z y las caras. */
function parsePLY(texto, name) {
  const lineas = texto.split('\n');
  let i = 0;
  let nV = 0, nF = 0;
  let propsVertice = [];
  let elementoActual = null;

  // --- cabecera ---
  for (; i < lineas.length; i++) {
    const l = lineas[i].trim();
    if (l === 'end_header') { i++; break; }
    const p = l.split(/\s+/);
    if (p[0] === 'format' && p[1] !== 'ascii') {
      throw new Error('PLY binario no soportado (solo ascii).');
    }
    if (p[0] === 'element') {
      elementoActual = p[1];
      if (p[1] === 'vertex') nV = +p[2];
      else if (p[1] === 'face') nF = +p[2];
    } else if (p[0] === 'property' && elementoActual === 'vertex') {
      propsVertice.push(p[p.length - 1]); // nombre de la propiedad
    }
  }

  const ix = propsVertice.indexOf('x');
  const iy = propsVertice.indexOf('y');
  const iz = propsVertice.indexOf('z');

  const verts = [];
  const idx = [];

  for (let v = 0; v < nV; v++) {
    const c = lineas[i++].trim().split(/\s+/).map(Number);
    verts.push(c[ix], c[iy], c[iz]);
  }
  for (let f = 0; f < nF; f++) {
    const c = lineas[i++].trim().split(/\s+/).map(Number);
    const n = c[0];
    for (let k = 1; k < n - 1; k++) {
      idx.push(c[1], c[1 + k], c[2 + k]);
    }
  }
  return crearMalla(verts, idx, name);
}

/** STL de entrada: detecta binario vs ascii automáticamente. */
function parseSTL(buffer, name) {
  const bytes = new Uint8Array(buffer);
  // Heurística de binario: 84 + 50*T == longitud total.
  if (bytes.length >= 84) {
    const dv = new DataView(buffer);
    const nTri = dv.getUint32(80, true);
    if (84 + nTri * 50 === bytes.length) {
      return parseSTLbinario(dv, nTri, name);
    }
  }
  // Si no cuadró, tratar como ascii.
  const texto = new TextDecoder().decode(buffer);
  return parseSTLascii(texto, name);
}

function parseSTLbinario(dv, nTri, name) {
  const verts = [];
  const idx = [];
  let off = 84;
  for (let t = 0; t < nTri; t++) {
    off += 12; // saltar la normal (la recalculamos al exportar)
    const base = verts.length / 3;
    for (let v = 0; v < 3; v++) {
      verts.push(dv.getFloat32(off, true), dv.getFloat32(off + 4, true), dv.getFloat32(off + 8, true));
      off += 12;
    }
    off += 2; // attribute byte count
    idx.push(base, base + 1, base + 2);
  }
  return crearMalla(verts, idx, name);
}

function parseSTLascii(texto, name) {
  const verts = [];
  const idx = [];
  const re = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
  let m;
  while ((m = re.exec(texto)) !== null) {
    verts.push(+m[1], +m[2], +m[3]); // cada 3 vértices forman un triángulo
  }
  for (let v = 0; v < verts.length / 3; v += 3) {
    idx.push(v, v + 1, v + 2);
  }
  return crearMalla(verts, idx, name);
}

/** GLB (glTF binario): header + chunk JSON + chunk BIN. Lee la 1ª primitiva. */
function parseGLB(buffer, name) {
  const dv = new DataView(buffer);
  const magic = dv.getUint32(0, true);
  if (magic !== 0x46546c67) throw new Error('No es un archivo GLB válido.');

  // Recorrer chunks a partir del offset 12.
  let off = 12;
  let json = null;
  let bin = null;
  while (off < dv.byteLength) {
    const len = dv.getUint32(off, true);
    const tipo = dv.getUint32(off + 4, true);
    const inicio = off + 8;
    if (tipo === 0x4e4f534a) {           // "JSON"
      json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, inicio, len)));
    } else if (tipo === 0x004e4942) {    // "BIN\0"
      bin = buffer.slice(inicio, inicio + len);
    }
    off = inicio + len;
  }
  if (!json || !bin) throw new Error('GLB sin chunk JSON o BIN.');

  const prim = json.meshes[0].primitives[0];
  const posAcc = json.accessors[prim.attributes.POSITION];
  const positions = leerAccessor(json, bin, posAcc); // Float32Array (VEC3)

  let indices;
  if (prim.indices != null) {
    const idxAcc = json.accessors[prim.indices];
    const raw = leerAccessor(json, bin, idxAcc);
    indices = new Uint32Array(raw); // normalizar a Uint32
  } else {
    // Sin índices: triángulos secuenciales.
    indices = new Uint32Array(positions.length / 3);
    for (let k = 0; k < indices.length; k++) indices[k] = k;
  }

  return {
    positions: new Float32Array(positions),
    indices,
    name: name || (json.meshes[0].name ?? 'modelo'),
  };
}

/** Lee un accessor de glTF desde el buffer binario. */
function leerAccessor(json, bin, acc) {
  const bv = json.bufferViews[acc.bufferView];
  const offset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const numComp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type];
  const total = acc.count * numComp;

  switch (acc.componentType) {
    case 5126: return new Float32Array(bin, offset, total);       // FLOAT
    case 5125: return new Uint32Array(bin, offset, total);        // UNSIGNED_INT
    case 5123: return new Uint16Array(bin, offset, total);        // UNSIGNED_SHORT
    case 5121: return new Uint8Array(bin, offset, total);         // UNSIGNED_BYTE
    default: throw new Error('componentType no soportado: ' + acc.componentType);
  }
}

/** Ensambla la malla interna a partir de arreglos JS. */
function crearMalla(vertsArray, idxArray, name) {
  return {
    positions: new Float32Array(vertsArray),
    indices: new Uint32Array(idxArray),
    name: name || 'modelo',
  };
}

/* ---------------------------------------------------------------------------
 * EXPORTADOR STL
 * ------------------------------------------------------------------------- */

/** STL binario → ArrayBuffer. */
function exportSTLbinario(malla) {
  const { positions, indices } = malla;
  const nTri = indices.length / 3;
  const buffer = new ArrayBuffer(84 + nTri * 50);
  const dv = new DataView(buffer);

  dv.setUint32(80, nTri, true); // conteo de triángulos (header queda en ceros)
  let off = 84;

  for (let t = 0; t < nTri; t++) {
    const a = indices[t * 3] * 3;
    const b = indices[t * 3 + 1] * 3;
    const c = indices[t * 3 + 2] * 3;

    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];

    const [nx, ny, nz] = normalTriangulo(ax, ay, az, bx, by, bz, cx, cy, cz);
    dv.setFloat32(off, nx, true); dv.setFloat32(off + 4, ny, true); dv.setFloat32(off + 8, nz, true);
    dv.setFloat32(off + 12, ax, true); dv.setFloat32(off + 16, ay, true); dv.setFloat32(off + 20, az, true);
    dv.setFloat32(off + 24, bx, true); dv.setFloat32(off + 28, by, true); dv.setFloat32(off + 32, bz, true);
    dv.setFloat32(off + 36, cx, true); dv.setFloat32(off + 40, cy, true); dv.setFloat32(off + 44, cz, true);
    dv.setUint16(off + 48, 0, true); // attribute byte count
    off += 50;
  }
  return buffer;
}

/** STL ascii → string. */
function exportSTLascii(malla) {
  const { positions, indices, name } = malla;
  const nTri = indices.length / 3;
  const out = [`solid ${name}`];
  for (let t = 0; t < nTri; t++) {
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
    const [nx, ny, nz] = normalTriangulo(ax, ay, az, bx, by, bz, cx, cy, cz);
    out.push(`  facet normal ${nx} ${ny} ${nz}`);
    out.push('    outer loop');
    out.push(`      vertex ${ax} ${ay} ${az}`);
    out.push(`      vertex ${bx} ${by} ${bz}`);
    out.push(`      vertex ${cx} ${cy} ${cz}`);
    out.push('    endloop');
    out.push('  endfacet');
  }
  out.push(`endsolid ${name}`);
  return out.join('\n');
}

/* ---------------------------------------------------------------------------
 * DESPACHADOR
 * ------------------------------------------------------------------------- */

/**
 * Convierte un archivo a malla interna según su extensión.
 * @param {string} ext  extensión en minúsculas, sin punto (obj, ply, off, stl, glb)
 * @param {string|ArrayBuffer} data  texto (formatos ascii) o ArrayBuffer (binarios)
 * @param {string} name  nombre base del modelo
 */
function parsearModelo(ext, data, name) {
  switch (ext) {
    case 'obj': return parseOBJ(data, name);
    case 'off': return parseOFF(data, name);
    case 'ply': return parsePLY(data, name);
    case 'stl': return parseSTL(data, name);
    case 'glb': return parseGLB(data, name);
    case 'gltf':
      throw new Error('.gltf (JSON con .bin externo) no soportado; usa .glb.');
    case 'fbx':
      throw new Error('FBX no soportado: es un formato propietario que requeriría una librería externa (prohibida en esta tarea).');
    default:
      throw new Error('Formato no soportado: .' + ext);
  }
}

/** Indica si un formato debe leerse como binario (ArrayBuffer) o texto. */
function esFormatoBinario(ext) {
  return ext === 'glb' || ext === 'stl';
}

// Exponer para el Web Worker (importScripts) y para pruebas en Node/navegador.
if (typeof self !== 'undefined') {
  self.Geometria = {
    parsearModelo, esFormatoBinario,
    exportSTLbinario, exportSTLascii,
  };
}
