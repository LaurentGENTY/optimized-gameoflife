
PROGRAM	:= bin/easypap

# Must be the first rule
.PHONY: default
default: $(PROGRAM)

########## Config Section ##########

ENABLE_SDL			= 1
ENABLE_MONITORING	= 1
ENABLE_VECTO		= 1
ENABLE_TRACE		= 1
ENABLE_MPI			= 1

####################################

ARCH		:= $(shell uname -s | tr a-z A-Z)

ifdef ENABLE_SDL
SOURCES		:= $(wildcard src/*.c)
else
SOURCES		:= $(filter-out src/gmonitor.c src/graphics.c src/cpustat.c, $(wildcard src/*.c))
endif

KERNELS		:= $(wildcard kernel/c/*.c)

T_SOURCE	:= traces/src/trace_common.c

ifdef ENABLE_TRACE
T_SOURCE	+= traces/src/trace_record.c
endif

L_SOURCE	:= $(wildcard src/*.l)
L_GEN		:= $(L_SOURCE:src/%.l=obj/%.c)

OBJECTS		:= $(SOURCES:src/%.c=obj/%.o)
K_OBJECTS	:= $(KERNELS:kernel/c/%.c=obj/%.o)
T_OBJECTS	:= $(T_SOURCE:traces/src/%.c=obj/%.o)
L_OBJECTS	:= $(L_SOURCE:src/%.l=obj/%.o)

ALL_OBJECTS	:= $(OBJECTS) $(K_OBJECTS) $(T_OBJECTS) $(L_OBJECTS)

DEPENDS		:= $(SOURCES:src/%.c=deps/%.d)
K_DEPENDS	:= $(KERNELS:kernel/c/%.c=deps/%.d)
T_DEPENDS	:= $(T_SOURCE:traces/src/%.c=deps/%.d)
L_DEPENDS	:= $(L_GEN:obj/%.c=deps/%.d)

ALL_DEPENDS := $(DEPENDS) $(K_DEPENDS) $(T_DEPENDS) $(L_DEPENDS)

MAKEFILES	:= Makefile

CC			:= gcc

CFLAGS 		+= -O3 -march=native -Wall -Wno-unused-function
CFLAGS		+= -I./include -I./traces/include
LDLIBS		+= -lm

ifeq ($(ARCH),DARWIN)
LDLIBS		+= -framework OpenGL
else
CFLAGS		+= -rdynamic
LDFLAGS		+= -export-dynamic
LDLIBS		+= -lGL -lpthread -ldl
endif

# Vectorization
ifdef ENABLE_VECTO
CFLAGS		+= -DENABLE_VECTO
endif

# Monitoring
ifdef ENABLE_MONITORING
CFLAGS		+= -DENABLE_MONITORING
endif

# OpenMP
CFLAGS		+= -fopenmp
LDFLAGS		+= -fopenmp

# OpenCL
CFLAGS		+= -DCL_SILENCE_DEPRECATION
ifeq ($(ARCH),DARWIN)
LDLIBS		+= -framework OpenCL
else
LDLIBS		+= -lOpenCL
endif

# Hardware Locality
PACKAGES	:= hwloc

ifdef ENABLE_SDL
CFLAGS		+= -DENABLE_SDL
PACKAGES	+= SDL2_image SDL2_ttf
endif

ifdef ENABLE_TRACE
# Right now, only fxt is supported
CFLAGS		+= -DENABLE_TRACE -DENABLE_FUT
PACKAGES	+= fxt
endif

# MPI
ifdef ENABLE_MPI
CFLAGS		+= -DENABLE_MPI
PACKAGES	+= ompi
endif


# Query CFLAGS and LDLIBS for all packages
CFLAGS		+= $(shell pkg-config --cflags $(PACKAGES))
LDFLAGS		+= $(shell pkg-config --libs-only-L $(PACKAGES))
LDLIBS		+= $(shell pkg-config --libs-only-l $(PACKAGES))

$(ALL_OBJECTS): $(MAKEFILES)

$(PROGRAM): $(ALL_OBJECTS)
	$(CC) -o $@ $^ $(LDFLAGS) $(LDLIBS)

$(OBJECTS): obj/%.o: src/%.c
	$(CC) -o $@ $(CFLAGS) -c $<

$(K_OBJECTS): obj/%.o: kernel/c/%.c
	$(CC) -o $@ $(CFLAGS) -c $<

$(T_OBJECTS): obj/%.o: traces/src/%.c
	$(CC) -o $@ $(CFLAGS) -c $<

$(L_OBJECTS): obj/%.o: obj/%.c
	$(CC) -o $@ $(CFLAGS) -c $<

$(L_GEN): obj/%.c: src/%.l
	$(LEX) -t $< > $@

.PHONY: depend
depend: $(ALL_DEPENDS)

$(ALL_DEPENDS): $(MAKEFILES)

$(DEPENDS): deps/%.d: src/%.c
	$(CC) $(CFLAGS) -MM $< | \
		sed -e 's|\(.*\)\.o:|deps/\1.d obj/\1.o:|g' > $@

$(K_DEPENDS): deps/%.d: kernel/c/%.c
	$(CC) $(CFLAGS) -MM $< | \
		sed -e 's|\(.*\)\.o:|deps/\1.d obj/\1.o:|g' > $@

$(T_DEPENDS): deps/%.d: traces/src/%.c
	$(CC) $(CFLAGS) -MM $< | \
		sed -e 's|\(.*\)\.o:|deps/\1.d obj/\1.o:|g' > $@

$(L_DEPENDS): deps/%.d: obj/%.c
	$(CC) $(CFLAGS) -MM $< | \
		sed -e 's|\(.*\)\.o:|deps/\1.d obj/\1.o:|g' > $@

ifneq ($(MAKECMDGOALS),clean)
-include $(ALL_DEPENDS)
endif

.PHONY: clean
clean: 
	rm -f $(PROGRAM) obj/* deps/* lib/*
