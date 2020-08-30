import os
from itertools import *
import subprocess


def iterateur_option(dicopt):
    options = []
    for opt, listval in dicopt.items():
        optlist = []
        for val in listval:
            optlist += [opt + str(val)]
        options += [optlist]
    for value in product(*options):
        yield ' '.join(value)


def execute(commande, ompenv, option, nbrun=1, verbose=True, easyPath='.'):
    path = os.getcwd()
    os.chdir(easyPath)
    for omp in iterateur_option(ompenv):
        for opt in iterateur_option(option):
            for i in range(nbrun):
                if (verbose):
                    print(omp + " " + commande + " -n " + opt)
                if(subprocess.call([omp + " " + commande + " -n " + opt], shell=True) == 1):
                    os.chdir(path)
                    return ("Error on the command used")
    if (not(verbose)):
        print("Experiences done")
    os.chdir(path)
