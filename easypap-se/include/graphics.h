
#ifndef GRAPHICS_IS_DEF
#define GRAPHICS_IS_DEF

#ifdef ENABLE_SDL

#include <SDL.h>

#include "global.h"

extern unsigned WIN_WIDTH, WIN_HEIGHT;

void graphics_init (void);
void graphics_alloc_images (void);
void graphics_share_texture_buffers (void);
void graphics_refresh (unsigned iter);
void graphics_dump_image_to_file (char *filename);
void graphics_save_thumbnail (unsigned iteration);
int graphics_get_event (SDL_Event *event, int blocking);
void graphics_toggle_display_iteration_number (void);
void graphics_clean (void);

#endif

#endif
