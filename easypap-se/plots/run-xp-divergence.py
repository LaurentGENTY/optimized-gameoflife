#!/usr/bin/env python3

from graphTools import *
from expTools import *
import os

# Command line options
options = {}
options["-k "] = ["stripes"]
options["-o" ] = [""]
options["-i "] = [1000]
options["-a "] = list(range(0, 9))

# Environment variables
ompenv = {}
ompenv["TILEX="] = [256]
ompenv["TILEY="] = [1]

# Launch experiments
execute('./run ', ompenv, options, nbrun=1, verbose=True, easyPath=".")
