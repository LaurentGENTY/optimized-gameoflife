#include "easypap.h"
#include "rle_lexer.h"

#include <omp.h>
#include <stdbool.h>
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>

#include <immintrin.h>

#define NB_TILE (DIM/TILE_SIZE)

static int* toSee=NULL;
static int* isUpdate=NULL;
static int nb_iteration;

static unsigned color = 0xFFFF00FF; // Living cells have the yellow color

typedef unsigned cell_t;
cl_mem change_buffer,next_change;

char changed = 0;

char change[2][10] = {{0,0,0,1,0,0,0,0,0,0},{1,1,1,0,0,1,1,1,1,1}};
char rules[2][10] = {{0,0,0,1,0,0,0,0,0,0},{0,0,0,1,1,0,0,0,0,0}};

static cell_t *restrict _table = NULL, *restrict _alternate_table = NULL,*restrict change_table = NULL,*restrict _alternate_change_table = NULL;

static inline cell_t *table_cell (cell_t *restrict i, int y, int x)
{
  return i + y * DIM + x;
}

// This kernel does not directly work on cur_img/next_img.
// Instead, we use 2D arrays of boolean values, not colors
#define cur_table(y, x) (*table_cell (_table, (y), (x)))
#define next_table(y, x) (*table_cell (_alternate_table, (y), (x)))

void life_init (void)
{

  // life_init may be (indirectly) called several times so we check if data were
  // already allocated
  if (_table == NULL) {
    const unsigned size = DIM * DIM * sizeof (cell_t);

    PRINT_DEBUG ('u', "Memory footprint = 2 x %d bytes\n", size);

    _table = mmap (NULL, size, PROT_READ | PROT_WRITE,
                   MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);

    _alternate_table = mmap (NULL, size, PROT_READ | PROT_WRITE,
                             MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);

    change_table = mmap (NULL, size, PROT_READ | PROT_WRITE,
                             MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    _alternate_change_table = mmap (NULL, size, PROT_READ | PROT_WRITE,
                             MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
     toSee = malloc(sizeof(int)*NB_TILE*NB_TILE);
     for (int i = 0; i < NB_TILE; i++)
       for (int j = 0; j < NB_TILE; j++) {
         toSee[(i*NB_TILE) + j] = 0;
     }
     isUpdate = malloc(sizeof(int)*NB_TILE*NB_TILE);
      for (int i = 0; i < NB_TILE; i++)
        for (int j = 0; j < NB_TILE; j++) {
          isUpdate[(i*NB_TILE) + j] = 0;
      }
     nb_iteration =  0;
 }
}

void printAled(){
  printf("\n\n");
  for (int i = 0; i < NB_TILE; i++){
    for (int j = 0; j < NB_TILE; j++) {
      printf("%d ", toSee[(i*NB_TILE) + j]);
    }
    printf("\n");
  }
}

void life_finalize (void)
{
  const unsigned size = DIM * DIM * sizeof (cell_t);

  munmap (_table, size);
  munmap (_alternate_table, size);
}

// This function is called whenever the graphical window needs to be refreshed
void life_refresh_img (void)
{
  for (int i = 0; i < DIM; i++)
    for (int j = 0; j < DIM; j++)
      cur_img (i, j) = cur_table (i, j) * color;
}

static inline void swap_tables (void)
{
  cell_t *tmp = _table;

  _table           = _alternate_table;
  _alternate_table = tmp;
}

///////////////////////////// Sequential version (seq)

void updateNextIter(int x, int y){
  isUpdate[(x/TILE_SIZE)*NB_TILE + y/TILE_SIZE] = nb_iteration;
}

static int compute_new_state (int y, int x)
{
  unsigned n  = 0;
  unsigned me = cur_table (y, x) != 0;
  unsigned change = 0;

  if (x > 0 && x < DIM - 1 && y > 0 && y < DIM - 1) {

    for (int i = y - 1; i <= y + 1; i++)
      for (int j = x - 1; j <= x + 1; j++)
        n += cur_table (i, j);

    n = (n == 3 + me) | (n == 3);
    if (n != me){
      changed = 1;
      updateNextIter(y, x);
  }

    next_table (y, x) = n;
  }

  return change;
}

static void compute_new_state_omp (int y, int x)
{
    __m256i m = _mm256_setzero_si256();
    int n;
    for (int i = y - 1; i <= y + 1; i++)
      for (int j = x - 1; j <= x + 1; j++){
          m=_mm256_add_epi8(m,_mm256_set1_epi8(cur_table (i, j)));
      }
    n = _mm256_extract_epi8(m,0);
    if(change[cur_table (y,x)!=0][n]){
        changed = 1;
        updateNextIter(y, x);
    }

    next_table (y, x) = rules[cur_table (y,x)!=0][n];
}


unsigned life_compute_seq (unsigned nb_iter)
{
  for (unsigned it = 1; it <= nb_iter; it++) {
    int change = 0;

    monitoring_start_tile (0);

    for (int i = 0; i < DIM; i++)
      for (int j = 0; j < DIM; j++)
        change |= compute_new_state (i, j);

    monitoring_end_tile (0, 0, DIM, DIM, 0);

    swap_tables ();

    if (!change)
      return it;
  }

  return 0;
}

void life_refresh_img_ocl ()
{
    printf("Coucou c'est moi \n");
  cl_int err;

  err =
      clEnqueueReadBuffer (queue, cur_buffer, CL_TRUE, 0,
                           sizeof (cell_t) * DIM * DIM, _table, 0, NULL, NULL);
  check (err, "Failed to read buffer from GPU");

  life_refresh_img ();
}


void life_init_ocl (void)
{

  change_buffer = clCreateBuffer (context, CL_MEM_READ_WRITE,
                              sizeof (unsigned) * DIM * DIM, NULL, NULL);
  if (!change_buffer)
    exit_with_error ("Failed to allocate input buffer");

  next_change = clCreateBuffer (context, CL_MEM_READ_WRITE,
                                sizeof (unsigned) * DIM * DIM, NULL, NULL);
  if (!next_change)
  exit_with_error ("Failed to allocate output buffer");
}

void life_draw_ocl (char *param)
{
  const int size       = DIM * DIM * sizeof (unsigned);
  cl_int err;

  unsigned *change_table = malloc (size);
  unsigned *_alternate_change_table = malloc (size);

  for (int i = 1; i < NB_TILE+1; i++)
    for (int j = 1; j < NB_TILE+1; j++) {
      change_table[(i*DIM) + j] = 1;
  }
  for(int j = 0; j < DIM; j++){
      change_table[j] = 0;
  }
  for(int j = 0; j < DIM; j++){
      change_table[j+DIM*(NB_TILE+1)] = 0;
  }
  for(int i = 0; i < DIM; i++){
      change_table[i*DIM] = 0;
  }
  for(int i = 0; i < DIM; i++){
      change_table[i*DIM+NB_TILE+1] = 0;
  }
  for (int i = 0; i < DIM*DIM; i++)
      _alternate_change_table[i] = 0;


  err = clEnqueueWriteBuffer (queue, change_buffer, CL_TRUE, 0,
                              size, change_table, 0, NULL,NULL);
  check (err, "Failed to write to extra buffer");

  err = clEnqueueWriteBuffer (queue, next_change, CL_TRUE, 0, size, _alternate_change_table, 0,
                              NULL, NULL);
  check (err, "Failed to write to extra buffer");

  free (change_table);
  free(_alternate_change_table);

  img_data_replicate ();
  life_refresh_img_ocl();
}







//
// void life_alloc_buffers_ocl (void)
// {
//   // Allocate buffers inside device memory
//   //
//   cur_buffer = clCreateBuffer (context, CL_MEM_READ_WRITE,
//                                sizeof (unsigned) * DIM * DIM, NULL, NULL);
//   if (!cur_buffer)
//     exit_with_error ("Failed to allocate input buffer");
//
//   next_buffer = clCreateBuffer (context, CL_MEM_READ_WRITE,
//                                 sizeof (unsigned) * DIM * DIM, NULL, NULL);
//   if (!next_buffer)
//     exit_with_error ("Failed to allocate output buffer");
//   // Allocate buffers inside device memory
//   //
//
//
//   printf("Je commence ma première écriture dans le buffer\n");
//   cl_int err = clEnqueueWriteBuffer (queue, change_buffer, CL_TRUE, 0,
//                               sizeof (unsigned) * DIM * DIM, change_table, 0, NULL,
//                               NULL);
//   check (err, "Failed to write to change_buffer");
//   printf("Je termine ma première écriture dans le buffer\n");
//   printf("Je commence ma deuxième écriture dans le buffer\n");
//   err = clEnqueueWriteBuffer (queue, next_change, CL_TRUE, 0,
//                               sizeof (unsigned) * DIM * DIM, _alternate_change_table, 0, NULL,
//                               NULL);
//   check (err, "Failed to write to next_change");
//   printf("Je termine ma deuxième écriture dans le buffer\n");
// }

unsigned life_invoke_ocl (unsigned nb_iter)
{
    size_t global[2] = {SIZE, SIZE};   // global domain size for our calculation
    size_t local[2]  = {TILEX, TILEY}; // local domain size for our calculation
    static cl_event prof_event;
    life_init();

    for (unsigned it = 1; it <= nb_iter; it++) {
      // Set kernel arguments
      //
      cl_int err = 0;
      err |= clSetKernelArg (compute_kernel, 0, sizeof (cl_mem), &cur_buffer);
      err |= clSetKernelArg (compute_kernel, 1, sizeof (cl_mem), &next_buffer);
      err |= clSetKernelArg (compute_kernel, 2, sizeof (cl_mem), &change_buffer);
      err |= clSetKernelArg (compute_kernel, 3, sizeof (cl_mem), &next_change);
      check (err, "Failed to set kernel arguments");
      err = clEnqueueNDRangeKernel (queue, compute_kernel, 2, NULL, global, local,
                                    0, NULL, &prof_event);
      check (err, "Failed to execute kernel");

      // Swap buffers
      {
        cl_mem tmp  = cur_buffer;
        cur_buffer  = next_buffer;
        next_buffer = tmp;
      }
      {
        cl_mem tmp1  = change_buffer;
        change_buffer  = next_change;
        next_change = tmp1;
      }
    }
    return 0;
}

///////////////////////////// Tiled sequential version (tiled)

unsigned life_compute_omp (unsigned nb_iter)
{
  for (unsigned it = 1; it <= nb_iter; it++) {

    monitoring_start_tile (0);

    #pragma omp parallel
    #pragma omp for collapse(2) schedule(dynamic,8)
    for (int i = 1; i < DIM-1; i++)
      for (int j = 1; j < DIM-1; j++) {
        compute_new_state_omp (i, j);
      }


    monitoring_end_tile (0, 0, DIM, DIM, 0);

    swap_tables ();

    if (!changed)
      return it;
     changed = 0;
  }

  return 0;
}

// Tile inner computation
static void do_tile_reg (int x, int y, int width, int height)
{

  for (int i = y; i < y + height; i++)
    for (int j = x; j < x + width; j++)
      compute_new_state_omp (i, j);

}

static void do_tile (int x, int y, int width, int height, int who)
{

  monitoring_start_tile (who);

  do_tile_reg (x, y, width, height);

  monitoring_end_tile (x, y, width, height, who);

}

unsigned life_compute_tiled (unsigned nb_iter)
{
  unsigned res = 0;

  for (unsigned it = 1; it <= nb_iter; it++) {

    for (int y = 1; y < DIM-TILE_SIZE; y += TILE_SIZE)
      for (int x = 1; x < DIM-TILE_SIZE; x += TILE_SIZE)
        do_tile (x, y, TILE_SIZE, TILE_SIZE, 0);

    swap_tables ();

    if (!changed) { // we stop when all cells are stable
      res = it;
      break;
    }
  }
  changed = 0;
  return res;
}

static inline int toCoord(int x, int y){
  return (x * NB_TILE) + y;
}

unsigned life_compute_omp_tiled (unsigned nb_iter)
{
  unsigned res = 0;

  int indice;
  for (unsigned it = 1; it <= nb_iter; it++) {
    int tmp_nb = nb_iteration;
    nb_iteration += 1;
    #pragma omp parallel
    #pragma omp for collapse(2) schedule(dynamic,8)
    for (int x = 1; x < NB_TILE-1; x += 1){
      for (int y = 1; y < NB_TILE-1; y += 1){
        if((toSee[toCoord(x - 1, y - 1)] == tmp_nb) || (toSee[toCoord(x, y - 1)] == tmp_nb)  || (toSee[toCoord(x + 1, y - 1)] == tmp_nb) || (toSee[toCoord(x - 1, y)]  == tmp_nb)
          || (toSee[toCoord(x, y)] == tmp_nb) || (toSee[toCoord(x + 1, y)] == tmp_nb) || (toSee[toCoord(x - 1, y + 1)] == tmp_nb) || (toSee[toCoord(x, y + 1)] == tmp_nb)
          || (toSee[toCoord(x + 1, y + 1)] == tmp_nb)){
            do_tile (x*TILE_SIZE, y*TILE_SIZE, TILE_SIZE, TILE_SIZE, omp_get_thread_num());
          }
      }
    }
    #pragma omp parallel for schedule(dynamic,8)
    for (int y = 1; y < NB_TILE-1; y += 1){
        if((toSee[toCoord(0, y)] == tmp_nb) || (toSee[toCoord(0, y+1)] == tmp_nb) ||
            (toSee[toCoord(0, y-1)] == tmp_nb) || (toSee[toCoord(1, y-1)] == tmp_nb) || (toSee[toCoord(1, y)] == tmp_nb)
            || toSee[toCoord(1, y +1)]) do_tile (1, y*TILE_SIZE, TILE_SIZE-1, TILE_SIZE, omp_get_thread_num());
        int x = NB_TILE-1;
        if((toSee[toCoord(x-1, y -1)] == tmp_nb) || (toSee[toCoord(x-1, y)] == tmp_nb) ||
            (toSee[toCoord(x, y -1)] == tmp_nb) || (toSee[toCoord(x, y)] == tmp_nb) || (toSee[toCoord(x-1, y +1)] == tmp_nb)
            || (toSee[toCoord(x, y+1)] == tmp_nb)) do_tile (DIM-TILE_SIZE, y*TILE_SIZE, TILE_SIZE-1, TILE_SIZE, omp_get_thread_num());
    }
    #pragma omp parallel for schedule(dynamic,8)
    for (int x = 1; x < NB_TILE-1; x += 1){
        if((toSee[toCoord(x - 1, 0)] == tmp_nb) || (toSee[toCoord(x - 1, 1)] == tmp_nb) || (toSee[toCoord(x, 1)] == tmp_nb) || (toSee[toCoord(x + 1, 0)] == tmp_nb)
           || (toSee[toCoord(x, 0)] == tmp_nb) || (toSee[toCoord(x + 1, 1)] == tmp_nb))
          do_tile (x*TILE_SIZE, 1, TILE_SIZE, TILE_SIZE-1, omp_get_thread_num());
        int y = NB_TILE-1;
        if((toSee[toCoord(x - 1, y-1)] == tmp_nb) || (toSee[toCoord(x, y-1)] == tmp_nb) || (toSee[toCoord(x+1,y-1)] == tmp_nb)
          || (toSee[toCoord(x - 1,y)] == tmp_nb) || (toSee[toCoord(x, y)] == tmp_nb) || (toSee[toCoord(x +1, y)] == tmp_nb))
            do_tile (x*TILE_SIZE, DIM-TILE_SIZE, TILE_SIZE, TILE_SIZE-1, omp_get_thread_num());
    }
    if((toSee[toCoord(0, 0)] == tmp_nb) || (toSee[toCoord(1, 0)] == tmp_nb) || (toSee[toCoord(1, 1)] == tmp_nb)
      || (toSee[toCoord(0,1)] == tmp_nb)) do_tile (1, 1, TILE_SIZE-1, TILE_SIZE-1,omp_get_thread_num());
    int y = NB_TILE - 1;
    if((toSee[toCoord(0,y-1)] == tmp_nb) || (toSee[toCoord(1,y)] == tmp_nb) || (toSee[toCoord(1,y-1)] == tmp_nb)
      || (toSee[toCoord(0, y)] == tmp_nb)) do_tile (1, DIM-TILE_SIZE, TILE_SIZE-1, TILE_SIZE-1,omp_get_thread_num());
    int x = NB_TILE-1;
    if((toSee[toCoord(x - 1, 0)] == tmp_nb) || (toSee[toCoord(x, 1)] == tmp_nb) || (toSee[toCoord(x - 1, 1)] == tmp_nb)
      || (toSee[toCoord(x, 0)] == tmp_nb)) do_tile (DIM-TILE_SIZE, 1, TILE_SIZE-1, TILE_SIZE-1,omp_get_thread_num());
    indice = NB_TILE - 1;
    if((toSee[toCoord(indice - 1, indice -1)] == tmp_nb) || (toSee[toCoord(indice - 1, indice)] == tmp_nb) || (toSee[toCoord(indice, indice)] == tmp_nb)
      || (toSee[toCoord(indice, indice-1)] == tmp_nb)) do_tile (DIM-TILE_SIZE, DIM-TILE_SIZE, TILE_SIZE-1, TILE_SIZE-1,omp_get_thread_num());

    int * tmp = toSee;
    toSee = isUpdate;
    isUpdate = tmp;

    //printAled();
    swap_tables ();
    if (!changed) { // we stop when all cells are stable
      res = it;
      break;
    }
    changed = 0;
  }

  return res;
}

///////////////////////////// Initial configs

void life_draw_stable (void);
void life_draw_guns (void);
void life_draw_random (void);
void life_draw_clown (void);
void life_draw_diehard (void);
void life_draw_bugs (void);
void life_draw_otca_off (void);
void life_draw_otca_on (void);
void life_draw_meta3x3 (void);

static inline void set_cell (int y, int x)
{
  cur_table (y, x) = 1;
  if (opencl_used)
    cur_img (y, x) = 1;
}

static inline int get_cell (int y, int x)
{
  return cur_table (y, x);
}

static void inline life_rle_parse (char *filename, int x, int y,
                                   int orientation)
{
  rle_lexer_parse (filename, x, y, set_cell, orientation);
}

static void inline life_rle_generate (char *filename, int x, int y, int width,
                                      int height)
{
  rle_generate (x, y, width, height, get_cell, filename);
}

void life_draw (char *param)
{
  if (access (param, R_OK) != -1) {
    // The parameter is a filename, so we guess it's a RLE-encoded file
    life_rle_parse (param, 1, 1, RLE_ORIENTATION_NORMAL);
  } else
    // Call function ${kernel}_draw_${param}, or default function (second
    // parameter) if symbol not found
    hooks_draw_helper (param, life_draw_guns);
}

static void otca_autoswitch (char *name, int x, int y)
{
  life_rle_parse (name, x, y, RLE_ORIENTATION_NORMAL);
  life_rle_parse ("data/rle/autoswitch-ctrl.rle", x + 123, y + 1396,
                  RLE_ORIENTATION_NORMAL);
}

static void otca_life (char *name, int x, int y)
{
  life_rle_parse (name, x, y, RLE_ORIENTATION_NORMAL);
  life_rle_parse ("data/rle/b3-s23-ctrl.rle", x + 123, y + 1396,
                  RLE_ORIENTATION_NORMAL);
}

static void at_the_four_corners (char *filename, int distance)
{
  life_rle_parse (filename, distance, distance, RLE_ORIENTATION_NORMAL);
  life_rle_parse (filename, distance, distance, RLE_ORIENTATION_HINVERT);
  life_rle_parse (filename, distance, distance, RLE_ORIENTATION_VINVERT);
  life_rle_parse (filename, distance, distance,
                  RLE_ORIENTATION_HINVERT | RLE_ORIENTATION_VINVERT);
}

// Suggested cmdline: ./run -k life -s 2176 -a otca_off -ts 64 -r 10
void life_draw_otca_off (void)
{
  if (DIM < 2176)
    exit_with_error ("DIM should be at least %d", 2176);

  otca_autoswitch ("data/rle/otca-off.rle", 1, 1);
}

// Suggested cmdline: ./run -k life -s 2176 -a otca_on -ts 64 -r 10
void life_draw_otca_on (void)
{
  if (DIM < 2176)
    exit_with_error ("DIM should be at least %d", 2176);

  otca_autoswitch ("data/rle/otca-on.rle", 1, 1);
}

// Suggested cmdline: ./run -k life -s 6208 -a meta3x3 -ts 64 -r 50
void life_draw_meta3x3 (void)
{
  if (DIM < 6208)
    exit_with_error ("DIM should be at least %d", 6208);

  for (int i = 0; i < 3; i++)
    for (int j = 0; j < 3; j++)
      otca_life (j == 1 ? "data/rle/otca-on.rle" : "data/rle/otca-off.rle",
                 1 + j * (2058 - 10), 1 + i * (2058 - 10));
}

// Suggested cmdline: ./run -k life -a bugs -ts 64
void life_draw_bugs (void)
{
  for (int y = 0; y < DIM / 2; y += 32) {
    life_rle_parse ("data/rle/tagalong.rle", y + 1, y + 8, RLE_ORIENTATION_NORMAL);
    life_rle_parse ("data/rle/tagalong.rle", y + 1, (DIM - 32 - y) + 8, RLE_ORIENTATION_NORMAL);
  }
}

void life_draw_stable (void)
{
  for (int i = 1; i < DIM - 2; i += 4)
    for (int j = 1; j < DIM - 2; j += 4) {
      set_cell (i, j);
      set_cell (i, j + 1);
      set_cell (i + 1, j);
      set_cell (i + 1, j + 1);
    }
}

void life_draw_guns (void)
{
  at_the_four_corners ("data/rle/gun.rle", 1);
}

void life_draw_random (void)
{
  for (int i = 1; i < DIM - 1; i++)
    for (int j = 1; j < DIM - 1; j++)
      if (random () & 1)
        set_cell (i, j);
}

// Suggested cmdline: ./run -k life -s 256 -a clown -i 110
void life_draw_clown (void)
{
  life_rle_parse ("data/rle/clown-seed.rle", DIM / 2, DIM / 2,
                  RLE_ORIENTATION_NORMAL);
}

void life_draw_diehard (void)
{
  life_rle_parse ("data/rle/diehard.rle", DIM / 2, DIM / 2, RLE_ORIENTATION_NORMAL);
}
