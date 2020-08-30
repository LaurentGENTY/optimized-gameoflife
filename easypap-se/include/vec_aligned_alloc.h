#ifndef VEC_ALIGNED_ALLOC
#define VEC_ALIGNED_ALLOC

#include <stdlib.h>

void *vec_aligned_malloc (size_t size);

void vec_aligned_free (void *p);

#endif
