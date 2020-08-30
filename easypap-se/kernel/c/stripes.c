
#include "easypap.h"

unsigned MASK = 1;

// The stripes kernel aims at highlighting the behavior of a GPU kernel in the
// presence of code divergence

void stripes_draw (char *param)
{
  if (param != NULL) {
    unsigned n = atoi (param);
    if (n >= 0 && n <= 12)
      MASK = 1 << n;
    else
      exit_with_error ("Shift value should be in range 0..12");
  }
}

static unsigned scale_component (unsigned c, unsigned percentage)
{
  unsigned coul;

  coul = c * percentage / 100;
  if (coul > 255)
    coul = 255;

  return coul;
}

static unsigned scale_color (unsigned c, unsigned percentage)
{
  unsigned r, g, b, a;

  r = extract_red (c);
  g = extract_green (c);
  b = extract_blue (c);
  a = extract_alpha (c);

  r = scale_component (r, percentage);
  g = scale_component (g, percentage);
  b = scale_component (b, percentage);

  return rgba (r, g, b, a);
}

static unsigned brighten (unsigned c)
{
  for (int i = 0; i < 15; i++)
    c = scale_color (c, 101);

  return c;
}

static unsigned darken (unsigned c)
{
  for (int i = 0; i < 15; i++)
    c = scale_color (c, 99);

  return c;
}

///////////////////////////// Simple sequential version (seq)
// Suggested cmdline(s):
// ./run -l images/1024.png -k stripes -v seq -a 4
//
unsigned stripes_compute_seq (unsigned nb_iter)
{
  for (unsigned it = 1; it <= nb_iter; it++) {

    for (int i = 0; i < DIM; i++)
      for (int j = 0; j < DIM; j++)
        if (j & MASK)
          cur_img (i, j) = brighten (cur_img (i, j));
        else
          cur_img (i, j) = darken (cur_img (i, j));
  }

  return 0;
}

///////////////////////////// OpenCL version (ocl)
// Suggested cmdline(s):
// TILEY=2 TILEX=128 ./run -l images/1024.png -k stripes -o -a 2
//
// See kernel/ocl/stripes.cl file.
