import { serveSimInWorker } from './sim-handler';
import { WasmSim } from './wasm-sim';

serveSimInWorker((grid) => WasmSim.create('simd', grid));
