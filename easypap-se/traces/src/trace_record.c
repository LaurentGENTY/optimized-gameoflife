#include <fcntl.h>
#include <getopt.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/types.h>
#include <unistd.h>

#ifdef ENABLE_FUT

#define CONFIG_FUT
#include <fut.h>
#define BUFFER_SIZE (1 << 20)

#endif

#include "error.h"
#include "trace_common.h"
#include "trace_data.h"
#include "trace_record.h"

unsigned do_trace = 0;

void trace_record_init (char *file, unsigned cpu, unsigned dim, char *label)
{
  fut_set_filename (file);
  enable_fut_flush ();

  if (fut_setup (BUFFER_SIZE, 0xffff, 0) < 0)
    exit_with_error ("fut_setup");

  FUT_PROBE1 (0x1, TRACE_NB_CORES, cpu);
  FUT_PROBE1 (0x1, TRACE_DIM, dim);
  if (label != NULL)
    FUT_PROBESTR (0x1, TRACE_LABEL, label);
}

void trace_record_finalize (void)
{
  if (fut_endup ("temp") < 0)
    exit_with_error ("fut_endup");

  if (fut_done () < 0)
    exit_with_error ("fut_done");
}

void __trace_record_start_iteration (long time)
{
  FUT_PROBE1 (0x1, TRACE_BEGIN_ITER, time);
}

void __trace_record_end_iteration (long time)
{
  FUT_PROBE1 (0x1, TRACE_END_ITER, time);
}

void __trace_record_start_tile (long time, unsigned cpu)
{
  FUT_PROBE2 (0x1, TRACE_BEGIN_TILE, time, cpu);
}

void __trace_record_end_tile (long time, unsigned cpu, unsigned x, unsigned y, unsigned w, unsigned h)
{
  FUT_PROBE6 (0x1, TRACE_END_TILE, time, cpu, x, y, w, h);
}