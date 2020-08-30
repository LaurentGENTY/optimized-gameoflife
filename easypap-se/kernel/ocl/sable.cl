#include "kernel/ocl/common.cl"


__kernel void sable_ocl (__global unsigned *in, __global unsigned *out)
{
  // TODO
}

// DO NOT MODIFY: this kernel updates the OpenGL texture buffer
// This is a sable-specific version (generic version is defined in common.cl)
__kernel void sable_update_texture (__global unsigned *cur, __write_only image2d_t tex)
{
  int y = get_global_id (1);
  int x = get_global_id (0);
  int2 pos = (int2)(x, y);
  unsigned c = cur [y * DIM + x];
  unsigned r = 0, v = 0, b = 0;

  if (c == 1)
    v = 255;
  else if (c == 2)
    b = 255;
  else if (c == 3)
    r = 255;
  else if (c == 4)
    r = v = b = 255;
  else if (c > 4)
    r = v = b = (2 * c);

  c = rgba(r, v, b, 0xFF);

  write_imagef (tex, pos, color_scatter (c));
}
