
#include "easypap.h"

#include <omp.h>
#include <stdbool.h>

#ifdef ENABLE_VECTO
#include <immintrin.h>
#endif

///////////////////////////// Simple sequential version (seq)
// Suggested cmdline:
// ./run --load-image images/shibuya.png --kernel rotation90 --pause
//
unsigned rotation90_compute_seq (unsigned nb_iter)
{
  for (unsigned it = 1; it <= nb_iter; it++) {

    for (int i = 0; i < DIM; i++)
      for (int j = 0; j < DIM; j++)
        next_img (DIM - i - 1, j) = cur_img (j, i);

    swap_images ();
  }

  return 0;
}
