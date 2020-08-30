#include <fcntl.h>
#include <fut.h>
#include <fxt-tools.h>
#include <fxt.h>
#include <getopt.h>
#include <libgen.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/types.h>
#include <unistd.h>

#include "error.h"
#include "trace_common.h"
#include "trace_data.h"
#include "trace_file.h"

static long *last_start_times = NULL;
static unsigned current_iteration;

void trace_file_load (char *file)
{
  fxt_t fxt;
  fxt_blockev_t evs;
  struct fxt_ev_native ev;
  int ret;

  if (!(fxt = fxt_open (file)))
    exit_with_error ("Cannot open \"%s\" trace file (%s)", file,
                     strerror (errno));

  current_iteration = 0;

  trace_data_init (&trace[nb_traces], nb_traces);

  evs = fxt_blockev_enter (fxt);

  while (FXT_EV_OK ==
         (ret = fxt_next_ev (evs, FXT_EV_TYPE_NATIVE, (struct fxt_ev *)&ev))) {

    unsigned cpu = ev.param[1];

    switch (ev.code) {
    case TRACE_BEGIN_ITER:
      trace_data_start_iteration (&trace[nb_traces], ev.param[0]);
      break;

    case TRACE_END_ITER:
      trace_data_end_iteration (&trace[nb_traces], ev.param[0]);
      current_iteration++;
      break;

    case TRACE_NB_CORES: {
      unsigned nc      = ev.param[0];
      last_start_times = malloc (nc * sizeof (long));
      for (int c = 0; c < nc; c++)
        last_start_times[c] = 0;
      trace_data_set_nb_cores (&trace[nb_traces], nc);
      break;
    }

    case TRACE_BEGIN_TILE:
      last_start_times[cpu] = ev.param[0];
      break;

    case TRACE_END_TILE:
      trace_data_add_task (&trace[nb_traces], last_start_times[cpu],
                           ev.param[0], ev.param[2], ev.param[3], ev.param[4],
                           ev.param[5], current_iteration, cpu);
      break;

    case TRACE_DIM:
      trace_data_set_dim (&trace[nb_traces], ev.param[0]);
      break;

    case TRACE_LABEL:
      trace_data_set_label (&trace[nb_traces], (char *)ev.raw);
      break;

    default:
      break;
    }
  }

  if (ret != FXT_EV_EOT)
    fprintf (stderr, "Warning: FXT stopping on code %i\n", ret);

  // On some systems, fxt_close is not implemented... Curious.
  // fxt_close (fxt);

  free (last_start_times);
  last_start_times = NULL;

  // Set a default label
  if (trace[nb_traces].label == NULL) {
    char *name    = basename (file);
    char *lastdot = strrchr (name, '.');
    if (lastdot != NULL)
      *lastdot = '\0';

    trace_data_set_label (&trace[nb_traces], name);
  }

  trace_data_no_more_data (&trace[nb_traces]);

  printf (
      "Trace #%d \"%s\" successfully opened: %d iterations on %d CPUs (%s)\n",
      nb_traces, trace[nb_traces].label, trace[nb_traces].nb_iterations,
      trace[nb_traces].nb_cores, file);

  nb_traces++;
}
