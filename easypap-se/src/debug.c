
#include <string.h>

#include "debug.h"

char *debug_flags = NULL;

void debug_init (char *flags)
{
  debug_flags = flags;
}

int debug_enabled (char flag)
{
  if (debug_flags != NULL)
    return (strchr (debug_flags, flag) != 0)
      || (strchr (debug_flags, '+') != 0);
  else
    return 0;
}
