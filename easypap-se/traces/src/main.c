

#include <SDL.h>

#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/types.h>
#include <unistd.h>

#include "error.h"
#include "trace_data.h"
#include "trace_file.h"
#include "trace_graphics.h"
#include "trace_common.h"

static int WINDOW_PREFERRED_WIDTH  = 1920;
static int WINDOW_PREFERRED_HEIGHT = 1024;

static int first_iteration = -1;
static int last_iteration  = -1;
static int whole_trace     = 0;

char *trace_dir = DEFAULT_EZV_TRACE_DIR;

static void usage (char *progname, int val)
{
  fprintf (stderr, "Usage: %s [options] {file ...}\n", progname);
  fprintf (stderr, "options can be:\n");

  fprintf (stderr, "\t-d\t| --dir <dir>\t\t: specify trace directory\n");
  fprintf (stderr, "\t-h\t| --help\t\t: display help\n");
  fprintf (stderr, "\t-nt\t| --no-thumb\t\t: ignore thumbnails\n");
  fprintf (stderr, "\t-i\t| --iteration <i>\t: display iteration i\n");
  fprintf (stderr,
           "\t-r\t| --range <i> <j>\t: display iteration range [i-j]\n");
  fprintf (stderr, "\t-w\t| --whole-trace\t\t: display all iterations\n");
  fprintf (stderr, "\t-c\t| --compare\t\t: compare last two traces\n");
  fprintf (stderr, "\t-a\t| --align\t\t: align iterations\n");

  exit (val);
}

static char **filter_args (int *argc, char *argv[])
{
  char *progname = "./view"; // argv [0];

  (*argc)--;
  argv++;

  while (*argc > 0) {
    if (!strcmp (*argv, "--no-thumbs") || !strcmp (*argv, "-nt")) {
      use_thumbnails = 0;
    } else if (!strcmp (*argv, "--align") || !strcmp (*argv, "-a")) {
      trace_data_align_mode = 1;
    } else if (!strcmp (*argv, "--whole-trace") || !strcmp (*argv, "-w")) {
      whole_trace = 1;
    } else if (!strcmp (*argv, "--help") || !strcmp (*argv, "-h")) {
      usage (progname, 0);
    } else if (!strcmp (*argv, "--range") || !strcmp (*argv, "-r")) {
      if (*argc <= 2) {
        fprintf (stderr, "Error: parameter (number) missing\n");
        usage (progname, 1);
      }
      (*argc)--;
      argv++;
      first_iteration = atoi (*argv);
      (*argc)--;
      argv++;
      last_iteration = atoi (*argv);
    } else if (!strcmp (*argv, "--iteration") || !strcmp (*argv, "-i")) {
      if (*argc <= 1) {
        fprintf (stderr, "Error: parameter (number) missing\n");
        usage (progname, 1);
      }
      (*argc)--;
      argv++;
      first_iteration = last_iteration = atoi (*argv);
    } else if (!strcmp (*argv, "--dir") || !strcmp (*argv, "-d")) {
      if (*argc <= 1) {
        fprintf (stderr, "Error: parameter (dirname) missing\n");
        usage (progname, 1);
      }
      (*argc)--;
      argv++;
      trace_dir = *argv;
    } else {
      break;
    }

    (*argc)--;
    argv++;
  }

  return argv;
}

int main (int argc, char **argv)
{
  argv = filter_args (&argc, argv);

  switch (argc) {
  case 0: {
    char file[1024];

    sprintf (file, "%s/%s", trace_dir, DEFAULT_EZV_TRACE_FILE);
    trace_file_load (file);
    break;
  }
  case 1: {
    trace_file_load (argv[0]);
    break;
  }
  case 2: {
    trace_file_load (argv[0]);
    trace_file_load (argv[1]);
    break;
  }
  default:
    exit_with_error ("Too many trace files specified (max %d)", MAX_TRACES);
  }

  trace_data_sync_iterations ();

  trace_graphics_init (WINDOW_PREFERRED_WIDTH, WINDOW_PREFERRED_HEIGHT);

  if (whole_trace)
    trace_graphics_display_all ();
  else
    trace_graphics_setview (first_iteration, last_iteration);

  SDL_Event event;
  SDL_bool quit = SDL_FALSE;

  do {
    int r = SDL_WaitEvent (&event);

    if (r > 0) {
      if (event.type == SDL_KEYDOWN) {
        switch (event.key.keysym.sym) {
        case SDLK_RIGHT:
          trace_graphics_shift_left ();
          break;
        case SDLK_LEFT:
          trace_graphics_shift_right ();
          break;
        case SDLK_MINUS:
        case SDLK_KP_MINUS:
        case SDLK_m:
          trace_graphics_zoom_out ();
          break;
        case SDLK_PLUS:
        case SDLK_KP_PLUS:
        case SDLK_p:
          trace_graphics_zoom_in ();
          break;
        case SDLK_SPACE:
          trace_graphics_reset_zoom ();
          break;
        case SDLK_w:
          trace_graphics_display_all ();
          break;
        case SDLK_a:
          trace_graphics_toggle_align_mode ();
          break;
        case SDLK_x:
          trace_graphics_toggle_vh_mode ();
          break;
        case SDLK_ESCAPE:
        case SDLK_q:
          quit = SDL_TRUE;
          break;
        }
      } else if (event.type == SDL_QUIT) {
        quit = SDL_TRUE;
      } else if (event.type == SDL_MOUSEMOTION) {
        trace_graphics_mouse_moved (event.motion.x, event.motion.y);
      } else if (event.type == SDL_MOUSEBUTTONDOWN) {
        trace_graphics_mouse_down (event.button.x, event.button.y);
      } else if (event.type == SDL_MOUSEBUTTONUP) {
        trace_graphics_mouse_up (event.button.x, event.button.y);
      } else if (event.type == SDL_MOUSEWHEEL) {
        trace_graphics_scroll (event.wheel.x);
      } else if (event.type == SDL_WINDOWEVENT) {
        switch (event.window.event) {
        case SDL_WINDOWEVENT_RESIZED:
          trace_graphics_relayout (event.window.data1, event.window.data2);
          break;
        case SDL_WINDOWEVENT_CLOSE:
          quit = SDL_TRUE;
          break;
        }
      }
    }
  } while (!quit);

  SDL_Quit ();

  return EXIT_SUCCESS;
}
