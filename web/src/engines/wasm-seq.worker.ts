import { serveSimInWorker } from './sim-handler';
import { WasmSeqSim } from './wasm-seq-sim';

serveSimInWorker((grid) => WasmSeqSim.create(grid));
