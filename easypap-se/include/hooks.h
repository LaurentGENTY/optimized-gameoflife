#ifndef HOOKS_IS_DEF
#define HOOKS_IS_DEF

typedef void (*void_func_t) (void);
typedef unsigned (*int_func_t) (unsigned);
typedef void (*draw_func_t) (char *);

extern void_func_t the_first_touch;
extern void_func_t the_init;
extern draw_func_t the_draw;
extern void_func_t the_finalize;
extern int_func_t the_compute;
extern void_func_t the_refresh_img;

void *hooks_find_symbol (char *symbol);
void hooks_establish_bindings (void);

// Call function ${kernel}_draw_${suffix}, or default_func if symbol not found
void hooks_draw_helper (char *suffix, void_func_t default_func);

#endif