#include "kernel/ocl/common.cl"
#define NB_TILE (DIM/TILE_SIZE)

#define table_cell(i, l, c) ((i) + (l) * DIM + (c))
#define cur_table(y, x) (*table_cell (in, (y), (x)))
#define next_table(y, x) (*table_cell (out, (y), (x)))
#define change(y, x) (*table_cell (c_in, (y), (x)))
#define next_change(y, x) (*table_cell (c_out, (y), (x)))

typedef unsigned cell_t;


__constant cell_t rules[2][9] = {
    {0,0,0,0xFFFF00FF,0,0,0,0,0},
    {0,0,0xFFFF00FF,0xFFFF00FF,0,0,0,0,0},
};

__constant cell_t has_changed[2][9] = {
    {0,0,0,1,0,0,0,0,0},
    {1,1,0,0,1,1,1,1,1},
};


__kernel void life_ocl (__global cell_t *in, __global cell_t* out){//,__global cell_t* c_in,__global cell_t* c_out) {
    unsigned x = get_global_id(0);
    unsigned y = get_global_id(1);
    unsigned tilex = get_local_id(0);
    unsigned tiley = get_local_id(1);
    barrier(CLK_LOCAL_MEM_FENCE);
    unsigned n = 0;
    //unsigned compute = change(tiley, tilex) | change(tiley, tilex+1) | change(tiley, tilex+2) | change(tiley+1, tilex) | change(tiley+1, tilex+1) | change(tiley+1, tilex+2) | change(tiley+2, tilex) | change(tiley+2, tilex+1)
    //                | change(tiley+2, tilex+2);
    //if(compute)
    {
        if(x>0 && y>0 && y<(DIM-1) && x<(DIM-1))
        n = (cur_table(y-1, x-1)!=0) + (cur_table(y-1, x)!=0) + (cur_table(y-1, x+1)!=0) + (cur_table(y, x-1)!=0)  + (cur_table(y, x+1)!=0)  + (cur_table(y+1, x-1)!=0)
            + (cur_table(y+1, x)!=0) + (cur_table(y+1, x+1)!=0) ;
        else{
            if(y == 0 &&  x>0 && x<(DIM-1))
            n = (cur_table(y, x-1)!=0)  + (cur_table(y, x+1)!=0)  + (cur_table(y+1, x-1)!=0) + (cur_table(y+1, x)!=0) + (cur_table(y+1, x+1)!=0) ;
            if(y == (DIM-1) &&  x>0 && x<(DIM-1))
            n = (cur_table(y-1, x-1)!=0) + (cur_table(y-1, x)!=0) + (cur_table(y-1, x+1)!=0) + (cur_table(y, x-1)!=0)  + (cur_table(y, x+1)!=0) ;
            else{
                if(x == 0 &&  y>0 && y<(DIM-1))
                n =  (cur_table(y-1, x)!=0) + (cur_table(y-1, x+1)!=0)  + (cur_table(y, x+1)!=0) + (cur_table(y+1, x)!=0) + (cur_table(y+1, x+1)!=0) ;
                if(x == (DIM-1) &&  y>0 && y<(DIM-1))
                n =  (cur_table(y-1, x)!=0) + (cur_table(y-1, x-1)!=0)  + (cur_table(y, x-1)!=0) + (cur_table(y+1, x)!=0) + (cur_table(y+1, x-1)!=0) ;
                else{
                    if(x == 0 &&  y==0)
                    n = (cur_table(y, x+1)!=0) + (cur_table(y+1, x)!=0) + (cur_table(y+1, x+1)!=0) ;
                    if(x == 0 &&  y==(DIM-1))
                    n =  (cur_table(y-1, x)!=0) + (cur_table(y-1, x+1)!=0)  + (cur_table(y, x+1)!=0);
                    if(x == (DIM-1) &&  y==0)
                    n = (cur_table(y, x-1)!=0) + (cur_table(y+1, x)!=0) + (cur_table(y+1, x-1)!=0) ;
                    if(x == (DIM-1) &&  y==(DIM-1))
                    n =  (cur_table(y-1, x)!=0) + (cur_table(y-1, x-1)!=0)  + (cur_table(y, x-1)!=0);
                }
            }
        }
    }
    next_table (y, x) = rules[cur_table(y, x)!=0][n];
    //next_change (tilex+1,tiley+1) = has_changed[cur_table(y, x)!=0][n] | next_change (tilex+1,tiley+1);
}
