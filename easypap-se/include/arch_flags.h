#ifndef ARCH_FLAGS_IS_DEF
#define ARCH_FLAGS_IS_DEF

#ifdef ENABLE_VECTO

#if __AVX2__ == 1

#define VEC_SIZE 8
#define AVX2     1

#elif __SSE__ == 1

#define VEC_SIZE 4
#define SSE      1

#endif

#endif

void arch_flags_print (void);

#endif