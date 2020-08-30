
#ifndef ERROR_IS_DEF
#define ERROR_IS_DEF

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/errno.h>

#ifdef THIS_FILE
#define __THIS_FILE__ THIS_FILE
#else
#define __THIS_FILE__ __FILE__
#endif

#define exit_with_error(format, ...)                                           \
  do {                                                                         \
    fprintf (stderr, "%s:%d: Error: " format "\n", __THIS_FILE__, __LINE__,    \
             ##__VA_ARGS__);                                                   \
    exit (EXIT_FAILURE);                                                       \
  } while (0)

#endif
