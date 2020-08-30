#!/usr/bin/env bash

# result placed in kernels
_easypap_kernels()
{
    local f tmp

    kernels=

    if [ ! -f obj/none.o ]; then
        return
    fi

    tmp=`nm obj/*.o | awk '/_compute_seq$/ {print $3}'`

    for f in $tmp; do
        f=${f#_}
        f=${f%_compute_seq}
        kernels="$kernels $f"
    done
}

# result placed in variants
_easypap_variants()
{
    local f tmp

    variants=

    if [ ! -f obj/none.o ]; then
        return
    fi

    tmp=`nm obj/*.o | awk '/ +_?'"$1"'_compute_[^.]*$/ {print $3}'`

    for f in $tmp; do
        variants="$variants ${f#*_compute_}"
    done
}

# result placed in pos
_easypap_option_position()
{
    local p

    if [[ $1 =~ ^--.* ]]; then
	    list=("${LONG_OPTIONS[@]}")
    else
	    list=("${SHORT_OPTIONS[@]}")
    fi
    for (( p=0; p < $NB_OPTIONS; p++ )); do
	    if [[ "${list[p]}" = "$1" ]]; then
	        pos=$p
	        return
	    fi
    done
    pos=$NB_OPTIONS
}

_easypap_remove_from_suggested()
{
    local i
    for (( i=0; i<${#suggested[@]}; i++ )); do 
        if [[ ${suggested[i]} == $1 ]]; then
            suggested=( "${suggested[@]:0:$i}" "${suggested[@]:$((i + 1))}" )
            i=$((i - 1))
        fi
    done
}

_easypap_option_suggest()
{
    local c e suggested=("$@")
    
    for (( c=1; c < $COMP_CWORD; c++ )); do
	    if [[ ${COMP_WORDS[c]} =~ ^-.* ]]; then
	        _easypap_option_position ${COMP_WORDS[c]}
	        if (( pos < NB_OPTIONS )); then

		        # we shall remove this option from suggested options
                _easypap_remove_from_suggested ${LONG_OPTIONS[pos]}

		        local todel=${SHORT_OPTIONS[pos]}
                _easypap_remove_from_suggested $todel

		        # also remove antagonist options
		        local excluding_opt=exclude_${todel#-}
		        eval excluding_opt='(${'${excluding_opt}'[@]})'
		        for ((e=0; e < ${#excluding_opt[@]}; e++ )); do
		            local p=${excluding_opt[e]}
                    _easypap_remove_from_suggested ${LONG_OPTIONS[p]}
                    _easypap_remove_from_suggested ${SHORT_OPTIONS[p]}
		        done
	        fi
	    fi
    done

    COMPREPLY=($(compgen -W '"${suggested[@]}"' -- $cur))
}
