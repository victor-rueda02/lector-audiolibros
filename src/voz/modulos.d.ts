declare module '@diffusionstudio/piper-wasm/build/piper_phonemize.js' {
  const crear: (opciones: {
    print?: (linea: string) => void;
    printErr?: (linea: string) => void;
    locateFile?: (ruta: string) => string;
    /** Devuelve el contenido del .data ya cargado (evita que emscripten lo descargue). */
    getPreloadedPackage?: (nombre: string, tamano: number) => ArrayBuffer;
    /** Instanciación propia del wasm (p. ej. a partir de un WebAssembly.Module ya compilado). */
    instantiateWasm?: (
      imports: WebAssembly.Imports,
      recibir: (instancia: WebAssembly.Instance, modulo: WebAssembly.Module) => void,
    ) => object;
  }) => Promise<unknown>;
  export default crear;
}
