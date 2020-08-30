
#define _GNU_SOURCE
#include <hwloc.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "debug.h"
#include "global.h"
#include "scheduler.h"

static int nbWorkers = -1;

volatile static int nbTask = 0;
pthread_mutex_t mutex      = PTHREAD_MUTEX_INITIALIZER;
pthread_cond_t cond        = PTHREAD_COND_INITIALIZER;

static hwloc_topology_t topology;
static unsigned nb_cores;

#define WORK_QUEUE 1024

struct task
{
  task_func_t fun;
  void *p;
};

struct worker
{
  int id;
  pthread_t tid;
  pthread_attr_t attr;
  pthread_cond_t cond;
  pthread_mutex_t mutex;
  int fin, todo;
  struct task tasks[WORK_QUEUE];
  unsigned d, f;
} * workers;

void scheduler_task_wait ()
{
  pthread_mutex_lock (&mutex);
  while (nbTask > 0)
    pthread_cond_wait (&cond, &mutex);
  pthread_mutex_unlock (&mutex);
}

static void one_more_task ()
{
  pthread_mutex_lock (&mutex);
  nbTask++;
  pthread_mutex_unlock (&mutex);
}

static void one_less_task ()
{
  pthread_mutex_lock (&mutex);
  nbTask--;
  if (nbTask == 0)
    pthread_cond_signal (&cond);
  pthread_mutex_unlock (&mutex);
}

static void add_task (struct task todo, int w)
{
  one_more_task ();
  pthread_mutex_lock (&workers[w].mutex);
  workers[w].tasks[workers[w].f] = todo;
  workers[w].f                   = (workers[w].f + 1) % WORK_QUEUE;
  workers[w].todo++;
  assert (workers[w].todo < WORK_QUEUE);
  pthread_cond_signal (&workers[w].cond);
  pthread_mutex_unlock (&workers[w].mutex);
}

static void no_more_task (int w)
{
  pthread_mutex_lock (&workers[w].mutex);
  workers[w].fin = 1;
  pthread_cond_signal (&workers[w].cond);
  pthread_mutex_unlock (&workers[w].mutex);
}

void scheduler_create_task (task_func_t task, void *param, unsigned cpu)
{
  struct task todo;

  todo.p   = param;
  todo.fun = task;

  if (cpu == -1) {
    static int cyclic = 0;
    // We quickly go through the list of workers to find an idle one, or the
    // least busy one
    PRINT_DEBUG ('s', "Dynamic task scheduling is not yet implemented\n");
    cpu    = cyclic;
    cyclic = (cyclic + 1) % nbWorkers;
  }
  add_task (todo, cpu);
}

static void *worker_main (void *p)
{
  struct worker *me = (struct worker *)p;
  struct task todo  = {NULL, NULL};
  unsigned tasks    = 0;
  hwloc_obj_t obj;
  hwloc_bitmap_t set;

  obj = hwloc_get_obj_by_type (topology, HWLOC_OBJ_PU, me->id % nb_cores);
  set = obj->cpuset;
  // hwloc_bitmap_singlify (set);
  hwloc_set_cpubind (topology, set, HWLOC_CPUBIND_THREAD);

  PRINT_DEBUG ('s', "Hey, I'm worker %d\n", me->id);

  while (1) {

    pthread_mutex_lock (&me->mutex);

    if (me->d == me->f && me->fin == 0)
      pthread_cond_wait (&me->cond, &me->mutex);

    if (me->d != me->f) {
      todo  = me->tasks[me->d];
      me->d = (me->d + 1) % WORK_QUEUE;
      me->todo--;
    } else if (me->fin == 1) {
      me->fin = -1;
    }

    pthread_mutex_unlock (&me->mutex);

    if (me->fin == -1) {
      PRINT_DEBUG ('s', "Worker %d has computed %d tasks\n", me->id, tasks);
      return NULL;
    }

    tasks++;
    todo.fun (todo.p, me->id);
    one_less_task ();
  }
}

unsigned scheduler_init (unsigned default_P)
{
  int i;

  /* Allocate and initialize topology object. */
  hwloc_topology_init (&topology);

  /* Perform the topology detection. */
  hwloc_topology_load (topology);

  nb_cores = hwloc_get_nbobjs_by_type (topology, HWLOC_OBJ_PU);

  if (default_P != -1)
    nbWorkers = default_P;
  else
    nbWorkers =  easypap_requested_number_of_threads ();
  
  PRINT_DEBUG ('s', "[Starting %d workers]\n", nbWorkers);

  workers = malloc (nbWorkers * sizeof (struct worker));

  for (i = 0; i < nbWorkers; i++) {
    workers[i].id   = i;
    workers[i].fin  = 0;
    workers[i].todo = 0;
    workers[i].d    = 0;
    workers[i].f    = 0;
    pthread_cond_init (&workers[i].cond, NULL);
    pthread_mutex_init (&workers[i].mutex, NULL);
    pthread_attr_init (&workers[i].attr);

    pthread_create (&workers[i].tid, &workers[i].attr, worker_main,
                    &workers[i]);
  }

  return nbWorkers;
}

void scheduler_finalize (void)
{
  int i;

  for (i = 0; i < nbWorkers; i++)
    no_more_task (i);

  for (i = 0; i < nbWorkers; i++)
    pthread_join (workers[i].tid, NULL);

  free (workers);

  /* Destroy topology object. */
  hwloc_topology_destroy (topology);

  PRINT_DEBUG ('s', "[Workers stopped]\n");
}
