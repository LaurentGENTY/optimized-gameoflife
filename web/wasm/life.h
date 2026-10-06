#ifndef LIFE_H
#define LIFE_H

#include <stdint.h>

int life_init (int dim);
uint8_t *life_cells (void);
void life_compute_seq (unsigned nb_iter);
void life_finalize (void);
void life_compute_tiled (unsigned nb_iter);
int life_tiles_computed (void);

#endif
