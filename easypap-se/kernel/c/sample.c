
#include "easypap.h"

///////////////////////////// Simple sequential version (seq)
unsigned sample_compute_seq (unsigned nb_iter)
{
  for (unsigned it = 1; it <= nb_iter; it++) {

    for (int i = 0; i < DIM; i++)
      for (int j = 0; j < DIM; j++)
        cur_img (i, j) = 0xFFFF00FF;

  }

  return 0;
}

//////////////////////////////////////////////////////////////////////////
///////////////////////////// OpenCL version
// Suggested cmdlines:
// ./run -k sample -o
//
unsigned sample_invoke_ocl (unsigned nb_iter)
{
  size_t global[2] = {SIZE, SIZE};   // global domain size for our calculation
  size_t local[2]  = {TILEX, TILEY}; // local domain size for our calculation
  cl_int err;

  for (unsigned it = 1; it <= nb_iter; it++) {

    // Set kernel arguments
    //
    err = 0;
    err |= clSetKernelArg (compute_kernel, 0, sizeof (cl_mem), &cur_buffer);

    check (err, "Failed to set kernel arguments");

    err = clEnqueueNDRangeKernel (queue, compute_kernel, 2, NULL, global, local,
                                  0, NULL, NULL);
    check (err, "Failed to execute kernel");

  }

  return 0;
}
