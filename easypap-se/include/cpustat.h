#ifndef CPUSTAT_IS_DEF
#define CPUSTAT_IS_DEF

#ifdef ENABLE_SDL

#include <SDL.h>

static void cpustat_create_cpu_textures (void);
static void unsigned_to_sdl_color (unsigned color, SDL_Color *sdlc);
static void cpustat_create_text_texture (void);
static void cpustat_draw_text (void);
static void cpustat_draw_perfmeters (void);

void cpustat_init (int x, int y);
void cpustat_reset (long now);
void cpustat_start_work (long now, int who);
long cpustat_finish_work (long now, int who);
void cpustat_start_idle (long now, int who);
void cpustat_freeze (long now);
void cpustat_display_stats (void);
void cpustat_clean (void);

int cpustat_tile (int who);

#endif

#endif
