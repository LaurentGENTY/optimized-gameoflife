
#include <stdio.h>
#include <stdint.h>

#include "vec_aligned_alloc.h"

// VEC_ALIGNMENT (in bytes) must be a power of two
#define VEC_ALIGNMENT 64

#define __vec_aligned(ptr)                                                     \
  ((void *)(((intptr_t)(ptr) + VEC_ALIGNMENT) & ~(intptr_t) (VEC_ALIGNMENT - 1)))

#define __is_aligned_on(ptr,size) (((intptr_t)(ptr) & (intptr_t)(size - 1)) == 0)


void *vec_aligned_malloc (size_t size)
{
  void *orig = malloc (size + VEC_ALIGNMENT * 2);

  // malloc already returns an address aligned on 2 * VEC, so we don't change it
  if (__is_aligned_on (orig, VEC_ALIGNMENT * 2)) {
    // printf ("orig = %p\n", orig);
    return orig;
  }

  void *new  = __vec_aligned (orig);

  if (__is_aligned_on (new, VEC_ALIGNMENT * 2))
    new += VEC_ALIGNMENT;
  
  *((void **)new - 1) = orig;

  // printf ("orig = %p, new = %p\n", orig, new);

  return new;
}

void vec_aligned_free (void *p)
{
  if (__is_aligned_on (p, VEC_ALIGNMENT * 2))
    free (p);
  else {
    void *real = *((void **)p - 1);

    free (real);
  }
}
