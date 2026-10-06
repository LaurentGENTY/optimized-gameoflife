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

#ifdef LIFE_TILED
static void tiles_reset (void);
#endif

EMSCRIPTEN_KEEPALIVE void life_finalize (void)
{
  free (_table);
  free (_alternate_table);
  _table = _alternate_table = NULL;
  DIM = 0;
#ifdef LIFE_TILED
  tiles_reset (); // DIM is 0 here, so this only frees the tile flags
#endif
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
#ifdef LIFE_TILED
  tiles_reset ();
#endif
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

static int compute_new_state (int y, int x)
{
  unsigned n  = 0;
  unsigned me = cur_table (y, x) != 0;

  for (int i = y - 1; i <= y + 1; i++)
    for (int j = x - 1; j <= x + 1; j++)
      n += cur_table (i, j);

  n = (n == 3 + me) | (n == 3);
  next_table (y, x) = n;
  return n != me;
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

#ifdef LIFE_TILED
// Tiled + lazy + SIMD kernel, after life_compute_omp_tiled (2020) without OpenMP.
#include <emmintrin.h>
#include <string.h>

#ifndef TILE_SIZE
#define TILE_SIZE 32
#endif

static int nb_tiles = 0; // tiles per side, covering the interior [1, DIM-2]
static int tiles_computed = 0;
// Like toSee/isUpdate in 2020: which tiles changed at the previous / current iteration.
static unsigned char *tile_changed = NULL, *tile_changed_next = NULL;

static void tiles_reset (void)
{
  free (tile_changed);
  free (tile_changed_next);
  tile_changed = tile_changed_next = NULL;
  nb_tiles = 0;
  if (DIM < 3)
    return;
  nb_tiles = (DIM - 2 + TILE_SIZE - 1) / TILE_SIZE;
  tile_changed = malloc ((size_t)nb_tiles * nb_tiles);
  tile_changed_next = calloc ((size_t)nb_tiles * nb_tiles, 1);
  // Everything counts as changed so the first iteration computes every tile.
  memset (tile_changed, 1, (size_t)nb_tiles * nb_tiles);
}

static int tile_active (int tx, int ty)
{
  for (int j = ty - 1; j <= ty + 1; j++)
    for (int i = tx - 1; i <= tx + 1; i++)
      if (i >= 0 && j >= 0 && i < nb_tiles && j < nb_tiles && tile_changed[j * nb_tiles + i])
        return 1;
  return 0;
}

// 16 cells per SSE2 vector; Emscripten maps these intrinsics 1:1 to WASM SIMD128.
static int do_tile (int x0, int y0, int x1, int y1)
{
  const __m128i one = _mm_set1_epi8 (1), three = _mm_set1_epi8 (3), four = _mm_set1_epi8 (4);
  __m128i diff  = _mm_setzero_si128 ();
  int changed   = 0;

  for (int y = y0; y < y1; y++) {
    int x = x0;
    for (; x + 16 <= x1; x += 16) {
      __m128i n = _mm_setzero_si128 ();
      for (int i = y - 1; i <= y + 1; i++) {
        n = _mm_add_epi8 (n, _mm_loadu_si128 ((const __m128i *)table_cell (_table, i, x - 1)));
        n = _mm_add_epi8 (n, _mm_loadu_si128 ((const __m128i *)table_cell (_table, i, x)));
        n = _mm_add_epi8 (n, _mm_loadu_si128 ((const __m128i *)table_cell (_table, i, x + 1)));
      }
      const __m128i me = _mm_loadu_si128 ((const __m128i *)table_cell (_table, y, x));
      // Same rule as compute_new_state on the 3x3 sum: 3 → alive, 4 → keep current state.
      const __m128i alive = _mm_or_si128 (
          _mm_cmpeq_epi8 (n, three),
          _mm_and_si128 (_mm_cmpeq_epi8 (n, four), _mm_cmpeq_epi8 (me, one)));
      const __m128i next = _mm_and_si128 (alive, one);
      _mm_storeu_si128 ((__m128i *)table_cell (_alternate_table, y, x), next);
      diff = _mm_or_si128 (diff, _mm_xor_si128 (next, me));
    }
    for (; x < x1; x++)
      changed |= compute_new_state (y, x);
  }
  return changed || _mm_movemask_epi8 (_mm_cmpeq_epi8 (diff, _mm_setzero_si128 ())) != 0xFFFF;
}

// A skipped tile is safe: none of its neighbours changed last iteration, so it did not
// change either and both tables already hold the same cells there.
EMSCRIPTEN_KEEPALIVE void life_compute_tiled (unsigned nb_iter)
{
  if (nb_tiles == 0 || tile_changed == NULL)
    tiles_reset ();

  for (unsigned it = 1; it <= nb_iter; it++) {
    tiles_computed = 0;
    for (int ty = 0; ty < nb_tiles; ty++)
      for (int tx = 0; tx < nb_tiles; tx++) {
        if (!tile_active (tx, ty))
          continue;
        const int x0 = 1 + tx * TILE_SIZE, y0 = 1 + ty * TILE_SIZE;
        const int x1 = x0 + TILE_SIZE < DIM - 1 ? x0 + TILE_SIZE : DIM - 1;
        const int y1 = y0 + TILE_SIZE < DIM - 1 ? y0 + TILE_SIZE : DIM - 1;
        tile_changed_next[ty * nb_tiles + tx] = do_tile (x0, y0, x1, y1);
        tiles_computed++;
      }
    swap_tables ();
    unsigned char *tmp = tile_changed;
    tile_changed       = tile_changed_next;
    tile_changed_next  = tmp;
    memset (tile_changed_next, 0, (size_t)nb_tiles * nb_tiles);
  }
}

EMSCRIPTEN_KEEPALIVE int life_tiles_computed (void)
{
  return tiles_computed;
}
#endif
