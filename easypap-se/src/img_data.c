#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>

#include "debug.h"
#include "error.h"
#include "global.h"
#include "img_data.h"

uint32_t *restrict image = NULL, *restrict alt_image = NULL;

unsigned DIM   = 0, GRAIN = 0, TILE_SIZE = 0;

void img_data_alloc (void)
{
  image = mmap (NULL, DIM * DIM * sizeof (uint32_t), PROT_READ | PROT_WRITE,
                MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
  if (image == NULL)
    exit_with_error ("Cannot allocate main image: mmap failed");

  alt_image = mmap (NULL, DIM * DIM * sizeof (uint32_t), PROT_READ | PROT_WRITE,
                    MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
  if (alt_image == NULL)
    exit_with_error ("Cannot allocate alternate image: mmap failed");

  PRINT_DEBUG ('i', "Init phase 4: images allocated\n");
}

void img_data_free (void)
{
  if (image != NULL) {
    munmap (image, DIM * DIM * sizeof (uint32_t));
    image = NULL;
  }

  if (alt_image != NULL) {
    munmap (alt_image, DIM * DIM * sizeof (uint32_t));
    alt_image = NULL;
  }
}

void img_data_replicate (void)
{
  memcpy (alt_image, image, DIM * DIM * sizeof (uint32_t));
}
