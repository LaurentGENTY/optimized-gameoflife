#ifndef TRACE_DATA_IS_DEF
#define TRACE_DATA_IS_DEF

#include "list.h"

typedef struct
{
  long start_time, end_time;
  unsigned x, y, w, h;
  unsigned iteration;
  struct list_head cpu_chain;
} trace_task_t;

typedef struct
{
  long start_time, end_time;
  long correction, gap;
  struct list_head chain;
  trace_task_t **first_cpu_task;
} trace_iteration_t;

typedef struct
{
  unsigned num;
  unsigned dimensions;
  unsigned nb_cores;
  unsigned nb_iterations;
  char *label;
  struct list_head *per_cpu;
  trace_iteration_t *iteration;
} trace_t;

#define MAX_TRACES 2

extern trace_t trace[MAX_TRACES];
extern unsigned nb_traces;
extern unsigned trace_data_align_mode;

void trace_data_init (trace_t *tr, unsigned num);
void trace_data_set_nb_cores (trace_t *tr, unsigned nb_cores);
void trace_data_set_dim (trace_t *tr, unsigned dim);
void trace_data_set_label (trace_t *tr, char *label);

void trace_data_add_task (trace_t *tr, long start_time, long end_time,
                          unsigned x, unsigned y, unsigned w, unsigned h,
                          unsigned iteration, unsigned cpu);

void trace_data_start_iteration (trace_t *tr, long start_time);
void trace_data_end_iteration (trace_t *tr, long end_time);

void trace_data_no_more_data (trace_t *tr);

void trace_data_sync_iterations (void);

void trace_data_finalize (void);

#define for_all_tasks(tr, cpu, var)                                            \
  list_for_each_entry (trace_task_t, var, (tr)->per_cpu + (cpu), cpu_chain)

int trace_data_search_iteration (trace_t *tr, long t);
int trace_data_search_next_iteration (trace_t *tr, long t);
int trace_data_search_prev_iteration (trace_t *tr, long t);

#define iteration_start_time(tr, it)                                           \
  (trace_data_align_mode                                                       \
       ? (tr)->iteration[it].start_time + (tr)->iteration[it].correction       \
       : (tr)->iteration[it].start_time)

#define iteration_end_time(tr, it)                                             \
  (trace_data_align_mode                                                       \
       ? (tr)->iteration[it].end_time + (tr)->iteration[it].correction +       \
             (tr)->iteration[it].gap                                           \
       : (tr)->iteration[it].end_time)

#define task_start_time(tr, t)                                                 \
  (trace_data_align_mode                                                       \
       ? (t)->start_time + (tr)->iteration[(t)->iteration].correction          \
       : (t)->start_time)

#define task_end_time(tr, t)                                                   \
  (trace_data_align_mode                                                       \
       ? (t)->end_time + (tr)->iteration[(t)->iteration].correction            \
       : (t)->end_time)

#endif
