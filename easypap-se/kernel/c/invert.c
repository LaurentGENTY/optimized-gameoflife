
#include "easypap.h"

#include <omp.h>

static inline unsigned compute_color (int i, int j)
{
  return (unsigned)0xFFFFFF00 ^ cur_img (i, j);
}

///////////////////////////// Simple sequential version (seq)
// Suggested cmdline(s):
// ./run -l images/shibuya.png -k invert -v seq -i 100 -n
//
unsigned invert_compute_seq (unsigned nb_iter)
{
  for (unsigned it = 1; it <= nb_iter; it++) {

    for (int i = 0; i < DIM; i++)
      for (int j = 0; j < DIM; j++)
        cur_img (i, j) = compute_color (i, j);
  }

  return 0;
}

// Tile inner computation
static void do_tile_reg (int x, int y, int width, int height)
{
  for (int i = y; i < y + height; i++)
    for (int j = x; j < x + width; j++)
      cur_img (i, j) = compute_color (i, j);
}


static void do_tile (int x, int y, int width, int height, int who)
{
  monitoring_start_tile (who);

  do_tile_reg (x, y, width, height);

  monitoring_end_tile (x, y, width, height, who);
}


///////////////////////////// Tiled sequential version (tiled)
// Suggested cmdline(s):
// ./run -l images/shibuya.png -k invert -v tiled -g 32 -i 100 -n
//
unsigned invert_compute_tiled (unsigned nb_iter)
{
  for (unsigned it = 1; it <= nb_iter; it++) {

    for (int y = 0; y < DIM; y += TILE_SIZE)
      for (int x = 0; x < DIM; x += TILE_SIZE)
        do_tile (x, y, TILE_SIZE, TILE_SIZE, 0 /* CPU id */);

  }

  return 0;
}
