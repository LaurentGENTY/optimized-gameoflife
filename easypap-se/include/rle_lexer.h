#ifndef RLE_LEXER_IS_DEF
#define RLE_LEXER_IS_DEF

typedef void (*set_cell_func_t) (int y, int x);
typedef int (*get_cell_func_t) (int y, int x);

#define RLE_ORIENTATION_NORMAL  0
#define RLE_ORIENTATION_HINVERT 1
#define RLE_ORIENTATION_VINVERT 2

void rle_lexer_parse (char *filename, int xo, int yo, set_cell_func_t func, int orientation);
void rle_generate (int x, int y, int width, int height, get_cell_func_t func, char *filename);

#endif