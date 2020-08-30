//
// !!! DO NOT MODIFY THIS FILE !!!
//
// Utility functions for OpenCL
//

static int4 color_to_int4 (unsigned c)
{
  uchar4 ci = *(uchar4 *) &c;
  return convert_int4 (ci);
}

static unsigned int4_to_color (int4 i)
{
  uchar4 v = convert_uchar4 (i);
  return *((unsigned *) &v);
}

static unsigned color_mean (unsigned c1, unsigned c2)
{
  return int4_to_color ((color_to_int4 (c1) + color_to_int4 (c2)) / (int4)2);
}

static float4 color_scatter (unsigned c)
{
  uchar4 ci;

  ci.s0123 = (*((uchar4 *) &c)).s3210;
  return convert_float4 (ci) / (float4) 255;
}

// This is a generic version of a kernel updating the OpenGL texture buffer.
// It should work with most of existing kernels.
// Can be refined as update_texture_<kernel>
__kernel void update_texture (__global unsigned *cur, __write_only image2d_t tex)
{
  int y = get_global_id (1);
  int x = get_global_id (0);

  write_imagef (tex, (int2)(x, y), color_scatter (cur [y * DIM + x]));
}

static inline int extract_red (unsigned c)
{
  return c >> 24;
}

static inline int extract_green (unsigned c)
{
  return (c >> 16) & 255;
}

static inline int extract_blue (unsigned c)
{
  return (c >> 8) & 255;
}

static inline int extract_alpha (unsigned c)
{
  return c & 255;
}

static inline unsigned rgba (int r, int g, int b, int a)
{
  return (r << 24) | (g << 16) | (b << 8) | a;
}
