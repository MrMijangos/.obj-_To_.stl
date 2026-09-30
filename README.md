# Conversor 3D Concurrente (OBJ → STL)

Aplicación web **client-side** hecha con **Vanilla JavaScript** (sin librerías ni
frameworks) para la asignatura **Programación Concurrente** — UP Chiapas.

Convierte modelos 3D (`.obj`, `.ply`, `.off`, `.stl`, `.glb`) a formato **STL** ejecutando el
algoritmo pesado en **Dedicated Web Workers**, de modo que la interfaz nunca se
congela, y usa un **Service Worker** para funcionar sin conexión.

## Objetivo académico

Demostrar:

- **Dedicated Web Workers** → paralelismo, descarga del *main thread*.
- **Service Worker** → resiliencia (caché offline) y gestión de recursos.
- Comunicación por paso de mensajes (`postMessage` / `onmessage`) con estados:
  inicio, progreso %, cancelación y resultado.

## Arquitectura (objetivo)

```
Main Thread (UI)  <--postMessage-->  Dedicated Worker(s)  (conversión pesada)
       |
       +--fetch-->  Service Worker  <-->  Cache Storage / IndexedDB / Red
```

## Cómo ejecutar

Los Web Workers y Service Workers **no funcionan con `file://`**; hay que servir
la carpeta por HTTP. Con Python:

```bash
python -m http.server 8000
# abrir http://localhost:8000
```

## Eststructura

```
ConversorOBJ-STL/
├── index.html
├── css/styles.css
├── js/main.js        # hilo principal
└── README.md
```

## Estado / roadmap

- [x] 1. Estructura del proyecto
- [x] 2. Motor de conversión OBJ/PLY/OFF/STL/GLB → STL
- [x] 3. Web Worker de conversión + pool + progreso/cancelación
- [ ] 4. UI: progreso, cancelación, demo con/sin worker
- [ ] 5. Visualizador Canvas 2D
- [ ] 6. Service Worker: caché offline
- [ ] 7. Service Worker: IndexedDB
- [ ] 8. Reporte + perfilado de rendimiento

## Autor

Fernando Manuel · 233373 · Ing. en Tecnologías de la Información e Innovación Digital
