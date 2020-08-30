This projects aims at providing students with an easy-to-use programming environment to learn parallel programming.

The idea is to parallelize sequential computations on 2D matrices over multicore and GPU platforms. At each iteration,
the current matrix can be displayed, allowing to visually check the correctness of the computation method.

Multiple variants can easily been developed (e.g. sequential, tiled, omp_for, omp_task, ocl, mpi) and compared.

Most of the parameters can be specified as command line arguments, when running the program :
* size of the 2D matrices or image file to be loaded
* kernel to use (e.g. pixellize)
* variant to use (e.g. omp_task)
* maximum number of iterations to perform
* interactive mode / performance mode
* monitoring mode
* and much more!
