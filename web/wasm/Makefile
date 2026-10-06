EMCC   ?= emcc
OUT    := ../src/engines/wasm/generated
# SINGLE_FILE embeds the .wasm so the same module loads in Vite, workers and Node tests.
COMMON := -O3 -sMODULARIZE=1 -sEXPORT_ES6=1 -sSINGLE_FILE=1 \
          -sENVIRONMENT=web,worker,node \
          -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=2GB \
          -sEXPORTED_RUNTIME_METHODS=HEAPU8

SEQ_EXPORTS := _life_init,_life_cells,_life_compute_seq,_life_finalize

all: $(OUT)/life-seq.mjs

$(OUT)/life-seq.mjs: life.c life.h | $(OUT)
	$(EMCC) $(COMMON) -sEXPORTED_FUNCTIONS=$(SEQ_EXPORTS) life.c -o $@

$(OUT):
	mkdir -p $@

clean:
	rm -rf $(OUT)

.PHONY: all clean
