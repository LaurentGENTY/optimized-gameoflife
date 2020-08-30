#ifndef TIME_MACROS_IS_DEF
#define TIME_MACROS_IS_DEF

#include <sys/time.h>

#define TIME2USEC(t) ((long)(t).tv_sec * 1000000L + (t).tv_usec)

// Returns duration in µsecs
#define TIME_DIFF(t1, t2) (TIME2USEC (t2) - TIME2USEC (t1))

static inline long what_time_is_it (void)
{
  struct timeval tv_now;

  gettimeofday (&tv_now, NULL);

  return TIME2USEC (tv_now);
}

#endif
