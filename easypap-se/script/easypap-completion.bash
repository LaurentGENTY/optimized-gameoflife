#!/usr/bin/env bash

_dir=`dirname $BASH_SOURCE`
_dir=`dirname $_dir`

. ${_dir}/script/easypap-utilities.bash

unset _dir

_easypap_completions()
{
    local LONG_OPTIONS=("--help" "--load-image" "--size" "--kernel" "--variant" "--monitoring" "--thumbnails"
                        "--trace" "--no-display" "--iterations" "--grain" "--tile-size" "--arg" "--first-touch"
                        "--label" "--mpirun" "--soft-rendering" "--show-ocl")
    local SHORT_OPTIONS=("-h" "-l" "-s" "-k" "-v" "-m" "-th"
                         "-t" "-n" "-i" "-g" "-ts" "-a" "-ft"
                         "-lb" "-mpi" "-sr" "-so")
    local NB_OPTIONS=${#LONG_OPTIONS[@]}

    local exclude_s=(1) # size excludes load-image
    local exclude_l=(2) # load-image excludes size
    local exclude_n=(5) # no-display excludes monitoring
    local exclude_t=(5) # trace excludes monitoring
    local exclude_m=(7 8) # monitoring excludes trace and no-display
    local exclude_ts=(10) # tile-size excludes grain
    local exclude_g=(11) # grain excludes tile-size

    local i cur=${COMP_WORDS[COMP_CWORD]}

    if [[ ${COMP_CWORD} = 1 ]]; then
        if [[ $cur =~ ^--.* ]]; then
            COMPREPLY=($(compgen -W '"${LONG_OPTIONS[@]}"' -- $cur))
        else
            COMPREPLY=($(compgen -W '"${SHORT_OPTIONS[@]}"' -- $cur))
        fi
    else
        prev=${COMP_WORDS[COMP_CWORD-1]}
        case $prev in
            -s|--size)
                COMPREPLY=($(compgen -W "512 1024 2048 4096" -- $cur))
                ;;
            -g|--grain)
                COMPREPLY=($(compgen -W "8 16 32 64" -- $cur))
                ;;
            -ts|--tile-size)
                COMPREPLY=($(compgen -W "8 16 32 64 128 256" -- $cur))
                ;;
            -l|--load-image)
                compopt -o filenames
                if [[ -z "$cur" ]]; then
                    COMPREPLY=($(compgen -f -X '!*.png' -- "images/"))
                else
                    COMPREPLY=($(compgen -o plusdirs -f -X '!*.png' -- $cur))
                fi
                ;;
            -a|--arg)
                compopt -o filenames
                if [[ -z "$cur" ]]; then
                    COMPREPLY=($(compgen -f -- "data/"))
                else
                    COMPREPLY=($(compgen -f -- "$cur"))
                fi
                ;;
            -k|--kernel)
                _easypap_kernels
                COMPREPLY=($(compgen -W "$kernels" $cur))
                ;;
            -v|--variant)
                if [[ $COMP_CWORD -lt 4 ]]; then
                    COMPREPLY="seq"
                else
                    # search for kernel name
                    for (( i=1; i < COMP_CWORD; i++ )); do
                        case ${COMP_WORDS[i]} in
                            -k|--kernel)
                                _easypap_variants ${COMP_WORDS[i+1]}
                                COMPREPLY=($(compgen -W "$variants" -- $cur))
                                return
                                ;;
                            *)
                                ;;
                        esac
                    done
                fi
                ;;
            -mpi|--mpirun)
                if [[ -z "$cur" ]]; then
                    COMPREPLY=("\"${MPIRUN_DEFAULT:-"-np 2"}\"")
                fi
                ;;
            -n|--no-display|-m|--monitoring|-t|--trace|-th|--thumbs|-ft|--first-touch|-du|--dump|-p|--pause|-sr|--soft-rendering|-so|--show-ocl)
                # After options taking no argument, we can suggest another option
                if [[ "$cur" =~ ^--.* ]]; then
                    _easypap_option_suggest "${LONG_OPTIONS[@]}"
                else
                    _easypap_option_suggest "${SHORT_OPTIONS[@]}"
                fi
                ;;
            -*)
                # For remaining options with one argument, we don't suggest anything
                ;;
            *)
                if [[ "$cur" =~ ^--.* ]]; then
                    _easypap_option_suggest "${LONG_OPTIONS[@]}"
                else
                    _easypap_option_suggest "${SHORT_OPTIONS[@]}"
                fi
                ;;
        esac
    fi
}

_easyview_completions()
{
    local LONG_OPTIONS=("--compare" "--no-thumbs" "--help" "--range" "--dir" "--align" "--iteration" "--whole-trace")
    local SHORT_OPTIONS=("-c" "-nt" "-h" "-r" "-d" "-a" "-i" "-w")
    local NB_OPTIONS=${#LONG_OPTIONS[@]}

    local exclude_r=(6 7) # range excludes iteration and whole-trace
    local exclude_i=(3 7) # iteration excludes range and whole-trace
    local exclude_w=(3 6) # whole-trace excludes range and iteration

    local cur=${COMP_WORDS[COMP_CWORD]}

    if (( COMP_CWORD > 1 )); then
        case ${COMP_WORDS[COMP_CWORD-1]} in
            -d|--dir)
                #compopt -o filenames
                if [[ -z "$cur" ]]; then
                    COMPREPLY=($(compgen -d -- "traces/data/"))
                else
                    COMPREPLY=($(compgen -d -- "$cur"))
                fi
                return
                ;;
            *)
                ;;        
        esac
    fi

    # check cmdline
    local i tracedir compare=0
    for (( i=1; i < COMP_CWORD; i++ )); do
        case ${COMP_WORDS[i]} in
            -c|--compare)
                compare=1
                ;;
            -d|--dir)
                if (( i < COMP_CWORD - 1)); then
                    tracedir=${COMP_WORDS[i+1]}
                fi
                ;;
            *)
                ;;
        esac
    done
    if [[ -z $tracedir ]]; then
        tracedir="traces/data"
    fi
    if [[ "$cur" =~ ^--.* ]]; then
        _easypap_option_suggest "${LONG_OPTIONS[@]}"
    elif [[ "$cur" =~ ^-.* || $compare = 1 ]]; then
        _easypap_option_suggest "${SHORT_OPTIONS[@]}"
    else
        compopt -o filenames
        if [[ -z "$cur" ]]; then
            COMPREPLY=($(compgen -f -X '!*.evt' -- ${tracedir}/))
        else
            COMPREPLY=($(compgen -o plusdirs -f -X '!*.evt' -- $cur))
        fi
    fi
}

complete -F _easypap_completions ./run
complete -F _easyview_completions ./view
