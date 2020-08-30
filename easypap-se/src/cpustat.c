#include <SDL_image.h>
#include <SDL_opengl.h>
#include <SDL_ttf.h>
#include <hwloc.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/mman.h>

#include "cpustat.h"
#include "global.h"
#include "debug.h"
#include "error.h"
#include "graphics.h"
#include "time_macros.h"
#include "trace_common.h"

#define HISTOGRAM_WIDTH 256
#define HISTOGRAM_HEIGHT 100
#define BAR_WIDTH 4
#define BAR_HEIGHT HISTOGRAM_HEIGHT
#define PERFMETER_HEIGHT 14
#define PERFMETER_WIDTH HISTOGRAM_WIDTH
#define RIGHT_MARGIN 16
#define LEFT_MARGIN 80
#define INTERMARGIN 4
#define TOP_MARGIN 16
#define BOTTOM_MARGIN 16

unsigned WINDOW_HEIGHT         = 0;
unsigned WINDOW_WIDTH          = 0;
unsigned INITIAL_WINDOW_HEIGHT = 0;
unsigned compteur              = 0;
unsigned co                    = 0;

static SDL_Window *win           = NULL;
static SDL_Renderer *ren         = NULL;
static SDL_Texture **perf_frame  = NULL;
static SDL_Texture **perf_fill   = NULL;
static SDL_Texture *text_texture = NULL;
static SDL_Texture *idle_texture = NULL;

static Uint32 *restrict idle_img = NULL;

typedef struct
{
  long start_time, end_time, cumulated_work, cumulated_idle, nb_tiles;
} cpu_stat_t;

static unsigned NBCORES      = 1;
static cpu_stat_t *cpu_stats = NULL;

float cpustat_activity_ratio (int who);

static float idle_total (void)
{
  long total = 0, idle  = 0;

  for (int c = 0; c < NBCORES; c++) {
    idle  = idle + cpu_stats[c].cumulated_idle;
    total = total + cpu_stats[c].cumulated_work + cpu_stats[c].cumulated_idle;
  }
  return (float)idle / total;
}

static void cpustat_create_cpu_textures (void)
{
  Uint32 *restrict img =
      malloc (PERFMETER_WIDTH * PERFMETER_HEIGHT * sizeof (Uint32));

  perf_frame = malloc (MAX_COLORS * sizeof (SDL_Texture *));
  perf_fill  = malloc (MAX_COLORS * sizeof (SDL_Texture *));

  SDL_Surface *s =
      SDL_CreateRGBSurfaceFrom (img, PERFMETER_WIDTH, PERFMETER_HEIGHT, 32,
                                PERFMETER_WIDTH * sizeof (Uint32), 0xff000000,
                                0x00ff0000, 0x0000ff00, 0x000000ff);
  if (s == NULL)
    exit_with_error ("SDL_CreateRGBSurfaceFrom failed: %s", SDL_GetError ());

  for (int c = 0; c < MAX_COLORS; c++) {
    bzero (img, PERFMETER_WIDTH * PERFMETER_HEIGHT * sizeof (Uint32));

    for (int i = 0; i < PERFMETER_HEIGHT; i++)
      for (int j = 0; j < PERFMETER_WIDTH; j++)
        img[i * PERFMETER_WIDTH + j] = cpu_colors[c];

    perf_fill[c] = SDL_CreateTextureFromSurface (ren, s);

    for (int i = 1; i < PERFMETER_HEIGHT - 1; i++)
      for (int j = 1; j < PERFMETER_WIDTH - 1; j++)
        img[i * PERFMETER_WIDTH + j] = 0;

    perf_frame[c] = SDL_CreateTextureFromSurface (ren, s);
  }

  SDL_FreeSurface (s);
  free (img);
}

static void cpustat_create_idleness_textures (void)
{
  idle_img = mmap (NULL, HISTOGRAM_WIDTH * HISTOGRAM_HEIGHT * sizeof (Uint32),
                   PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);

  idle_texture =
      SDL_CreateTexture (ren, SDL_PIXELFORMAT_RGBA32, SDL_TEXTUREACCESS_STATIC,
                         HISTOGRAM_WIDTH, HISTOGRAM_HEIGHT);

  if (idle_texture == NULL)
    exit_with_error ("SDL_CreateTexture failed: %s", SDL_GetError ());
}

static void unsigned_to_sdl_color (unsigned color, SDL_Color *sdlc)
{
  sdlc->a = color & 0xFF;
  sdlc->b = (color >> 8) & 0xFF;
  sdlc->g = (color >> 16) & 0xFF;
  sdlc->r = color >> 24;
}

static void cpustat_create_text_texture (void)
{
  SDL_Color col = {255, 255, 255, 255};

  SDL_Surface *surface =
      SDL_CreateRGBSurface (0, LEFT_MARGIN, WINDOW_HEIGHT, 32, 0xff000000,
                            0x00ff0000, 0x0000ff00, 0x000000ff);
  if (surface == NULL)
    exit_with_error ("SDL_CreateRGBSurface failed: %s", SDL_GetError ());

  TTF_Font *font =
      TTF_OpenFont ("fonts/FreeSansBold.ttf", PERFMETER_HEIGHT - 2);

  if (font == NULL)
    exit_with_error ("TTF_OpenFont failed: %s", SDL_GetError ());

  for (int c = 0; c <= NBCORES; c++) {
    char msg[32];
    SDL_Rect dst;
    if (c < NBCORES) {
      snprintf (msg, 32, "CPU %2d ", c);
    } else {
      snprintf (msg, 32, "Idleness ");
    }
    SDL_Surface *s = TTF_RenderText_Blended (font, msg, col);
    if (s == NULL)
      exit_with_error ("TTF_RenderText_Solid failed: %s", SDL_GetError ());

    dst.x = LEFT_MARGIN - s->w;
    dst.y = TOP_MARGIN + (PERFMETER_HEIGHT + INTERMARGIN) * c +
            (PERFMETER_HEIGHT / 2) - (s->h / 2);
    if (c == NBCORES)
      dst.y += HISTOGRAM_HEIGHT / 2 - PERFMETER_HEIGHT / 2;

    SDL_BlitSurface (s, NULL, surface, &dst);
    SDL_FreeSurface (s);
  }

  TTF_CloseFont (font);

  text_texture = SDL_CreateTextureFromSurface (ren, surface);
  if (text_texture == NULL)
    exit_with_error ("SDL_CreateTexture failed: %s", SDL_GetError ());

  SDL_FreeSurface (surface);
}

static void cpustat_draw_text (void)
{
  SDL_Rect dst;

  dst.x = 0;
  dst.y = 0;
  dst.w = LEFT_MARGIN;
  dst.h = WINDOW_HEIGHT;

  SDL_RenderCopy (ren, text_texture, NULL, &dst);
}

static void cpustat_draw_perfmeters (void)
{
  SDL_Rect src, dst;

  src.x = 0;
  src.y = 0;
  src.w = PERFMETER_WIDTH;
  src.h = PERFMETER_HEIGHT;

  dst.x = LEFT_MARGIN;
  dst.y = TOP_MARGIN;
  dst.w = PERFMETER_WIDTH;
  dst.h = PERFMETER_HEIGHT;

  for (int c = 0; c < NBCORES; c++) {
    SDL_RenderCopy (ren, perf_frame[c % MAX_COLORS], &src, &dst);
    dst.w = cpustat_activity_ratio (c) * PERFMETER_WIDTH;
    src.w = dst.w;
    SDL_RenderCopy (ren, perf_fill[c % MAX_COLORS], &src, &dst);
    dst.w = PERFMETER_WIDTH;
    src.w = dst.w;
    dst.y += PERFMETER_HEIGHT + INTERMARGIN;
  }
}

static void cpustat_draw_idleness (void)
{
  SDL_Rect src, dst;

  for (int i = 0; i < HISTOGRAM_HEIGHT; i++) {
    // Shift previous bars to the left
    for (int j = 0; j < HISTOGRAM_WIDTH - BAR_WIDTH; j++)
      idle_img[i * HISTOGRAM_WIDTH + j] =
          idle_img[i * HISTOGRAM_WIDTH + j + BAR_WIDTH];

    // Clear last (right) slot
    for (int j = HISTOGRAM_WIDTH - BAR_WIDTH; j < HISTOGRAM_WIDTH; j++)
      idle_img[i * HISTOGRAM_WIDTH + j] = 0;
  }

  {
    float idleness  = idle_total ();
    unsigned HEIGHT = idleness * BAR_HEIGHT;
    unsigned red    = idleness * 255;
    unsigned green  = (1.0 - idleness) * 255;
    unsigned color  = (green << 8) + red;

    for (int i = HISTOGRAM_HEIGHT - HEIGHT; i < HISTOGRAM_HEIGHT; i++)
      for (int j = HISTOGRAM_WIDTH - BAR_WIDTH; j < HISTOGRAM_WIDTH - 1; j++)
        idle_img[i * HISTOGRAM_WIDTH + j] = color;
  }

  SDL_UpdateTexture (idle_texture, NULL, idle_img,
                     HISTOGRAM_WIDTH * sizeof (Uint32));

  src.x = 0;
  src.y = 0;
  src.w = HISTOGRAM_WIDTH;
  src.h = HISTOGRAM_HEIGHT;

  // On redimensionne l'image pour qu'elle occupe toute la fenêtre
  dst.x = LEFT_MARGIN;
  dst.y = INITIAL_WINDOW_HEIGHT;
  dst.w = HISTOGRAM_WIDTH;
  dst.h = HISTOGRAM_HEIGHT;

  SDL_RenderCopy (ren, idle_texture, &src, &dst);
}

void cpustat_init (int x, int y)
{
  NBCORES = easypap_requested_number_of_threads ();

  cpu_stats = malloc (NBCORES * sizeof (cpu_stat_t));

  WINDOW_WIDTH          = LEFT_MARGIN + PERFMETER_WIDTH + RIGHT_MARGIN;
  INITIAL_WINDOW_HEIGHT = TOP_MARGIN + BOTTOM_MARGIN +
                          NBCORES * PERFMETER_HEIGHT +
                          (NBCORES - 1) * INTERMARGIN;
  WINDOW_HEIGHT = INITIAL_WINDOW_HEIGHT + INTERMARGIN + HISTOGRAM_HEIGHT;

  win = SDL_CreateWindow ("Activity Monitor", x, y, WINDOW_WIDTH, WINDOW_HEIGHT,
                          SDL_WINDOW_SHOWN);
  if (win == NULL)
    exit_with_error ("SDL_CreateWindow failed: %s", SDL_GetError ());

  // Initialisation du moteur de rendu
  ren = SDL_CreateRenderer (
      win, -1, SDL_RENDERER_ACCELERATED /* | SDL_RENDERER_PRESENTVSYNC */);
  if (ren == NULL)
    exit_with_error ("SDL_CreateRenderer failed: %s", SDL_GetError ());

  SDL_RendererInfo info;
  SDL_GetRendererInfo (ren, &info);
  PRINT_DEBUG ('g', "Activity window renderer: [%s]\n", info.name);

  cpustat_create_text_texture ();

  cpustat_create_cpu_textures ();

  cpustat_create_idleness_textures ();
}

void cpustat_reset (long now)
{
  for (int c = 0; c < NBCORES; c++) {
    cpu_stats[c].cumulated_idle = cpu_stats[c].cumulated_work =
        cpu_stats[c].nb_tiles   = 0;
    cpu_stats[c].start_time     = 0;
    cpu_stats[c].end_time       = now;
  }
}

void cpustat_start_work (long now, int who)
{
  // How long did the cpu sleep?
  cpu_stats[who].cumulated_idle += (now - cpu_stats[who].end_time);
  cpu_stats[who].nb_tiles++;
  cpu_stats[who].start_time = now;

  //PRINT_DEBUG ('m', "CPU %d starts a new tile (was idle during %ld\n", who,
  //             (now - cpu_stats[who].end_time));
}

long cpustat_finish_work (long now, int who)
{
  long duration = now - cpu_stats[who].start_time;

  // How long did the cpu work?
  cpu_stats[who].cumulated_work += duration;

  //PRINT_DEBUG ('m', "CPU %d completes its tile (worked during %ld)\n", who,
  //             duration);
  return duration;
}

void cpustat_start_idle (long now, int who)
{
  cpu_stats[who].end_time = now;
}

void cpustat_freeze (long now)
{
  for (int c = 0; c < NBCORES; c++)
    cpu_stats[c].cumulated_idle += (now - cpu_stats[c].end_time);
}

float cpustat_activity_ratio (int who)
{
  long total =
      cpu_stats[who].cumulated_work + cpu_stats[who].cumulated_idle;

  if (total == 0)
    return 0.0;

  return (float)cpu_stats[who].cumulated_work / total;
}

void cpustat_display_stats (void)
{
  SDL_RenderClear (ren);

  cpustat_draw_text ();

  cpustat_draw_perfmeters ();

  cpustat_draw_idleness ();

  SDL_RenderPresent (ren);

  //for (int c = 0; c < NBCORES; c++)
  //  PRINT_DEBUG ('m', "CPU Utilization for core %2d: %3.2f\n", c,
  //               100.0 * cpustat_activity_ratio (c));
}

void cpustat_clean (void)
{
  if (cpu_stats != NULL) {
    free (cpu_stats);
    cpu_stats = NULL;
  }
  if (idle_texture != NULL) {
    SDL_DestroyTexture (idle_texture);
    idle_texture = NULL;
  }

  if (text_texture != NULL) {
    SDL_DestroyTexture (text_texture);
    text_texture = NULL;
  }

  if (perf_fill != NULL) {
    for (int c = 0; c < MAX_COLORS; c++)
      free (perf_fill[c]);
    free (perf_fill);
    perf_fill = NULL;
  }

  if (perf_frame != NULL) {
    for (int c = 0; c < MAX_COLORS; c++)
      free (perf_frame[c]);
    free (perf_frame);
    perf_frame = NULL;
  }
}
