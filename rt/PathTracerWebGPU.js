// Minimalny stub — gotowy punkt podłączenia prawdziwego path tracera.
// UI/manifest/serwer będą widzieć ten moduł.
export class PathTracer {
  constructor(opts){ console.log("[RT] PathTracer init", opts); }
  render(){ /* noop */ }
  dispose(){ /* noop */ }
}
