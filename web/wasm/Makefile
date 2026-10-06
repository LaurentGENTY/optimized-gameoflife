EMCC   ?= emcc
OUT    := ../src/engines/wasm/generated
# SINGLE_FILE embeds the .wasm so the same module loads in Vite, workers and Node tests.
COMMON := -O3 -sMODULARIZE=1 -sEXPORT_ES6=1 -sSINGLE_FILE=1 \
          -sENVIRONMENT=web,worker,node \
          -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=2GB \
          -sEXPORTED_RUNTIME_METHODS=HEAPU8

SEQ_EXPORTS := _life_init,_life_cells,_life_compute_seq,_life_finalize

SIMD_EXPORTS := $(SEQ_EXPORTS),_life_compute_tiled,_life_tiles_computed

MT_EXPORTS := $(SIMD_EXPORTS),_life_threads_start,_life_compute_tiled_mt

all: $(OUT)/life-seq.mjs $(OUT)/life-simd.mjs $(OUT)/life-mt.mjs

# The pool is created up front: a worker blocked in pthread_barrier_wait cannot spawn threads lazily.
$(OUT)/life-mt.mjs: life.c life.h | $(OUT)
	$(EMCC) $(COMMON) -DLIFE_TILED -DLIFE_THREADS -DTILE_SIZE=32 -msimd128 -msse2 -pthread \
	  -sPTHREAD_POOL_SIZE=navigator.hardwareConcurrency \
	  -sEXPORTED_FUNCTIONS=$(MT_EXPORTS) life.c -o $@

$(OUT)/life-simd.mjs: life.c life.h | $(OUT)
	$(EMCC) $(COMMON) -DLIFE_TILED -DTILE_SIZE=32 -msimd128 -msse2 -sEXPORTED_FUNCTIONS=$(SIMD_EXPORTS) life.c -o $@

$(OUT)/life-seq.mjs: life.c life.h | $(OUT)
	$(EMCC) $(COMMON) -sEXPORTED_FUNCTIONS=$(SEQ_EXPORTS) life.c -o $@

$(OUT):
	mkdir -p $@

clean:
	rm -rf $(OUT)

.PHONY: all clean
