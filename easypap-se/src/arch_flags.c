#include "arch_flags.h"
#include "debug.h"

void arch_flags_print (void)
{
#ifdef ENABLE_VECTO

#if AVX2 == 1
  PRINT_DEBUG ('c', "AVX2 Vectorization enabled (VEC_SIZE: %d)\n", VEC_SIZE);
#elif SSE == 1
  PRINT_DEBUG ('c', "SSE Vectorization enabled (VEC_SIZE: %d)\n", VEC_SIZE);
#endif

#endif
}
