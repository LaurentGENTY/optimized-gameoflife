#ifndef OCL_IS_DEF
#define OCL_IS_DEF

#define CL_USE_DEPRECATED_OPENCL_1_2_APIS

#ifdef __APPLE__
#include <OpenCL/opencl.h>
#include <OpenGL/CGLContext.h>
#include <OpenGL/CGLCurrent.h>
#else
#include <CL/opencl.h>
#include <GL/glx.h>
#endif

#ifdef ENABLE_SDL
#include <SDL_opengl.h>
#endif

#include "error.h"

void ocl_init (int show_config_and_quit);
void ocl_alloc_buffers (void);
void ocl_map_textures (GLuint texid);
void ocl_send_image (unsigned *image);
void ocl_retrieve_image (unsigned *image);
unsigned ocl_invoke_kernel_generic (unsigned nb_iter);
void ocl_wait (void);
void ocl_update_texture (void);
size_t ocl_get_max_workgroup_size (void);

#define check(err, format, ...)                                                \
  do {                                                                         \
    if (err != CL_SUCCESS)                                                     \
      exit_with_error (format " [OCL err %d]", ##__VA_ARGS__, err);            \
  } while (0)

extern unsigned SIZE, TILE, TILEX, TILEY;
extern cl_context context;
extern cl_kernel compute_kernel;
extern cl_command_queue queue;
extern cl_mem cur_buffer, next_buffer;

#endif
