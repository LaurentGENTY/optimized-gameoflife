
#include "easypap.h"

#include <omp.h>
#include <stdbool.h>
#include <stdint.h>

// We propagate the max color down-right. This is the expensive implementation
// which constantly checks border conditions...
int tile_down_right (int x, int y, int w, int h, int cpu)
{
  int change = 0;

  monitoring_start_tile (cpu);

  for (int i = y; i < y + h; i++)
    for (int j = x; j < x + w; j++)
      if (cur_img (i, j)) {
        if (i > 0 && j > 0) {
          uint32_t m = max (cur_img (i - 1, j), cur_img (i, j - 1));
          if (m > cur_img (i, j)) {
            change     = 1;
            cur_img (i, j) = m;
          }
        } else if (j > 0) {
          uint32_t m = cur_img (i, j - 1);
          if (m > cur_img (i, j)) {
            change     = 1;
            cur_img (i, j) = m;
          }
        } else if (i > 0) {
          uint32_t m = cur_img (i - 1, j);
          if (m > cur_img (i, j)) {
            change     = 1;
            cur_img (i, j) = m;
          }
        }
      }

  monitoring_end_tile (x, y, w, h, cpu);

  return change;
}

// We propagate the max color up-left. This is the expensive implementation
// which constantly checks border conditions...
int tile_up_left (int x, int y, int w, int h, int cpu)
{
  int change = 0;

  monitoring_start_tile (cpu);

  for (int i = y + h - 1; i >= y; i--)
    for (int j = x + w - 1; j >= x; j--)
      if (cur_img (i, j)) {
        if (i < DIM - 1 && j < DIM - 1) {
          uint32_t m = max (cur_img (i + 1, j), cur_img (i, j + 1));
          if (m > cur_img (i, j)) {
            change     = 1;
            cur_img (i, j) = m;
          }
        } else if (j < DIM - 1) {
          uint32_t m = cur_img (i, j + 1);
          if (m > cur_img (i, j)) {
            change     = 1;
            cur_img (i, j) = m;
          }
        } else if (i < DIM - 1) {
          uint32_t m = cur_img (i + 1, j);
          if (m > cur_img (i, j)) {
            change     = 1;
            cur_img (i, j) = m;
          }
        }
      }

  monitoring_end_tile (x, y, w, h, cpu);

  return change;
}

///////////////////////////// Simple sequential version (seq)
// Suggested cmdline(s):
// ./run -l images/spirale.png -k max -v seq
//
unsigned max_compute_seq (unsigned nb_iter)
{
  for (unsigned it = 1; it <= nb_iter; it++) {

    if ((tile_down_right (0, 0, DIM, DIM, 0) |
         tile_up_left (0, 0, DIM, DIM, 0)) == 0)
      return it;
  }

  return 0;
}

///////////////////////////// Tiled sequential version (tiled)
// Suggested cmdline(s):
// ./run -l images/spirale.png -k max -v tiled -g 16 -m
//
unsigned max_compute_tiled (unsigned nb_iter)
{
  unsigned res = 0;

  for (unsigned it = 1; it <= nb_iter; it++) {
    int change = 0;

    // Bottom-right propagation
    for (int i = 0; i < GRAIN; i++)
      for (int j = 0; j < GRAIN; j++)
        change |= tile_down_right (j * TILE_SIZE, i * TILE_SIZE, TILE_SIZE,
                                       TILE_SIZE, 0);
    // Up-left propagation
    for (int i = GRAIN - 1; i >= 0; i--)
      for (int j = GRAIN - 1; j >= 0; j--)
        change |= tile_up_left (j * TILE_SIZE, i * TILE_SIZE, TILE_SIZE,
                                    TILE_SIZE, 0);

    if (!change) {
      res = it;
      break;
    }
  }

  return res;
}


///////////////////////////// Drawing functions

static void spiral (unsigned twists);
static void recolor (void);

void max_draw (char *param)
{
  unsigned n;

  if (param != NULL) {
    n = atoi (param);
    if (n > 0)
      spiral (n);
  }

  recolor ();
}

static void recolor (void)
{
  unsigned nbits = 0;
  unsigned rb, bb, gb;
  unsigned r_lsb, g_lsb, b_lsb;
  unsigned r_shift, g_shift, b_shift;
  uint8_t r_mask, g_mask, b_mask;
  uint8_t red = 0, blue = 0, green = 0;

  // Calcul du nombre de bits nécessaires pour mémoriser une valeur
  // différente pour chaque pixel de l'image
  for (int i = DIM - 1; i; i >>= 1)
    nbits++; // log2(DIM-1)
  nbits = nbits * 2;

  if (nbits > 24)
    exit_with_error ("DIM of %d is too large (suggested max: 4096)", DIM);

  gb = nbits / 3;
  bb = gb;
  rb = nbits - 2 * bb;

  r_shift = 8 - rb;
  r_lsb   = (1 << r_shift) - 1;
  g_shift = 8 - gb;
  g_lsb   = (1 << g_shift) - 1;
  b_shift = 8 - bb;
  b_lsb   = (1 << b_shift) - 1;

  r_mask = (1 << rb) - 1;
  g_mask = (1 << gb) - 1;
  b_mask = (1 << bb) - 1;

  PRINT_DEBUG ('g', "nbits : %d (r: %d, g: %d, b: %d)\n", nbits, rb, gb, bb);
  PRINT_DEBUG ('g', "r_shift: %d, r_lst: %d, r_mask: %d\n", r_shift, r_lsb,
               r_mask);
  PRINT_DEBUG ('g', "g_shift: %d, g_lst: %d, g_mask: %d\n", g_shift, g_lsb,
               g_mask);
  PRINT_DEBUG ('g', "b_shift: %d, b_lst: %d, b_mask: %d\n", b_shift, b_lsb,
               b_mask);

  for (unsigned y = 0; y < DIM; y++) {
    for (unsigned x = 0; x < DIM; x++) {
      uint32_t alpha = cur_img (y, x) & 255;

      if (alpha == 0 || x == 0 || x == DIM - 1 || y == 0 || y == DIM - 1)
        cur_img (y, x) = 0;
      else {
        uint32_t c = 255; // alpha
        c |= ((blue << b_shift) | b_lsb) << 8;
        c |= ((green << g_shift) | g_lsb) << 16;
        c |= ((red << r_shift) | r_lsb) << 24;
        cur_img (y, x) = c;
      }

      red = (red + 1) & r_mask;
      if (red == 0) {
        green = (green + 1) & g_mask;
        if (green == 0)
          blue = (blue + 1) & b_mask;
      }
    }
  }
}

static uint32_t color = 0xFFFF00FF; // Yellow

static void one_spiral (int x, int y, int step, int turns)
{
  int i = x, j = y, t;

  for (t = 1; t <= turns; t++) {
    for (; i < x + t * step; i++)
      cur_img (i, j) = color;
    for (; j < y + t * step + 1; j++)
      cur_img (i, j) = color;
    for (; i > x - t * step - 1; i--)
      cur_img (i, j) = color;
    for (; j > y - t * step - 1; j--)
      cur_img (i, j) = color;
  }
}

static void many_spirals (int xdebut, int xfin, int ydebut, int yfin, int step,
                          int turns)
{
  int i, j;
  int size = turns * step + 2;

  for (i = xdebut + size; i < xfin - size; i += 2 * size)
    for (j = ydebut + size; j < yfin - size; j += 2 * size)
      one_spiral (i, j, step, turns);
}

static void spiral (unsigned twists)
{
  many_spirals (1, DIM - 2, 1, DIM - 2, 2, twists);
}
