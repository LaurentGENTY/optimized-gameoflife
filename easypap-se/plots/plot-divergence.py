#!/usr/bin/env python3

from graphTools import *
import sys


args = parserArguments(sys.argv)
df = lireDataFrame(args)

# Let us translate 'arg' into '2^arg'
group = 'group size (consecutive threads following same path)'
df[group] = (2 ** df['arg'])
del(df['arg'])

args.x = group

# Generate plot
fig = creerGraphique(df=df, args=args)

engeristrerGraphique(fig)
