#ifndef LIFE_H
#define LIFE_H

#include <stdint.h>

int life_init (int dim);
uint8_t *life_cells (void);
void life_compute_seq (unsigned nb_iter);
void life_finalize (void);
void life_compute_tiled (unsigned nb_iter);
int life_tiles_computed (void);
int life_threads_start (int n);
void life_compute_tiled_mt (unsigned nb_iter);
int life_nb_tiles (void);
void *life_trace_buffer (void);
unsigned life_trace_capacity (void);
unsigned life_trace_count (void);
double life_now (void);

#endif
