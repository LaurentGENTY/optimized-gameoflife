#include "kernel/ocl/common.cl"


__kernel void invert_ocl (__global unsigned *in, __global unsigned *out)
{
  int y = get_global_id (1);
  int x = get_global_id (0);
  unsigned couleur;

  couleur = in [y * DIM + x];

  couleur ^= 0xFFFFFFFF;

  out [y * DIM + x] = couleur;
}
