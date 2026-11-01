declare module '@diffusionstudio/piper-wasm/build/piper_phonemize.js' {
  const crear: (opciones: {
    print?: (linea: string) => void;
    printErr?: (linea: string) => void;
    locateFile?: (ruta: string) => string;
  }) => Promise<unknown>;
  export default crear;
}
