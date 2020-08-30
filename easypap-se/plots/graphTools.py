# coding: 8859
import argparse
import pandas as pds
import numpy as np
import seaborn as sns
import matplotlib.pyplot as plt
import os
import sys
import textwrap
from matplotlib.backends.backend_pdf import PdfPages

sns.set(style="darkgrid")


def openfile(path="./plots/data/perf_data.csv", sepa=";"):
    try:
        return pds.read_csv(path, sep=sepa)
    except FileNotFoundError:
        print("File not found: ", path, file=sys.stderr)
        sys.exit(1)

# Donne tous les champs de df qui ne sont pas listés


def complementaryCols(listeAttr, df):
    return [i for i in list(df.columns) if i not in listeAttr]


def constantCols(df):
    return df.columns[df.eq(df.iloc[0]).all()].tolist()


def allData(name, df):  # Donne toutes les valeurs possibles de la colonne "name" dans "df"
    return df[name].unique()


def shuffle(u, v, sepa=" "):
    s = ""
    for i in zip(u, v):
        s += str(i[0]) + "=" + str(i[1]) + sepa
    return s

# Cree les nom avec toutes les valeurs non utilisees pour le reste du graphique


def creationLegende(datasForGrapheNames, df):

    attr = complementaryCols(['time', 'ref'] + datasForGrapheNames +
                             [i for i in list(df.columns) if df[i].nunique() == 1], df)

    if attr == []:
        attr = ['kernel']

    df['legend'] = df[attr].apply(
        lambda row: shuffle(attr, row.values.tolist()), axis=1)

# Donne les valeurs constantes de "df" a travers un dictionnaire


def texteParametresConstants(df, texte=""):
    const = constantCols(df)
    string = ""
    # Donne les valeurs des constantes dans l'ordre des colonnes
    dataConst = [df[i].iloc[0] for i in const]
    for i in range(len(const)):
        if dataConst[i] != "none" and str(dataConst[i]) != "nan":
            string = string + str(const[i]) + "=" + str(dataConst[i]) + " "
    return texte + " " + string


def nombreParametresConstants(df):
    return len(constantCols(df))


def creationRefSpeedUp(df, args):  # Automatise la creation du speedup
    df['refTime'] = 0

    if args.RefTimeVariants == "":
        refDF = df[df.threads == 1].reset_index(drop=True)
    else:
        refDF = df[df.variant.isin(args.RefTimeVariants)
                   & df.threads == 1].reset_index(drop=True)
    if refDF.empty:
        print("No reference to compute speedUP")
        exit()

    if 'iterations' in args.delete:
        for i in (allData('dim', refDF)):
            for ker in (allData('kernel', refDF)):
                valPerf = refDF[(refDF.dim == i) & (
                    refDF.kernel == ker)]['time']
                df.loc[(df.dim == i) & (df.kernel == ker),
                       'refTime'] = valPerf.min()
    else:
        for i in (allData('dim', refDF)):
            for ite in (allData('iterations', refDF)):
                for ker in (allData('kernel', refDF)):
                    valPerf = refDF[(refDF.dim == i) &
                                    (refDF.iterations == ite) & (refDF.kernel == ker)]['time']
                    df.loc[(df.dim == i) & (df.iterations == ite) &
                           (df.kernel == ker), 'refTime'] = valPerf.min()
    df['speedup'] = df['refTime'] / df['time']

    if args.noRefTime:
        del df['refTime']


def creerGraphique(df, args):
    constNum = nombreParametresConstants(df)
    datasForGrapheNames = [args.x, args.y, args.col, args.row]
    creationLegende(datasForGrapheNames, df)

    df = df.sort_values(by=args.y, ascending=False)

    if (args.plottype == 'lineplot'):
        g = sns.FacetGrid(df, row=args.row, col=args.col, hue="legend", sharex='col', sharey='row',
                          height=args.height, margin_titles=True, legend_out=not args.legendInside, aspect=args.aspect)

        g.map(sns.lineplot, args.x, args.y, err_style="bars", marker="o")
        g.set(xscale=args.xscale)
        g.add_legend()
        if args.x == 'threads':
            g.set(xlim=(0, None))
    else:
        g = sns.catplot(data=df, x=args.x, y=args.y, row=args.row, col=args.col, hue="legend",
                        kind=args.kind, sharex='col', sharey='row',
                        height=args.height, margin_titles=True, legend_out=not args.legendInside, aspect=args.aspect)

    sns.set(font_scale=args.font_scale)
    g.set(yscale=args.yscale)

    if constNum == 0:
        titre = (u'Courbe de {y} en fonction de {x}').format(
            x=args.x, y=args.y)
    else:
        titre = (u'{cons}').format(x=args.x, y=args.y,
                                   cons=texteParametresConstants(df, ""))
    if args.showParameters:
        plt.subplots_adjust(top=args.adjustTop)
        g.fig.suptitle(titre, wrap=True)
    else:
        print(titre)
    return g


def parserArguments(argv):
    global parser, args
    parser = argparse.ArgumentParser(
        argv, description='Process performance plots')

    all = ["dim", "iterations", "kernel", "variant", "threads",
           "grain", "schedule", "label", "machine", "custom"]

    parser.add_argument("-x", choices=all, default="threads")
    parser.add_argument(
        "-y", choices=["time", "speedup", "throughput", "custom"], default="speedup")
    parser.add_argument("-C", "--col", choices=all, default=None)
    parser.add_argument("-R", "--row", choices=all, default=None)

    parser.add_argument('-of', '--output',
                        action='store', nargs='?',
                        help='Filename to output the plot',
                        const='plot.pdf',
                        default='plot.pdf')

    parser.add_argument('-if', '--input',
                        action='store', nargs='?',
                        help="Data's filename",
                        const=os.getcwd() + "/plots/data/perf_data.csv",
                        default=os.getcwd() + "/plots/data/perf_data.csv")

    parser.add_argument('-k', '--kernel',
                        action='store', nargs='+',
                        help="list of kernels to plot",
                        default="")

    parser.add_argument('-t', '--threads',
                        action='store', nargs='+',
                        help="list of numbers of threads to plot",
                        default="")

    parser.add_argument('--delete',
                        action='store', nargs='+',
                        help="delete a column before proceeding data",
                        choices=all,
                        default=""
                        )

    parser.add_argument('-v', '--variant',
                        action='store', nargs='+',
                        help="list of variants to plot",
                        default="")

    parser.add_argument('-g', '--grain',
                        action='store', nargs='+',
                        help="list of grains to plot",
                        default="")

    parser.add_argument('-m', '--machine',
                        action='store', nargs='+',
                        help="list of machines to plot",
                        default="")

    parser.add_argument('-i', '--iterations',
                        action='store', nargs='+',
                        help="list of iterations to plot",
                        default="")

    parser.add_argument('-sc', '--schedule',
                        action='store', nargs='+',
                        help="list of schedule policies to plot",
                        default="")

    parser.add_argument('-d', '--dim',
                        action='store', nargs='+',
                        help="list of sizes to plot",
                        default="")

    parser.add_argument('-lb', '--label',
                        action='store', nargs='+',
                        help="list of labels to plot",
                        default="")

    parser.add_argument('--height',
                        action='store',
                        type=int,
                        help="to set the height of each subgraph",
                        default=4)

    parser.add_argument('--showParameters',
                        action='store_true',
                        help="to print constant parameters",
                        default=False)

    parser.add_argument('--legendInside',
                        action='store_true',
                        help="to print the legend inside the graph",
                        default=False)

    parser.add_argument('--adjustTop',
                        action='store',
                        type=float,
                        help="to adjust the space for the suptitle",
                        default=.9)

    parser.add_argument('--aspect',
                        action='store',
                        type=float,
                        help="to adjust the ratio length/height",
                        default=1.1)

    parser.add_argument('--font_scale',
                        action='store',
                        type=float,
                        help="to adjust the font of the title and the legend",
                        default=1.0)

    parser.add_argument('--noRefTime',
                        action='store_true',
                        help="do not print reftime in legend",
                        default=False)

    parser.add_argument('-rtv', '--RefTimeVariants',
                        action='store', nargs='+',
                        help="list of variants to take into account to compute the speedUP RefTimes",
                        default="")

    parser.add_argument('--yscale',
                        choices=["linear", "log", "symlog", "logit"],
                        action='store',
                        default="linear")

    parser.add_argument('--xscale',
                        choices=["linear", "log", "symlog", "logit"],
                        action='store',
                        default="linear")

    parser.add_argument('--plottype',
                        choices=['lineplot', 'catplot'],
                        action='store',
                        default="lineplot")

    parser.add_argument('--kind',
                        choices=["strip", "swarm", "box", "violin",
                                 "boxen", "point", "bar", "count"],
                        help="kind of barplot (see sns catplot)",
                        action='store',
                        default="strip")

    args = parser.parse_args()

    return args


def lireDataFrame(args):

    # Lecture du fichier d'experiences:
    df = openfile(args.input, sepa=";")

    if args.kernel != "":
        df = df[df.kernel.isin(args.kernel)].reset_index(drop=True)

    if args.iterations != "":
        df = df[df.iterations.isin(args.iterations)].reset_index(drop=True)

    if args.dim != "":
        df = df[df.dim.isin(args.dim)].reset_index(drop=True)

    if args.machine != "":
        df = df[df.machine.isin(args.machine)].reset_index(drop=True)

    if args.delete != []:
        for attr in args.delete:
            del df[attr]

    if args.y == "speedup":
        creationRefSpeedUp(df, args)

    if args.label != "":
        df = df[df.label.isin(args.label)].reset_index(drop=True)

    if args.schedule != "":
        df = df[df.schedule.isin(args.schedule)].reset_index(drop=True)

    if args.threads != "":
        df = df[df.threads.isin(args.threads)].reset_index(drop=True)

    if args.variant != "":
        df = df[df.variant.isin(args.variant)].reset_index(drop=True)

    if args.grain != "":
        df = df[df.grain.isin(args.grain)].reset_index(drop=True)

    if args.y == "throughput":
        args.y = 'throughput (MPixel / s)'
        df[args.y] = (df['dim'] ** 2) * df['iterations'] / df['time']

    if df.empty:
        print("No data")
        exit()

    return df


def engeristrerGraphique(fig):
    pp = PdfPages(args.output)
    plt.savefig(pp, format='pdf')
    pp.close()
