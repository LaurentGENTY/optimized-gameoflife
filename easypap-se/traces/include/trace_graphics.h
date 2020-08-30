#ifndef TRACE_GRAPHICS_IS_DEF
#define TRACE_GRAPHICS_IS_DEF


#include "trace_data.h"


void trace_graphics_init (unsigned w, unsigned h);
void trace_graphics_relayout (unsigned w, unsigned h);
void trace_graphics_setview (int start_iteration, int end_iteration);

void trace_graphics_mouse_moved (int x, int y);
void trace_graphics_mouse_down (int x, int y);
void trace_graphics_mouse_up (int x, int y);
void trace_graphics_scroll (int delta);

void trace_graphics_shift_left (void);
void trace_graphics_shift_right (void);
void trace_graphics_zoom_in (void);
void trace_graphics_zoom_out (void);
void trace_graphics_reset_zoom (void);
void trace_graphics_display_all (void);
void trace_graphics_toggle_align_mode (void);
void trace_graphics_toggle_vh_mode (void);

extern int use_thumbnails;


#endif