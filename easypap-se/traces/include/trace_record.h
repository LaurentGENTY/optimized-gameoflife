#ifndef TRACE_RECORD_IS_DEF
#define TRACE_RECORD_IS_DEF

#include "trace_common.h"

#ifdef ENABLE_TRACE

extern unsigned do_trace;

void trace_record_init (char *file, unsigned cpu, unsigned dim, char *label);
void __trace_record_start_iteration (long time);
void __trace_record_end_iteration (long time);
void __trace_record_start_tile (long time, unsigned cpu);
void __trace_record_end_tile (long time, unsigned cpu, unsigned x, unsigned y,
                              unsigned w, unsigned h);
void trace_record_finalize (void);

#define trace_record_start_iteration(t)                                        \
  do {                                                                         \
    if (do_trace)                                                              \
      __trace_record_start_iteration (t);                                      \
  } while (0)

#define trace_record_end_iteration(t)                                          \
  do {                                                                         \
    if (do_trace)                                                              \
      __trace_record_end_iteration (t);                                        \
  } while (0)

#define trace_record_start_tile(t, c)                                          \
  do {                                                                         \
    if (do_trace)                                                              \
      __trace_record_start_tile ((t), (c));                                    \
  } while (0)

#define trace_record_end_tile(t, c, x, y, w, h)                                \
  do {                                                                         \
    if (do_trace)                                                              \
      __trace_record_end_tile ((t), (c), (x), (y), (w), (h));                  \
  } while (0)

#else

#define do_trace (unsigned)0

#define trace_record_start_iteration(t) (void)0
#define trace_record_end_iteration(t) (void)0
#define trace_record_start_tile(t, c) (void)0
#define trace_record_end_tile(t, c, x, y, w, h) (void)0

#endif

#endif
