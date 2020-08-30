#include "kernel/ocl/common.cl"

#define img_cell(i, l, c) ((i) + (l) * DIM + (c))
#define cur_table(y, x) (*img_cell (in, (y), (x)))
#define next_table(y, x) (*img_cell (out, (y), (x)))

typedef char cell_t;


__constant cell_t rules[2][9] = {
    {0,0,0,0xFFFF00FF,0,0,0,0,0},
    {0,0,0xFFFF00FF,0xFFFF00FF,0,0,0,0,0},
};

__constant unsigned rules_change[2][9] = {
    {0,0,0,1,0,0,0,0,0},
    {1,1,0,0,1,1,1,1,1},
};

__constant unsigned has_changed[2][9] = {
    {1,1,1,0,1,1,1,1,1},
    {0,0,1,1,0,0,0,0,0},
};

__kernel void life(__global unsigned *in, __global unsigned* out) {
    unsigned x = get_global_id(0);
    unsigned y = get_global_id(1);
    unsigned tilex = get_local_id(0);
    unsigned tiley = get_local_id(1);
    barrier(CLK_LOCAL_MEM_FENCE);
    unsigned n = (cur_table(y-1, x-1)!=0) + (cur_table(y-1, x)!=0) + (cur_table(y-1, x+1)!=0) + (cur_table(y, x-1)!=0)  + (cur_table(y, x+1)!=0)  + (cur_table(y+1, x-1)!=0) + (cur_table(y+1, x)!=0) + (cur_table(y+1, x+1)!=0) ;
    next_table (y, x) = rules[cur_table(y, x)][n];
}
