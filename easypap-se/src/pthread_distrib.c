
#include "pthread_distrib.h"

#include <errno.h>

int pthread_distrib_init (pthread_distrib_t *distrib, unsigned nb_threads,
                          unsigned nb_elements, void (*f) (void))
{
  if (nb_elements == 0 || nb_threads == 0) {
    errno = EINVAL;
    return -1;
  }

  if (pthread_mutex_init (&distrib->mutex, 0) < 0) {
    return -1;
  }

  if (pthread_cond_init (&distrib->cond, 0) < 0) {
    int errno_save = errno;
    pthread_mutex_destroy (&distrib->mutex);
    errno = errno_save;
    return -1;
  }

  distrib->limit = nb_threads;
  distrib->count = 0;
  distrib->phase = 0;

  distrib->total_elements = nb_elements;
  distrib->next_element   = 0;
  distrib->finalize_func  = f;

  return 0;
}

int pthread_distrib_get (pthread_distrib_t *distrib)
{
  pthread_mutex_lock (&distrib->mutex);

  if (distrib->next_element == distrib->total_elements) {
    // No more job to distribute. Join barrier and return -1

    distrib->count++;
    if (distrib->count >= distrib->limit) {
      distrib->phase++;
      distrib->count        = 0;
      distrib->next_element = 0;

      if (distrib->finalize_func != NULL)
        distrib->finalize_func ();

      pthread_cond_broadcast (&distrib->cond);
      pthread_mutex_unlock (&distrib->mutex);
    } else {
      unsigned phase = distrib->phase;
      do
        pthread_cond_wait (&distrib->cond, &distrib->mutex);
      while (phase == distrib->phase);

      pthread_mutex_unlock (&distrib->mutex);
    }
    return -1;
  } else {
    // Get one element
    int e = distrib->next_element++;

    pthread_mutex_unlock (&distrib->mutex);
    return e;
  }
}
