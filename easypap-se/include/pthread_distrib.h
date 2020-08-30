
#ifndef PTHREAD_DISTRIB
#define PTHREAD_DISTRIB

#include <pthread.h>

typedef struct
{
  pthread_mutex_t mutex;
  pthread_cond_t cond;
  unsigned int limit;
  unsigned int count;
  unsigned int phase;
  unsigned int total_elements;
  unsigned int next_element;
  void (*finalize_func) (void);
} pthread_distrib_t;

int pthread_distrib_init (pthread_distrib_t *distrib, unsigned nb_threads,
			  unsigned nb_elements, void (*f)(void));

int pthread_distrib_get (pthread_distrib_t *distrib);

#endif
