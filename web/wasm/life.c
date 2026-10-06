// Sequential kernel ported from easypap-se/kernel/c/life.c (2020).
// Only the easypap plumbing (DIM, monitoring, image refresh) is replaced;
// the update rule and the loop structure are the original ones.
#include <stdlib.h>
#include <emscripten/emscripten.h>

#include "life.h"

typedef uint8_t cell_t;

static int DIM = 0;
static cell_t *restrict _table = NULL, *restrict _alternate_table = NULL;

static inline cell_t *table_cell (cell_t *restrict i, int y, int x)
{
  return i + y * DIM + x;
}

#define cur_table(y, x) (*table_cell (_table, (y), (x)))
#define next_table(y, x) (*table_cell (_alternate_table, (y), (x)))

EMSCRIPTEN_KEEPALIVE void life_finalize (void)
{
  free (_table);
  free (_alternate_table);
  _table = _alternate_table = NULL;
  DIM = 0;
}

EMSCRIPTEN_KEEPALIVE int life_init (int dim)
{
  life_finalize ();
  const size_t size = (size_t)dim * dim * sizeof (cell_t);
  // calloc keeps the border ring dead in both tables forever: the kernel never writes it.
  _table = calloc (1, size);
  _alternate_table = calloc (1, size);
  if (_table == NULL || _alternate_table == NULL) {
    life_finalize ();
    return -1;
  }
  DIM = dim;
  return 0;
}

EMSCRIPTEN_KEEPALIVE cell_t *life_cells (void)
{
  return _table;
}

static inline void swap_tables (void)
{
  cell_t *tmp = _table;
  _table = _alternate_table;
  _alternate_table = tmp;
}

static void compute_new_state (int y, int x)
{
  unsigned n  = 0;
  unsigned me = cur_table (y, x) != 0;

  for (int i = y - 1; i <= y + 1; i++)
    for (int j = x - 1; j <= x + 1; j++)
      n += cur_table (i, j);

  n = (n == 3 + me) | (n == 3);
  next_table (y, x) = n;
}

// Unlike the 2020 version, no early exit on a stable grid: benchmarks need
// every requested generation to be computed.
EMSCRIPTEN_KEEPALIVE void life_compute_seq (unsigned nb_iter)
{
  for (unsigned it = 1; it <= nb_iter; it++) {
    for (int i = 1; i < DIM - 1; i++)
      for (int j = 1; j < DIM - 1; j++)
        compute_new_state (i, j);
    swap_tables ();
  }
}
