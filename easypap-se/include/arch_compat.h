#ifndef ARCH_COMPAT_H
#define ARCH_COMPAT_H

// 2026 macOS build fix: the 2020 kernels use AVX intrinsics; on Apple Silicon,
// SIMDe maps them to NEON so the original code compiles unchanged.
#if defined(__x86_64__) || defined(__i386__)
#include <immintrin.h>
#else
#define SIMDE_ENABLE_NATIVE_ALIASES
#include <simde/x86/avx2.h>
#endif

#endif
