#!/usr/bin/env python3
from graphTools import *
import sys

args = parserArguments(sys.argv)
df = lireDataFrame(args)

# Selection des lignes :
# df = df[(-df.threads.isin([8])) & (df.kernel.isin(['mandel']))].reset_index(drop = True)

# Creation du graphe :
fig = creerGraphique(df=df, args=args)

engeristrerGraphique(fig)
