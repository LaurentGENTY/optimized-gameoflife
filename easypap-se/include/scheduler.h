#ifndef SCHEDULER_IS_DEF
#define SCHEDULER_IS_DEF


typedef void (*task_func_t)(void *, unsigned);

unsigned scheduler_init (unsigned default_P);
void scheduler_finalize (void);

void scheduler_task_wait (void);
void scheduler_create_task (task_func_t task, void *param, unsigned cpu);


#endif
