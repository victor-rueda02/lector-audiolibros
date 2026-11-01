# Estado del proyecto · Lector de audiolibros

App web gratuita (GitHub Pages) para escuchar libros en PDF como audiolibros en Safari (iPhone), con la pantalla apagada.
URL: https://victor-rueda02.github.io/lector-audiolibros/

## Arquitectura

```
PDF ─▶ src/pdf (pdf.js + limpieza pura) ─▶ Libro{capítulos[párrafos]}
     ─▶ src/voz (Worker: Piper ONNX ─▶ PCM ─▶ MP3 lamejs) ─▶ 1 MP3 por capítulo
     ─▶ src/almacen (IndexedDB) ─▶ src/ui + src/reproductor (<audio> + Media Session)
```

- Contratos entre módulos: `src/tipos.ts` (solo lo cambia el coordinador).
- Cableado de implementaciones reales: `src/servicios.ts`.
- Carpetas por subagente: `src/pdf` (extractor-pdf), `src/voz` + `src/almacen` + `src/diagnostico` (motor-voz),
  `src/ui` + `src/reproductor` (reproductor-ui), configuración/CI/e2e (despliegue-qa).

## Decisiones (con motivo)

| # | Decisión | Motivo |
|---|----------|--------|
| 1 | Vite + TypeScript sin framework | Lo más sencillo; la UI tiene pocas pantallas. |
| 2 | Uso en pestaña de Safari, sin manifest/`display: standalone` | Standalone tiene bugs de audio en segundo plano (peores en iOS 26). |
| 3 | Un archivo de audio por capítulo, reproducido en un único `<audio>` | Con pantalla bloqueada iOS puede impedir empezar otra pista desde JS; un archivo largo evita depender de ello. |
| 4 | Audio generado con la app en primer plano + Screen Wake Lock durante la generación | Con pantalla bloqueada el JS pesado se frena; Wake Lock evita que la pantalla se apague mientras genera. |
| 5 | Nada de speechSynthesis | Se para con la pantalla bloqueada. |
| 6 | Licencia del repo GPL-3.0-or-later | El fonemizador de Piper (espeak-ng) es GPL-3.0; así todo es compatible. |
| 7 | Voces: modelos Piper es_ES descargados de HuggingFace (rhasspy/piper-voices) y guardados en la caché del navegador | Gratis, CORS abierto, solo descarga (nunca se sube nada). |
| 8 | Muestras de voz: MP3 oficiales de rhasspy.github.io/piper-samples | Escuchar ~10 s sin descargar un modelo de 28–77 MB por voz. |
| 9 | Audio comprimido a MP3 CBR mono (lamejs) en el Worker | WAV a 22 kHz son ~160 MB/hora; MP3 a 48 kbps son ~22 MB/hora. Evita agotar la cuota y la memoria; lamejs es JS puro y funciona en Safari. |
| 10 | Almacenamiento en IndexedDB guardando ArrayBuffer (no Blob) + `navigator.storage.persist()` | Más sencillo que OPFS (createWritable no es fiable en Safari); evita bugs de WebKit con Blobs guardados en IDB. |
| 11 | Ventana de capítulos: el actual y los siguientes; se borran los ya escuchados | Ahorra cuota. |
| 12 | ONNX Runtime en un solo hilo (sin SharedArrayBuffer) | GitHub Pages no permite las cabeceras COOP/COEP. |
| 13 | CI (GitHub Actions): tests unitarios + build + despliegue; e2e con Playwright WebKit en local | Mantiene el despliegue rápido y sin depender de descargar modelos en CI. |
| 14 | Subagentes definidos en `.claude/agents/` (model: sonnet, effort: medium) | Claude Code solo los carga al iniciar sesión; en la sesión en que se crearon se lanzaron como agente genérico Sonnet/medio siguiendo ese mismo archivo de rol. |

## Dependencias y licencias

| Paquete | Uso | Licencia |
|---------|-----|----------|
| vite | build/dev server | MIT |
| typescript | tipos | Apache-2.0 |
| vitest | tests unitarios | MIT |
| @playwright/test | tests e2e (WebKit) | Apache-2.0 |
| pdfkit (+ @types/pdfkit) | generar PDFs de prueba (solo desarrollo) | MIT |
| @types/node | tipos (desarrollo) | MIT |
| pdfjs-dist | leer PDFs | Apache-2.0 |
| @breezystack/lamejs | codificar MP3 | LGPL-3.0 |

## Estado de los requisitos del MVP

| # | Requisito | Estado |
|---|-----------|--------|
| 1 | Cargar PDF desde Archivos | pendiente |
| 2 | Extracción y limpieza + vista previa + capítulo de inicio | pendiente |
| 3 | Elegir voz con muestra; recuerda la elección | pendiente |
| 4 | Generar audio por capítulos con progreso y ETA | pendiente |
| 5 | Reproductor: play/pausa, ±30 s, velocidad, Media Session, posición guardada | pendiente |
| 6 | Diagnóstico | pendiente |
| 7 | Interfaz en español, móvil, botones grandes | pendiente |

## Hitos

- [x] 1. Entorno, esqueleto, interfaces y despliegue vacío (desplegado en Pages)
- [ ] 2. Pipeline de limpieza + motor de voz con Diagnóstico
- [ ] 3. Reproductor e integración
- [ ] 4. E2E en WebKit y despliegue final

## Pendiente de confirmar en iPhone

(se completa al entregar el MVP)
