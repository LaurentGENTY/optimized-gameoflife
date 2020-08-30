
#include "easypap.h"

#include <omp.h>

///////////////////////////// Simple sequential version (seq)
// Suggested cmdline(s):
// ./run -l images/1024.png -k scrollup -v seq
//
unsigned scrollup_compute_seq (unsigned nb_iter)
{
  for (unsigned it = 1; it <= nb_iter; it++) {

    for (int i = 0; i < DIM; i++) {
      int src = (i < DIM - 1) ? i + 1 : 0;
      for (int j = 0; j < DIM; j++)
        next_img (i, j) = cur_img (src, j);
    }

    swap_images ();
  }

  return 0;
}

// Tile inner computation
static void do_tile_reg (int x, int y, int width, int height)
{
  for (int i = y; i < y + height; i++) {
    int src = (i < DIM - 1) ? i + 1 : 0;

    for (int j = x; j < x + width; j++)
      next_img (i, j) = cur_img (src, j);
  }
}

static void do_tile (int x, int y, int width, int height, int who)
{
  monitoring_start_tile (who);

  do_tile_reg (x, y, width, height);

  monitoring_end_tile (x, y, width, height, who);
}

///////////////////////////// Tiled sequential version (tiled)
// Suggested cmdline(s):
// ./run -l images/1024.png -k scrollup -v tiled
//
unsigned scrollup_compute_tiled (unsigned nb_iter)
{
  for (unsigned it = 1; it <= nb_iter; it++) {

    for (int y = 0; y < DIM; y += TILE_SIZE)
      for (int x = 0; x < DIM; x += TILE_SIZE)
        do_tile (x, y, TILE_SIZE, TILE_SIZE, 0 /* CPU id */);

    swap_images ();

  }

  return 0;
}


/////////////////////// OpenCL

static cl_mem twin_buffer = 0, mask_buffer = 0;

void scrollup_init_ocl_ouf (void)
{
  const int size = DIM * DIM * sizeof (unsigned);

  mask_buffer = clCreateBuffer (context, CL_MEM_READ_WRITE, size, NULL, NULL);
  if (!mask_buffer)
    exit_with_error ("Failed to allocate mask buffer");

  twin_buffer = clCreateBuffer (context, CL_MEM_READ_WRITE, size, NULL, NULL);
  if (!twin_buffer)
    exit_with_error ("Failed to allocate second input buffer");
}

void scrollup_draw_ocl_ouf (char *param)
{
  const int size       = DIM * DIM * sizeof (unsigned);
  cl_int err;

  unsigned *tmp = malloc (size);

  // Draw a quick-n-dirty circle
  for (int i = 0; i < DIM; i++)
    for (int j = 0; j < DIM; j++) {
      const int mid = DIM/2;
      int dist2 = (i - mid)*(i - mid) + (j - mid)*(j - mid);
      const int r1 = (DIM/4)*(DIM/4);
      const int r2 = (DIM/2)*(DIM/2);
      if (dist2 < r1)
        tmp[i * DIM + j] = 0xFF00FFFF;
      else if (dist2 < r2)
        tmp[i * DIM + j] = (((r2 - dist2)*255/(r2 - r1)) & 0xFF) | 0xFF00FF00;
      else
        tmp[i * DIM + j] = 0xFF00FF00;
    }

  // We send the mask buffer to GPU
  // (not need to send twin_buffer : its contents will be erased during 1st
  // iteration)
  err = clEnqueueWriteBuffer (queue, mask_buffer, CL_TRUE, 0, size, tmp, 0,
                              NULL, NULL);
  check (err, "Failed to write to extra buffer");

  free (tmp);

  img_data_replicate (); // Perform next_img = cur_img
}

// Suggested command line:
// ./run -l images/1024.png -o -k scrollup -v ocl_ouf
unsigned scrollup_invoke_ocl_ouf (unsigned nb_iter)
{
  size_t global[2] = {SIZE, SIZE}; // global domain size for our calculation
  size_t local[2]  = {TILEX, TILEY}; // local domain size for our calculation
  cl_int err;

  for (unsigned it = 1; it <= nb_iter; it++) {
    // Set kernel arguments
    //
    err = 0;
    err |= clSetKernelArg (compute_kernel, 0, sizeof (cl_mem), &next_buffer);
    err |= clSetKernelArg (compute_kernel, 1, sizeof (cl_mem), &twin_buffer);
    err |= clSetKernelArg (compute_kernel, 2, sizeof (cl_mem), &cur_buffer);
    err |= clSetKernelArg (compute_kernel, 3, sizeof (cl_mem), &mask_buffer);
    check (err, "Failed to set kernel arguments");

    err = clEnqueueNDRangeKernel (queue, compute_kernel, 2, NULL, global, local,
                                  0, NULL, NULL);
    check (err, "Failed to execute kernel");

    // Swap buffers
    {
      cl_mem tmp  = twin_buffer;
      twin_buffer = next_buffer;
      next_buffer = tmp;
    }
  }

  return 0;
}
