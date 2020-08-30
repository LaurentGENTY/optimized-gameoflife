
#include "easypap.h"

#include <math.h>
#include <omp.h>

static void rotate (void);
static unsigned compute_color (int i, int j);

// If defined, the initialization hook function is called quite early in the
// initialization process, after the size (DIM variable) of images is known.
// This function can typically spawn a team of threads, or allocated additionnal
// OpenCL buffers.
// A function named <kernel>_init_<variant> is search first. If not found, a
// function <kernel>_init is searched in turn.
void spin_init (void)
{
  PRINT_DEBUG ('u', "Image size is %dx%d\n", DIM, DIM);
  PRINT_DEBUG ('u', "Block size is %dx%d\n", TILE_SIZE, TILE_SIZE);
  PRINT_DEBUG ('u', "Press <SPACE> to pause/unpause, <ESC> to quit.\n");
}

// The image is a two-dimension array of size of DIM x DIM. Each pixel is of
// type 'unsigned' and store the color information following a RGBA layout (4
// bytes). Pixel at line 'l' and column 'c' in the current image can be accessed
// using cur_img (l, c).

// The kernel returns 0, or the iteration step at which computation has
// completed (e.g. stabilized).

///////////////////////////// Simple sequential version (seq)
// Suggested cmdline(s):
// ./run --size 1024 --kernel spin --variant seq
// or
// ./run -s 1024 -k spin -v seq
//
unsigned spin_compute_seq (unsigned nb_iter)
{
  for (unsigned it = 1; it <= nb_iter; it++) {

    for (int i = 0; i < DIM; i++)
      for (int j = 0; j < DIM; j++)
        cur_img (i, j) = compute_color (i, j);

    rotate (); // Slightly increase the base angle
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
  // Calling monitoring_{start|end}_tile before/after actual computation allows
  // to monitor the execution in real time (--monitoring) and/or to generate an
  // execution trace (--trace).
  // monitoring_start_tile only needs the cpu number
  monitoring_start_tile (who);

  do_tile_reg (x, y, width, height);

  // In addition to the cpu number, monitoring_end_tile also needs the tile
  // coordinates
  monitoring_end_tile (x, y, width, height, who);
}


unsigned spin_compute_line (unsigned nb_iter)
{
  for (unsigned it = 1; it <= nb_iter; it++) {

    for (int i = 0; i < DIM; i++)
      do_tile (0, i, DIM, 1, omp_get_thread_num ());

    rotate (); // Slightly increase the base angle
  }

  return 0;
}

///////////////////////////// Tiled sequential version (tiled)
// Suggested cmdline(s):
// ./run -k spin -v tiled -g 16 -m
// or
// ./run -k spin -v tiled -ts 64 -m
//
unsigned spin_compute_tiled (unsigned nb_iter)
{
  for (unsigned it = 1; it <= nb_iter; it++) {

    for (int y = 0; y < DIM; y += TILE_SIZE)
      for (int x = 0; x < DIM; x += TILE_SIZE)
        do_tile (x, y, TILE_SIZE, TILE_SIZE, 0 /* CPU id */);

    rotate ();
  }

  return 0;
}

//////////////////////////////////////////////////////////////////////////

static float base_angle = 0.0;
static int color_a_r = 255, color_a_g = 255, color_a_b = 0, color_a_a = 255;
static int color_b_r = 0, color_b_g = 0, color_b_b = 255, color_b_a = 255;

static float atanf_approx (float x)
{
  float a = fabsf (x);

  return x * M_PI / 4 + 0.273 * x * (1 - a);
  // return  x * M_PI / 4 - x * (a - 1) * (0.2447 + 0.0663 * a);
}

static float atan2f_approx (float y, float x)
{
  float ay   = fabsf (y);
  float ax   = fabsf (x);
  int invert = ay > ax;
  float z    = invert ? ax / ay : ay / ax; // [0,1]
  float th   = atanf_approx (z);           // [0,π/4]
  if (invert)
    th = M_PI_2 - th; // [0,π/2]
  if (x < 0)
    th = M_PI - th; // [0,π]
  if (y < 0)
    th = -th;

  return th;
}

// Computation of one pixel
static unsigned compute_color (int i, int j)
{
  float angle =
      atan2f_approx ((int)DIM / 2 - i, j - (int)DIM / 2) + M_PI + base_angle;

  float ratio = fabsf ((fmodf (angle, M_PI / 4.0) - (float)(M_PI / 8.0)) /
                       (float)(M_PI / 8.0));

  int r = color_a_r * ratio + color_b_r * (1.0 - ratio);
  int g = color_a_g * ratio + color_b_g * (1.0 - ratio);
  int b = color_a_b * ratio + color_b_b * (1.0 - ratio);
  int a = color_a_a * ratio + color_b_a * (1.0 - ratio);

  return rgba (r, g, b, a);
}

static void rotate (void)
{
  base_angle = fmodf (base_angle + (1.0 / 180.0) * M_PI, M_PI);
}
