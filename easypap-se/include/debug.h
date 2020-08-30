
#ifndef DEBUG_IS_DEF
#define DEBUG_IS_DEF

// La fonction PRINT_DEBUG permet d'afficher selectivement certains messages
// de debug. Le choix du type des messages s'effectue au moyen d'une
// chaine contenant des filtres. Ces filtres sont :
//
//      '+' -- active tous les messages de debug
//      'g' -- graphics
//      'c' -- computations
//      's' -- scheduler
//      't' -- threads
//      'o' -- OpenCL
//      'm' -- monitoring
//      'i' -- initialization sequence
//      'u' -- user
//      'M' -- MPI

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>

#include "global.h"

void debug_init (char *flags);
int debug_enabled (char flag);

extern char *debug_flags;

#define PRINT_DEBUG(flag, format, ...)                                         \
  do {                                                                         \
    if (debug_flags != NULL && debug_enabled (flag)) {                         \
      if (easypap_mpirun)                                                      \
        fprintf (stderr, "Proc %d: " format, easypap_mpi_rank (),              \
                 ##__VA_ARGS__);                                               \
      else                                                                     \
        fprintf (stderr, format, ##__VA_ARGS__);                               \
    }                                                                          \
  } while (0)

#define PRINT_MASTER(format, ...)                                              \
  do {                                                                         \
    if (!easypap_mpirun || easypap_mpi_rank () == 0)                           \
      fprintf (stderr, format, ##__VA_ARGS__);                                 \
  } while (0)

#endif
