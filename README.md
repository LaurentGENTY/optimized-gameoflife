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
| `seq` | `wasm-seq` : le noyau séquentiel C compilé en WASM (scalaire, cellules d'un octet), moteur de référence |
| AVX | `wasm-simd` : C tuilé + lazy tiling + SIMD (intrinsics SSE2 → WASM SIMD128, 16 cellules par instruction), 1 thread |
| OpenMP | `wasm-mt` : même noyau sur un pool de pthreads (Web Workers) |
| OpenCL | `webgpu-naive` / `webgpu-tiled` : le kernel OpenCL réécrit en WGSL (naïf, et tuilé en mémoire partagée de workgroup) |

Chaque moteur est vérifié contre `wasm-seq` (même hash de grille après N générations) avant d'être mesuré, et la page `?selftest` vérifie tous les moteurs.

### Les chiffres (générations par seconde, plus c'est haut mieux c'est)

Mesurés le 2026-10-07 sur un MacBook Apple M5 Pro (15 cœurs).

- **Navigateur** : benchmark intégré lancé dans Chrome headless (`npm run bench:headless`, fichier `bench/web.json`). 50 générations de chauffe, runs calibrés pour durer environ 1 s, médiane de 3.
- **Natif** : `bench/run-native.sh` (fichier `bench/native.json`), sans chauffe, médiane de 3 runs d'au moins 1 s. Sur Apple Silicon, les intrinsics AVX de 2020 passent par [SIMDe](https://github.com/simd-everywhere/simde) (traduction AVX → NEON) : ce n'est pas de l'AVX natif.

**Grille 1024², aléatoire 50 %**

| Moteur | gens/s |
|---|---:|
| C 2020 natif, séquentiel (`omp` sur 1 thread) | 188 |
| C 2020 natif, OpenMP tuilé + lazy (`omp_tiled`, 15 threads) | 633 |
| `wasm-seq` | 548 |
| `wasm-simd` (1 thread) | 5 359 |
| `wasm-mt` (15 threads) | 3 644 |
| `webgpu-naive` | 22 198 |
| `webgpu-tiled` | 16 563 |

**Grille 1024², 4 canons de Gosper (motif clairsemé)**

| Moteur | gens/s |
|---|---:|
| C 2020 natif, séquentiel (`omp` sur 1 thread) | 301 |
| C 2020 natif, OpenMP tuilé + lazy (`omp_tiled`, 15 threads) | 2 050 |
| `wasm-seq` | 506 |
| `wasm-simd` (1 thread) | 26 900 |
| `wasm-mt` (15 threads) | 5 434 |
| `webgpu-naive` | 19 000 |
| `webgpu-tiled` | 14 700 |

### Ce que le portage a appris

- **Le C séquentiel compilé en WASM bat le C séquentiel natif de 2020 (548 contre 188 gens/s).** Ce ne sont pas les mêmes noyaux : `wasm-seq` est une boucle scalaire sur des cellules d'un octet, alors que la variante native passe par la fonction « AVX » de 2020 (9 valeurs diffusées dans un registre de 256 bits, une seule case relue, cellules de 4 octets), elle-même traduite en NEON par SIMDe sur ce Mac.
- **Le lazy tiling de 2020 avait les indices de tuile transposés** : `updateNextIter` marque la tuile (ligne, colonne) mais les voisins sont lus en (colonne, ligne). Chaque tuile regardait le voisinage de sa tuile miroir. Sur les 4 canons, disposés symétriquement, le bug est masqué (même grille finale que le calcul complet) ; il fausse le résultat sur le métapixel OTCA. Le portage corrige l'indexation, et des tests de vaisseaux hors diagonale l'auraient détecté.
- **Deux variantes séquentielles de 2020 ne mesurent pas ce qu'elles prétendent** : `seq` s'arrête toujours après une itération (`compute_new_state` renvoie un drapeau local jamais mis à jour) et `tiled` saute la dernière rangée et la dernière colonne de tuiles. La référence séquentielle native est donc `omp` limité à 1 thread.
- **Le kernel OpenCL de 2020 faisait évoluer les cellules du bord**, alors que le séquentiel les figeait. Il n'a pas pu être mesuré : sa lecture du résultat échoue (code inachevé, tableau hôte jamais alloué).
- **Sur motif clairsemé, 1 thread bat le GPU** grâce au lazy tiling (`wasm-simd` : 214 k gens/s sur les canons en 512², contre 70 k pour WebGPU).
- **Le tuilage en mémoire partagée WebGPU est plus lent que la version naïve** sur GPU Apple, probablement parce que les caches du GPU font déjà ce travail.
- **`wasm-mt` plafonne** : deux barrières et un compteur atomique par tuile à chaque génération, pour peu de travail. Le Gantt du mode Monitoring le montre (10 à 30 % d'activité par thread en 1024²). Il ne dépasse `wasm-simd` qu'en 2048² sur grille aléatoire, jamais sur les canons.

### Limites

- Le monitoring du navigateur montre des **threads**, pas des cœurs : les navigateurs ne disent pas sur quel cœur tourne un worker. La vraie vue par CPU reste celle d'easypap (`-m`, voir ci-dessous).
- Pas d'EasyView natif sur macOS : la bibliothèque de traces `fxt` n'existe pas dans Homebrew.
- Les chiffres varient selon les conditions de mesure (Chrome headless, onglet visible ; un onglet caché est bridé, le benchmark s'annule alors tout seul).

### Lancer

Depuis `web/` :

```bash
npm install && npm run dev      # http://localhost:5173 (WebGPU requis)
npm test                        # tests unitaires (Node)
npm run e2e                     # selftest de tous les moteurs dans Chrome
npm run bench:headless          # benchmark → bench/web.json
```

easypap natif (macOS, Apple Silicon : `brew install pkgconf hwloc sdl2_image sdl2_ttf libomp simde`), depuis la racine du dépôt :

```bash
make -C easypap-se
(cd easypap-se && ./run -k life -v omp_tiled -s 1024 -a random -ts 32 -m)   # GUI avec l'activité par CPU
bash bench/run-native.sh                                                     # → bench/native.json
```
