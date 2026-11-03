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
| 15 | Piper con código propio sobre `onnxruntime-web` + fonemizador wasm `@diffusionstudio/piper-wasm` (no vits-web ni piper-tts-web) | Esas librerías bajan wasm de CDNs de terceros y usan OPFS `createWritable`; así todo se sirve desde nuestro origen y los modelos se guardan en la Cache API. |
| 16 | Build *legacy* de pdf.js en navegador y Node | La build normal falla en Node 24 (tests) y la legacy trae polyfills útiles en Safari. |
| 17 | La UI recibe un objeto `Servicios`; con `?falsos` en la URL usa servicios simulados | Permite desarrollar y probar la interfaz sin PDF ni modelos; los e2e de UI lo usan. |
| 18 | Paso al capítulo siguiente: se precarga su audio y en `ended` se cambia `src` y se llama a `play()` sin awaits | Máxima probabilidad de que iOS lo permita con la pantalla bloqueada; si falla, el capítulo queda cargado y basta pulsar play en la pantalla de bloqueo. |
| 19 | Media Session sin `previoustrack`/`nexttrack` | Así iOS muestra los botones de ±30 s en la pantalla de bloqueo. |
| 20 | e2e: WebKit comprueba todo hasta tener un MP3 válido cargado en el `<audio>`; Chromium comprueba además reproducción, ±30 s, velocidad y reanudación | El WebKit de Playwright para Windows no decodifica audio (MediaError 4 incluso con MP3/WAV de terceros). |
| 21 | El fonemizador (espeak-ng wasm) se recrea cada 40 frases reutilizando el `.data` y el wasm ya compilado; si falla, se recrea y se reintenta una vez; se limpian los surrogates sueltos | Su memoria es fija (16 MB) y cada llamada pierde memoria: abortaba con "Aborted()" hacia la frase 87 (fallo visto en el iPhone con un libro real). Crear un módulo nuevo cuesta ~30 ms. Test de regresión: `src/voz/fonemizador.test.ts`. |

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
| onnxruntime-web | ejecutar el modelo Piper (WASM, 1 hilo) | MIT |
| @diffusionstudio/piper-wasm | fonemizador espeak-ng en WASM | MIT (incluye espeak-ng, GPL-3.0) |
| Modelos de voz Piper (descargados en tiempo de ejecución, no en el repo) | voces es_ES | ver cada MODEL_CARD en rhasspy/piper-voices |

## Estado de los requisitos del MVP

Leyenda: ✅ probado en escritorio (Chromium y WebKit de Playwright) · ⏳ pendiente de confirmar en iPhone.

| # | Requisito | Estado |
|---|-----------|--------|
| 1 | Cargar PDF desde Archivos | ✅ `<input type=file accept=pdf>` · ⏳ que abra Archivos en iPhone |
| 2 | Extracción y limpieza + vista previa + capítulo de inicio | ✅ 30 tests sobre 5 PDFs generados (cabeceras, pies, números, notas, guiones, 2 columnas, índice, escaneado) · ⏳ libro real |
| 3 | Elegir voz con muestra; recuerda la elección | ✅ 6 voces es_ES, muestras oficiales, elección en localStorage · ⏳ muestras en Safari iOS |
| 4 | Generar audio por capítulos con progreso y ETA | ✅ e2e en WebKit y Chromium; Wake Lock · ⏳ velocidad y memoria en iPhone |
| 5 | Reproductor: play/pausa, ±30 s, velocidad, Media Session, posición guardada | ✅ en Chromium (e2e) · ⏳ todo en Safari iOS, sobre todo con pantalla bloqueada |
| 6 | Diagnóstico | ✅ (e2e comprueba que se monta; probado a mano en WebKit) · ⏳ cifras del iPhone |
| 7 | Interfaz en español, móvil, botones grandes | ✅ · ⏳ revisión en pantalla real (las etiquetas de las 5 pestañas usan ~12,5 px para que quepan) |

Velocidad de generación medida en este PC (segundos de audio por segundo de cálculo): carlfm-x_low 7,9x (WebKit) / 7,7x (Chromium); davefx-medium 4,6x; sharvard-F 4,7x.

## Cómo retomar

- `npm install` · `npm run dev` (app real) o abrir `http://localhost:5173/lector-audiolibros/?falsos` (servicios simulados).
- Verificación completa: `npm run typecheck && npm test && npm run build && npm run e2e`.
- `npm run fixtures` regenera los PDFs de prueba de `tests/fixtures/` (texto inventado, sin copyright).
- Desplegar = push a `main` (GitHub Actions: tests + build + Pages).
- Los subagentes de `.claude/agents/` ya estarán disponibles por nombre en una sesión nueva.

## Hitos

- [x] 1. Entorno, esqueleto, interfaces y despliegue vacío (desplegado en Pages)
- [x] 2. Pipeline de limpieza + motor de voz con Diagnóstico
- [x] 3. Reproductor e integración
- [x] 4. E2E en WebKit (y Chromium) y despliegue final

## Pendiente de confirmar en iPhone

1. ¿Sigue sonando con la pantalla bloqueada en una pestaña de Safari?
2. ¿Y con la app añadida a la pantalla de inicio (standalone)? (se espera que pueda fallar; no es el modo recomendado)
3. ¿Funcionan play/pausa y ±30 s en la pantalla de bloqueo y en los auriculares?
4. ¿Reanuda tras 5 minutos en pausa?
5. ¿Pasa solo al siguiente capítulo con la pantalla bloqueada?
6. ¿Qué velocidad marca el Diagnóstico? (por debajo de 1x la generación es más lenta que el audio)
7. ¿Cargan las voces de 63–77 MB sin que Safari cierre la pestaña? (si no, usar carlfm-x_low o bajar la versión de onnxruntime-web)
8. ¿El texto de un libro real sale limpio?
9. ¿Es persistente el almacenamiento y cuánto espacio da Safari?

## Limitaciones conocidas

- Sin OCR: los PDFs escaneados solo muestran un aviso.
- Columnas: solo 2 columnas con un canal central claro; no se reordenan tablas, pies de foto ni recuadros.
- Notas al pie: se detectan si su letra es menor que el 88 % del cuerpo y están al final de la página.
- Palabras partidas: "teórico-" + "práctico" también se une ("teóricopráctico").
- Las cabeceras alternas necesitan repetirse en varias páginas para detectarse.
- Cancelar durante la descarga de una voz no corta la descarga; actúa al terminar.
- La primera generación descarga ~33 MB de motor (ONNX + espeak) más el modelo de voz (28–77 MB); quedan en caché del navegador.
