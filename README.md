Ce projet a été réalisé dans le cadre du projet de fin d'année de 2ème année de la matière "Programmation Multicoeur et GPU" à l'ENSEIRB Matmeca.

Ce projet a été réalisé par les élèves : GENTY Laurent, BERTIN Clément et DUCHEMIN Emeric.

Ce projet se base sur l'outil easypap développé par l'enseignant Raymond Namyst de l'ENSEIRB Matmeca : https://gforgeron.gitlab.io/easypap/ .

Veuillez lire le rapport présent à la racine afin d'en apprendre plus sur le projet et comment l'utiliser.

Code réalisé dans : ```optimized-gameoflife/easypap-se/kernel/c/life.c``` et ```optimized-gameoflife/easypap-se/kernel/ocl/life.cl```

## Démo web (2026)

Le noyau C de 2020 compilé en WebAssembly, avec rendu WebGPU : https://laurentgenty.github.io/optimized-gameoflife/

Nécessite un navigateur avec WebGPU (Chrome/Edge récents, Safari 26+). Code dans `web/`.

## 2020 → 2026

En 2020, ce Jeu de la vie était optimisé en C sur easypap : séquentiel, AVX, OpenMP, OpenCL, avec du *lazy tiling* (on ne recalcule que les tuiles dont un voisin a changé). En 2026, le même code C est **compilé pour le navigateur** (Emscripten), techno par techno, et comparé à la version native.

| 2020 (natif) | 2026 (navigateur) |
|---|---|
| `seq` | `wasm-seq` : le noyau séquentiel C compilé en WASM, moteur de référence |
| AVX | `wasm-simd` : C tuilé + lazy tiling + SIMD (intrinsics SSE2 → WASM SIMD128), 1 thread |
| OpenMP | `wasm-mt` : même noyau sur un pool de pthreads (Web Workers) |
| OpenCL | `webgpu-naive` / `webgpu-tiled` : le kernel OpenCL réécrit en WGSL (naïf, et tuilé en mémoire partagée de workgroup) |

Chaque moteur est vérifié contre `wasm-seq` (même hash de grille après N générations) avant d'être mesuré, et la page `?selftest` vérifie tous les moteurs.

### Les chiffres (générations par seconde, plus c'est haut mieux c'est)

Mesurés le 2026-10-07 sur un MacBook Apple M5 Pro (15 cœurs) : la colonne navigateur vient du benchmark intégré lancé dans Chrome headless (`npm run bench:headless`, fichier `bench/web.json`), la colonne native de `bench/run-native.sh` (`bench/native.json`). Warm-up de 50 générations, runs d'au moins 1 s, médiane de 3.

**Grille 1024², aléatoire 50 %**

| Moteur | gens/s |
|---|---:|
| C 2020 natif, séquentiel (`tiled`) | 338 |
| C 2020 natif, OpenMP (`omp_tiled`) | 589 |
| `wasm-seq` | 548 |
| `wasm-simd` (1 thread) | 5 359 |
| `wasm-mt` (15 threads) | 3 644 |
| `webgpu-naive` | 22 198 |
| `webgpu-tiled` | 16 563 |

**Grille 1024², 4 canons de Gosper (motif clairsemé)**

| Moteur | gens/s |
|---|---:|
| C 2020 natif, séquentiel (`tiled`) | 503 |
| `wasm-seq` | 506 |
| `wasm-simd` (1 thread) | 26 900 |
| `wasm-mt` (15 threads) | 5 434 |
| `webgpu-naive` | 19 000 |
| `webgpu-tiled` | 14 700 |

(Le natif `omp_tiled` n'est pas reporté sur les motifs clairsemés : voir plus bas, son lazy tiling saute des tuiles qu'il devrait calculer.)

### Ce que le portage a appris

- **Le C séquentiel compilé en WASM bat le C natif de 2020.** Le noyau « AVX » de 2020 additionne 9 cellules diffusées dans un registre de 256 bits puis n'en lit qu'une case, sur des cellules de 4 octets ; la version 2026 vectorise vraiment (16 cellules d'un octet par instruction).
- **Le lazy tiling de 2020 avait les indices de tuile transposés** : `updateNextIter` marque la tuile (ligne, colonne) mais les voisins sont lus en (colonne, ligne). Chaque tuile regardait le voisinage de sa tuile miroir. Le portage corrige l'indexation, et des tests de vaisseaux hors diagonale l'auraient détecté. Conséquence côté natif : `omp_tiled` paraît très rapide sur les canons (1 430 gens/s en 4096², contre 21 en séquentiel) parce qu'il calcule trop peu.
- **La variante `seq` de 2020 s'arrête toujours après une itération** : `compute_new_state` renvoie un drapeau local jamais mis à jour. La référence séquentielle native est donc la variante `tiled`.
- **Le kernel OpenCL de 2020 faisait évoluer les cellules du bord**, alors que le séquentiel les figeait, et sa lecture du résultat échoue sur macOS (`CL_INVALID_VALUE`, code inachevé) : pas de mesure OpenCL native.
- **Sur motif clairsemé, 1 thread bat le GPU** grâce au lazy tiling (`wasm-simd` : 214 k gens/s sur les canons en 512², contre 70 k pour WebGPU).
- **Le tuilage en mémoire partagée WebGPU est plus lent que la version naïve** sur GPU Apple : les caches font déjà le travail.
- **`wasm-mt` plafonne sur les petites grilles** : deux barrières et un compteur atomique par tuile à chaque génération, pour peu de travail. Le Gantt du mode Monitoring le montre (10 à 30 % d'activité par thread en 1024²) ; il ne dépasse `wasm-simd` qu'à partir de 2048².

### Limites

- Le monitoring du navigateur montre des **threads**, pas des cœurs : les navigateurs ne disent pas sur quel cœur tourne un worker. La vraie vue par CPU reste celle d'easypap (`-m`, voir ci-dessous).
- Pas d'EasyView natif sur macOS : la bibliothèque de traces `fxt` n'existe pas dans Homebrew.
- Les chiffres varient selon les conditions de mesure (Chrome headless, onglet visible ; un onglet caché est bridé, le benchmark s'annule alors tout seul).

### Lancer

```bash
cd web && npm install && npm run dev      # http://localhost:5173 (WebGPU requis)
npm test                                  # tests unitaires (Node)
npm run e2e                               # selftest de tous les moteurs dans Chrome
npm run bench:headless                    # benchmark → bench/web.json
```

easypap natif (macOS, Apple Silicon : `brew install pkgconf hwloc sdl2_image sdl2_ttf libomp simde`) :

```bash
make -C easypap-se
cd easypap-se && ./run -k life -v omp_tiled -s 1024 -a guns -ts 32 -m   # GUI avec l'activité par CPU
bash bench/run-native.sh                                                  # → bench/native.json
```
