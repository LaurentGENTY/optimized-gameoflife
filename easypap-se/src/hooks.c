#include "hooks.h"
#include "debug.h"
#include "error.h"
#include "global.h"
#include "ocl.h"

#include <stdio.h>
#include <stdlib.h>
#include <dlfcn.h>

#ifdef __APPLE__
#define DLSYM_FLAG RTLD_SELF
#else
#define DLSYM_FLAG NULL
#endif


void_func_t the_first_touch = NULL;
void_func_t the_init        = NULL;
draw_func_t the_draw        = NULL;
void_func_t the_finalize    = NULL;
int_func_t the_compute      = NULL;
void_func_t the_refresh_img = NULL;

void *hooks_find_symbol (char *symbol)
{
  return dlsym (DLSYM_FLAG, symbol);
}

static void *bind_it (char *kernel, char *s, char *variant, int print_error)
{
  char buffer[1024];
  void *fun = NULL;
  sprintf (buffer, "%s_%s_%s", kernel, s, variant);
  fun = hooks_find_symbol (buffer);
  if (fun != NULL)
    PRINT_DEBUG ('c', "Found [%s]\n", buffer);
  else {
    if (print_error == 2)
      exit_with_error ("Cannot resolve function [%s]", buffer);

    sprintf (buffer, "%s_%s", kernel, s);
    fun = hooks_find_symbol (buffer);

    if (fun != NULL)
      PRINT_DEBUG ('c', "Found [%s]\n", buffer);
    else if (print_error)
      exit_with_error ("Cannot resolve function [%s]", buffer);
  }
  return fun;
}

void hooks_establish_bindings (void)
{
  PRINT_MASTER ("Using kernel [%s], variant [%s]\n", kernel_name, variant_name);

  if(opencl_used) {
    the_compute = bind_it (kernel_name, "invoke", variant_name, 0);
    if (the_compute == NULL) {
      the_compute = ocl_invoke_kernel_generic;
      PRINT_DEBUG ('c', "Using generic [%s] OpenCL kernel launcher\n",
                   "ocl_compute");
    }
  } else {
    the_compute = bind_it (kernel_name, "compute", variant_name, 2);
  }

  the_init        = bind_it (kernel_name, "init", variant_name, 0);
  the_draw        = bind_it (kernel_name, "draw", variant_name, 0);
  the_finalize    = bind_it (kernel_name, "finalize", variant_name, 0);
  the_refresh_img = bind_it (kernel_name, "refresh_img", variant_name, 0);

  if (!opencl_used) {
    the_first_touch = bind_it (kernel_name, "ft", variant_name, do_first_touch);
  }
}

void hooks_draw_helper (char *suffix, void_func_t default_func)
{
  char func_name[1024];
  void_func_t f = NULL;

  if (suffix == NULL)
    f = default_func;
  else {
    sprintf (func_name, "%s_draw_%s", kernel_name, suffix);
    f = hooks_find_symbol (func_name);

    if (f == NULL) {
      PRINT_DEBUG ('g', "Cannot resolve draw function: %s\n", func_name);
      f = default_func;
    }
  }

  f ();
}
