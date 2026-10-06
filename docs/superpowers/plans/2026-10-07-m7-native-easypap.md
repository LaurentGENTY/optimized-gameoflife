# Jalon 7 — easypap natif sur macOS (arm64), `bench/native.json`, README « 2020 → 2026 » : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** recompiler l'easypap de 2020 sur le Mac de Laurent (Apple Silicon) avec les seuls correctifs de build nécessaires, mesurer les variantes `seq`, `omp_tiled` et `ocl` du noyau `life` sur les mêmes tailles et motifs que le benchmark web, écrire `bench/native.json` et raconter l'histoire « 2020 → 2026 » dans le README.

**Architecture :** `easypap-se/` reste le code de 2020. Seuls changent le Makefile et un en-tête de compatibilité, pour arm64, clang et libomp. Un script `bench/run-native.sh` lance `easypap -n` pour chaque cas, prend la médiane de 3 runs et écrit le JSON au format `NativeReport` du jalon 5. Le benchmark web l'affiche automatiquement (barres hachurées).

**Tech Stack :** Apple clang + Homebrew `libomp`, `hwloc`, `sdl2_image`, `sdl2_ttf`, `pkgconf` ; SIMDe (traduction AVX → NEON, en-têtes seulement) ; framework OpenCL de macOS ; bash + python3 pour le script.

**Spec :** `docs/superpowers/specs/2026-10-06-webgpu-gameoflife-design.md` (rév. 2), section 6 et jalon 7.

## Global Constraints

- Time-box : une soirée. Si OpenCL ne compile pas ou ne tourne pas, on abandonne la variante `ocl`, sans barre native OpenCL dans le graphique.
- `easypap-se/` ne reçoit que des correctifs de build macOS : Makefile, include de compatibilité. Aucune modification des noyaux de calcul : les chiffres natifs sont ceux du code de 2020, bugs compris (lazy tiling transposé, arrêt anticipé sur grille stable).
- Apple Silicon : l'AVX de `kernel/c/life.c` et `kernel/c/rotation90.c` est traduit par SIMDe (`SIMDE_ENABLE_NATIVE_ALIASES`) et compilé tel quel.
- `fxt` n'existe pas dans Homebrew : `ENABLE_TRACE` est désactivé, donc ni trace ni EasyView en natif (écart assumé à la spec, à écrire dans le README). `-m` (monitoring SDL) reste disponible. MPI est désactivé.
- Mesure : `easypap -k life -v <variant> -s <size> -a <pattern> -i <iters> -n`, avec un nombre d'itérations calibré pour qu'un run dure ≥ 1 s, médiane de 3 runs, et gens/s = itérations effectuées / temps. Le temps vient de la ligne de perf d'easypap. Si `seq` s'arrête avant la fin (grille stable), on utilise le nombre d'itérations réellement effectuées, affiché par easypap.
- Motifs : `random` et `guns` à toutes les tailles (512 à 4096), `otca_off` à 4096 (il exige ≥ 2176). Tailles de tuile : `-ts 32` pour `omp_tiled`.
- Installation Homebrew : `brew install pkgconf hwloc sdl2_image sdl2_ttf libomp simde`, qui sont les dépendances listées par la spec plus leurs prérequis.
- Pas de push. Commits en anglais, terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Le README peut rester en français (comme l'existant).

## Review Focus

1. **Variante qui s'arrête tôt** (`seq` sur une grille devenue stable) → gens/s calculé sur les itérations effectuées, jamais sur les itérations demandées.
2. **Variante qui plante ou n'existe pas** (`ocl` sans device) → le script le note, saute le cas et produit quand même un JSON valide pour les autres.
3. **`bench/native.json` conforme à `parseNativeReport`** (jalon 5) → le graphique web l'affiche. Vérifié dans le navigateur.
4. **Le build natif ne casse pas Linux** → les correctifs sont conditionnés à `ARCH == DARWIN`.
5. **Le README ne surpromet pas** : bugs de 2020, écart EasyView, chiffres live vs benchmark, tous écrits.

---

### Task 1 : dépendances et build easypap sur arm64

**Files :**
- Modify : `easypap-se/Makefile`
- Create : `easypap-se/include/arch_compat.h`
- Modify : `easypap-se/kernel/c/life.c`, `easypap-se/kernel/c/rotation90.c` (une seule ligne chacun : `#include <immintrin.h>` → `#include "arch_compat.h"`)

- [ ] **Step 1 : Installer**

```bash
brew install pkgconf hwloc sdl2_image sdl2_ttf libomp simde
```

- [ ] **Step 2 : En-tête de compatibilité**

`easypap-se/include/arch_compat.h` :

```c
#ifndef ARCH_COMPAT_H
#define ARCH_COMPAT_H

// 2026 macOS build fix: the 2020 kernels use AVX intrinsics; on Apple Silicon,
// SIMDe maps them to NEON so the original code compiles unchanged.
#if defined(__x86_64__) || defined(__i386__)
#include <immintrin.h>
#else
#define SIMDE_ENABLE_NATIVE_ALIASES
#include <simde/x86/avx2.h>
#endif

#endif
```

Remplacer `#include <immintrin.h>` par `#include "arch_compat.h"` dans les deux noyaux.

- [ ] **Step 3 : Makefile (Darwin uniquement)**

Dans `easypap-se/Makefile`, juste après la section « Config Section » :

```make
# 2026 macOS build fixes: no fxt or MPI in Homebrew, Apple clang needs libomp explicitly.
ifeq ($(shell uname -s),Darwin)
undefine ENABLE_TRACE
undefine ENABLE_MPI
BREW		:= $(shell brew --prefix)
CC			:= clang
endif
```

Puis, juste avant la section `# OpenMP`, remplacer les deux lignes `-fopenmp` par :

```make
ifeq ($(ARCH),DARWIN)
CFLAGS		+= -Xpreprocessor -fopenmp -I$(BREW)/opt/libomp/include -I$(BREW)/include
LDFLAGS		+= -L$(BREW)/opt/libomp/lib
LDLIBS		+= -lomp
else
CFLAGS		+= -fopenmp
LDFLAGS		+= -fopenmp
endif
```

et retirer la définition existante `CC := gcc` du chemin Darwin (elle reste pour Linux : mettre `CC ?= gcc` hors du bloc Darwin, ou garder `CC := gcc` dans un `else`).

- [ ] **Step 4 : Compiler et corriger (systematic-debugging)**

Run : `make -C easypap-se -j 8 2>&1 | tail -30`
Attendu : `bin/easypap` est produit. Chaque erreur restante se traite avec la skill `superpowers:systematic-debugging` : lire l'erreur, trouver la cause, appliquer un correctif minimal, uniquement dans le Makefile ou `arch_compat.h`. Garder une liste des correctifs pour le README. Si une erreur exige de toucher à un noyau de calcul, s'arrêter et consigner une ruling.

- [ ] **Step 5 : Fumée**

```bash
cd easypap-se && ./run -k life -v seq -s 512 -a random -i 100 -n; ./run -k life -v omp_tiled -s 512 -a random -i 100 -n -ts 32; ./run -k life -v ocl -s 512 -a random -i 100 -n
```

(`./run` est le lanceur d'easypap. S'il n'existe pas ou échoue, utiliser `bin/easypap` avec les mêmes arguments.)
Attendu : chaque variante affiche « Computation completed after N iterations » et un temps. Si `ocl` échoue, consigner l'erreur et abandonner la variante (time-box).

- [ ] **Step 6 : Commit**

```bash
git add easypap-se/Makefile easypap-se/include/arch_compat.h easypap-se/kernel/c/life.c easypap-se/kernel/c/rotation90.c
git commit -m "build(easypap): build the 2020 code on Apple Silicon (SIMDe, libomp)"
```

---

### Task 2 : `bench/run-native.sh` → `bench/native.json`

**Files :**
- Create : `bench/run-native.sh`, `bench/native.json` (généré)

- [ ] **Step 1 : Lire la sortie de perf**

Run : `cd easypap-se && ./run -k life -v seq -s 512 -a random -i 200 -n 2>&1 | tail -5`
Repérer la ligne qui donne le temps et le nombre d'itérations. Adapter le `grep`/`sed` du script ci-dessous au format réel, et consigner ce format dans le ledger.

- [ ] **Step 2 : Script**

`bench/run-native.sh` (calibrage : doubler les itérations jusqu'à ≥ 1 s, puis médiane de 3 runs) :

```bash
#!/usr/bin/env bash
# Measures the 2020 easypap life kernels natively and writes bench/native.json
# (format: NativeReport in web/src/bench/report.ts).
set -euo pipefail
cd "$(dirname "$0")/../easypap-se"

run_once() { # variant size pattern iters -> "iterations_done milliseconds"
  local extra=()
  [ "$1" = omp_tiled ] && extra=(-ts 32)
  ./run -k life -v "$1" -s "$2" -a "$3" -i "$4" -n "${extra[@]}" 2>&1 | python3 "$OLDPWD/bench/parse-perf.py"
}

results=()
for variant in seq omp_tiled ocl; do
  for size in 512 1024 2048 4096; do
    for pattern in random guns otca_off; do
      [ "$pattern" = otca_off ] && [ "$size" -lt 2176 ] && continue
      iters=16
      while :; do
        out=$(run_once "$variant" "$size" "$pattern" "$iters") || { echo "skip $variant $size $pattern" >&2; continue 2; }
        ms=${out#* }
        [ "${ms%.*}" -ge 1000 ] || [ "$iters" -ge 1048576 ] && break
        iters=$((iters * 2))
      done
      rates=()
      for _ in 1 2 3; do
        out=$(run_once "$variant" "$size" "$pattern" "$iters") || { echo "skip $variant $size $pattern" >&2; continue 2; }
        done_iters=${out% *}; ms=${out#* }
        rates+=("$(python3 -c "print($done_iters * 1000 / $ms)")")
      done
      median=$(printf '%s\n' "${rates[@]}" | sort -g | sed -n 2p)
      results+=("{\"variant\":\"$variant\",\"presetId\":\"${pattern/_/-}\",\"size\":$size,\"gensPerSec\":$median}")
      echo "$variant $size $pattern: $median gens/s" >&2
    done
  done
done

machine="$(sysctl -n machdep.cpu.brand_string) · $(sysctl -n hw.ncpu) cores"
printf '{\n  "machine": "%s",\n  "date": "%s",\n  "results": [\n    %s\n  ]\n}\n' \
  "$machine" "$(date +%F)" "$(IFS=,; echo "${results[*]}" | sed 's/},{/},\n    {/g')" > "$OLDPWD/bench/native.json"
echo "wrote bench/native.json" >&2
```

`bench/parse-perf.py` (à adapter au format relevé au Step 1) : lit la sortie d'easypap sur stdin et affiche `"<itérations effectuées> <millisecondes>"`. Il sort en erreur (code 1) si le temps ou les itérations manquent.

> `presetId` utilise les ids web : `otca_off` devient `otca-off`, `random` et `guns` sont identiques. Les noms de motifs easypap (`-a random`, `-a guns`, `-a otca_off`) correspondent aux `life_draw_*` d'origine.

- [ ] **Step 3 : Lancer**

Run : `bash bench/run-native.sh` (plusieurs minutes, en arrière-plan)
Attendu : `bench/native.json` existe et contient au moins les cas `seq` et `omp_tiled`.

- [ ] **Step 4 : Vérifier dans le benchmark web**

Ouvrir l'onglet Benchmark et lancer un run en 512² et 1024². Attendu : barres hachurées « C 2020 native — … » à côté des moteurs web, sans erreur console.

- [ ] **Step 5 : Commit**

```bash
git add bench/run-native.sh bench/parse-perf.py bench/native.json
git commit -m "bench: measure the native 2020 easypap kernels"
```

---

### Task 3 : README « 2020 → 2026 »

**Files :**
- Modify : `README.md` (ajout d'une section après « Démo web (2026) », rien de supprimé)

- [ ] **Step 1 : Rédiger**

Section `## 2020 → 2026` en français, contenant :
1. L'idée : même code C, compilé pour le navigateur, techno par techno (tableau 2020 → navigateur, issu de la spec).
2. Les chiffres : tableau gens/s en 1024² random et guns pour les 5 moteurs web (benchmark, pas le compteur live), plus le natif `seq` et `omp_tiled` depuis `bench/native.json`. Préciser la machine.
3. Ce que le portage a appris, avec des faits vérifiés :
   - le lazy tiling de 2020 avait des indices de tuile transposés (`updateNextIter` contre `toCoord`), corrigé dans le portage et détecté par des vaisseaux hors diagonale ;
   - le kernel OpenCL faisait évoluer les cellules du bord, alors que le séquentiel les figeait ;
   - le tuilage par mémoire partagée WebGPU est plus lent que le naïf sur Apple GPU ;
   - `wasm-mt` plafonne sur les petites grilles (barrières et atomiques), ce que le Gantt du monitoring montre.
4. Les limites : pas d'EasyView natif (fxt absent de Homebrew), monitoring navigateur par thread et non par cœur, WebGPU requis.
5. Comment lancer : `cd web && npm install && npm run dev`, `npm test`, `npm run e2e`, `bash bench/run-native.sh`.

- [ ] **Step 2 : Commit**

```bash
git add README.md
git commit -m "docs: tell the 2020 → 2026 story in the README"
```
