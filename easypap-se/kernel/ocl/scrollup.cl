#include "kernel/ocl/common.cl"


__kernel void scrollup_ocl (__global unsigned *in, __global unsigned *out)
{
  unsigned y = get_global_id (1);
  unsigned x = get_global_id (0);
  unsigned ysource = (y == get_global_size (1) - 1 ? 0 : y + 1);
  unsigned couleur;

  couleur = in [ysource * DIM + x];

  out [y * DIM + x] = couleur;
}

__kernel void scrollup_ocl_ouf (__global unsigned *ina, __global unsigned *inb, __global unsigned *out, __global unsigned *mask)
{
  unsigned y = get_global_id (1);
  unsigned x = get_global_id (0);
  unsigned ysource = (y == get_global_size (1) - 1 ? 0 : y + 1);
  unsigned pixel_color;
  unsigned m = mask [y * DIM + x];
  float4 color_a, color_b;
  float ratio = extract_alpha (m) / 255.0;

  pixel_color = inb [y * DIM + x] = ina [ysource * DIM + x];

  color_b.x = 0xFF;
  color_b.y = extract_blue (m);
  color_b.z = extract_green (m);
  color_b.w = extract_red (m);

  color_a.x = extract_alpha (pixel_color);
  color_a.y = extract_blue (pixel_color);
  color_a.z = extract_green (pixel_color);
  color_a.w = extract_red (pixel_color);

  int4 color = convert_int4(color_a * ratio + color_b * (1.0f - ratio));

  out [y * DIM + x] = int4_to_color(color);
}
