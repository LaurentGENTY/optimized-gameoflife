#!/usr/bin/env python3

from graphTools import *
from expTools import *
import os

# Dictionnaire avec les options de compilations d'apres commande
options = {}
options["-k "] = ["mandel"]
options["-i "] = [30]
options["-v "] = ["omp_tiled"]
options["-s "] = [1024]
options["-g "] = [8, 16, 32, 64, 128]
# Pour renseigner l'option '-of' il faut donner le chemin depuis le fichier easypap
#options["-of "] = ["./plots/data/perf_data.csv"]


# Dictionnaire avec les options OMP
ompenv = {}
ompenv["OMP_NUM_THREADS="] = [1] + list(range(2, 13, 2))
#ompenv["OMP_PLACES="] = ["cores", "threads"]

nbrun = 2
# Lancement des experiences
execute('./run ', ompenv, options, nbrun, verbose=False, easyPath=".")

# Lancement de la version seq avec le nombre de thread impose a 1
options["-v "] = ["seq"]
options["-g "] = [ 8 ]
ompenv["OMP_NUM_THREADS="] = [1]
execute('./run', ompenv, options, nbrun, verbose=False, easyPath=".")
