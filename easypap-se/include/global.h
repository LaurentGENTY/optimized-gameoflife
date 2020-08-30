
#ifndef GLOBAL_IS_DEF
#define GLOBAL_IS_DEF

#include "hooks.h"
#include "img_data.h"

extern unsigned do_display;
extern unsigned vsync;
extern unsigned soft_rendering;
extern unsigned refresh_rate;
extern unsigned do_first_touch;
extern int max_iter;
extern char *easypap_image_file;
extern char *draw_param;

extern unsigned opencl_used;
extern unsigned easypap_mpirun;


extern char *kernel_name, *variant_name;

unsigned easypap_requested_number_of_threads (void);
unsigned easypap_number_of_cores (void);
int easypap_mpi_rank (void);
int easypap_mpi_size (void);
void easypap_check_mpi (void);
int easypap_proc_is_master (void);

#endif
