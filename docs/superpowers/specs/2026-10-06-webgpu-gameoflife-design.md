# Game of Life 2020 → 2026 : portage navigateur et évolution des performances

Date : 2026-10-06
Statut : design approuvé (brainstorming), spec en revue — rév. 2 : moteurs CPU = C d'origine compilé, ajout des captures

## 1. Objectif

Vitrine de l'**évolution des performances** : porter le projet ENSEIRB-MATMECA 2020
(Jeu de la vie optimisé en C sur `easypap`) dans le navigateur, techno par techno, et
comparer les résultats entre eux et avec le natif 2020.

- Code web sous `web/` dans ce repo. `easypap-se/` reste intact (seule exception :
  correctifs de build macOS pour la mesure native).
- Déployé sur GitHub Pages via une GitHub Action.
- **Contrainte forte** : le rendu et le monitoring ne doivent pas biaiser les
  performances mesurées.
- **Règle directrice** : la techno d'origine reste le cœur du projet. Le navigateur
  n'est qu'une vitrine obtenue en **compilant le code C d'origine** (Emscripten), jamais
  en réécrivant les moteurs CPU en TypeScript. TypeScript est limité à l'UI et à la
  glue (workers, renderer, benchmark, monitoring).

### Critères de succès

1. Démo en ligne sur GitHub Pages avec les 5 moteurs fonctionnels (Chrome avec WebGPU).
2. Un benchmark reproductible qui produit un graphique gens/s par taille et par moteur,
   avec les barres « C natif 2020 » à côté.
3. Chaque moteur prouvé correct (hash identique au moteur de référence `wasm-seq`).
4. Un monitoring live inspiré d'EasyView (Gantt par thread, grille colorée par thread).
5. Des GIF/vidéos courts de la démo (mode live, graphique benchmark, Gantt monitoring)
   intégrés au README et réutilisables sur le portfolio (`~/perso/portfolio`).

### Hors périmètre

- Dessin de cellules à la souris.
- Fallback sans WebGPU (message « navigateur non supporté » à la place).
- Grille torique (bords morts, comme l'original).

## 2. Moteurs (échelle complète, 5 moteurs)

| Original 2020 | Équivalent navigateur | Id |
|---|---|---|
| seq | WASM séquentiel, sans SIMD, mono-thread (aussi moteur de **référence**) | `wasm-seq` |
| AVX | WASM SIMD, mono-thread | `wasm-simd` |
| OpenMP | WASM pthreads (Web Workers) + SIMD | `wasm-mt` |
| OpenCL | WebGPU compute naïf | `webgpu-naive` |
| OpenCL | WebGPU compute tuilé (mémoire partagée de workgroup) | `webgpu-tiled` |

- Les moteurs CPU sont **tous** du C compilé avec Emscripten, repris de
  `easypap-se/kernel/c/life.c` (adapté au minimum pour sortir des macros easypap) :
  `wasm-seq` = noyau séquentiel d'origine ; `wasm-simd` / `wasm-mt` = tuiles + lazy
  tiling (on ne recalcule que les tuiles dont un voisin a changé à l'itération
  précédente) + SIMD (+ pthreads).
- Pas de moteur JS : le moteur de référence (hash de correction, baseline séquentielle)
  est `wasm-seq`.
- Les moteurs WebGPU sont écrits en WGSL : c'est le successeur navigateur d'OpenCL et
  le sujet même du portage.
- Les threads WASM exigent COOP/COEP → `coi-serviceworker` sur GitHub Pages.

## 3. Architecture (approche A : TypeScript + Vite, sans framework)

```
web/
  src/engine.ts      # interface Engine commune
  src/engines/       # glue TS : wasm-seq, wasm-simd, wasm-mt, webgpu-naive, webgpu-tiled
  src/render/        # renderer WebGPU unique (fragment shader lit le buffer de cellules), zoom/pan
  src/patterns/      # parseur RLE + fichiers .rle copiés depuis easypap-se/data/rle
  src/bench/         # runner + graphique (uPlot)
  src/monitor/       # Gantt façon EasyView + tuiles colorées par thread
  wasm/life.c        # noyau porté
  wasm/Makefile      # emcc → 4 builds : seq, simd, mt, mt-instrumented
bench/native.json    # résultats easypap natifs mesurés sur le Mac de Laurent
```

### 3.1 Interface `Engine`

```ts
interface Engine {
  init(size: number, cells: Uint8Array): Promise<void>; // grille carrée size×size, 1 = vivante
  step(n: number): Promise<void>;                        // avance de n générations
  frame(): FrameSource;                                  // données pour le renderer (voir 3.2)
  hash(): Promise<string>;                               // hash de la grille (garde de correction)
  trace?: TraceReader;                                   // seulement pour wasm-mt instrumenté
  dispose(): void;
}
```

### 3.2 Représentation des données

- **Moteurs CPU** (`wasm-seq`, `wasm-simd`, `wasm-mt`) : 1 octet/cellule, exécutés dans des
  workers (le thread principal n'exécute jamais le calcul). `frame()` fournit une copie
  CPU, uploadée vers le GPU par le renderer.
- **Moteurs WebGPU** : u32/cellule, le buffer reste sur le GPU ; `frame()` expose le
  `GPUBuffer` directement → zéro copie vers le renderer.

### 3.3 Mode live : calcul découplé de l'affichage

- Le calcul tourne en continu ; l'affichage se fait au plus au rythme de
  `requestAnimationFrame`.
- Pour les moteurs CPU, l'upload vers le GPU n'a lieu qu'au rythme d'affichage, jamais à
  chaque génération.

### 3.4 Bords et limites

- Bords morts (non toriques), comme l'original.
- Pas de WebGPU → message clair « navigateur non supporté », pas de fallback.
- Pas de cross-origin isolation (`crossOriginIsolated === false`) → `wasm-mt` grisé avec
  explication.
- Tailles au-delà des limites de l'adaptateur (`maxStorageBufferBindingSize`,
  `maxBufferSize`) → grisées.

## 4. Benchmark (aucun rendu pendant la mesure)

- **Familles de motifs** : aléatoire densité 50 % (dense) et motifs clairsemés
  (guns, OTCA) où le lazy tiling brille.
- **Tailles** : 512, 1024, 2048, 4096 ; 8192 optionnel, GPU uniquement.
- **Protocole** : 50 générations de warm-up, puis nombre de générations ajusté pour
  durer ≥ 1 s, médiane de 3 runs.
- **Métriques** : générations/s et Gcellules/s. GPU : temps mur + temps kernel pur via
  timestamp queries quand l'adaptateur les supporte (`timestamp-query`).
- **Garde de correction** : chaque moteur est comparé au moteur de référence `wasm-seq` par hash
  de grille après N générations ; un moteur divergent est marqué invalide et exclu du
  graphique.
- **Sortie** : graphique log gens/s par taille et par moteur, barres « C natif 2020 » à
  côté (depuis `bench/native.json`) ; infos machine (cœurs via
  `navigator.hardwareConcurrency`, adaptateur GPU) ; export JSON.

## 5. Monitoring (mode live uniquement, désactivé pendant le benchmark)

- Le build `wasm-mt` instrumenté enregistre `(thread, tuile, début, fin, itération)` dans
  un ring buffer `SharedArrayBuffer` préalloué, sans allocation dans la boucle chaude.
- Le build propre est utilisé pour le benchmark → zéro surcoût quand le monitoring est
  coupé. Activer le monitoring bascule le moteur `wasm-mt` sur le build instrumenté.
- **Vues** :
  - Gantt par thread (façon EasyView) ;
  - grille colorée par thread + mode « heat » par durée ;
  - % d'activité par thread.
  - Les tuiles sautées par le lazy tiling apparaissent vides.
- **WebGPU** : timeline du temps kernel par itération. Pas d'info par thread sur GPU —
  à indiquer dans l'UI.
- **Limite navigateur à afficher explicitement** : impossible de savoir sur quel cœur
  physique tourne un worker ; on affiche la vue par thread + `navigator.hardwareConcurrency`
  seulement.

## 6. Référence native (easypap sur macOS)

- Builder l'easypap original sur le Mac (brew : `sdl2`, `sdl2_image`, `sdl2_ttf`,
  `libomp` ; framework OpenCL de macOS).
- Lancer les mêmes tailles et motifs pour les variantes `seq`, `omp_tiled`, `ocl` →
  `bench/native.json`. `-m` et EasyView redeviennent utilisables.
- **Time-box** : une soirée. Si OpenCL ne compile pas sur macOS, abandonner cette
  variante (le graphique n'affiche alors pas de barre native OpenCL).

## 7. UI

Page unique : grille plein écran + panneau latéral.

- **Onglet Live** : moteur, taille, motif, play/pause/step, compteur gens/s, zoom molette
  + pan au drag.
- **Onglet Benchmark** : bouton Run, progression, graphique, export JSON.
- **Toggle Monitoring** : Gantt, grille par thread, activité par thread.

## 8. Tests

- **Vitest** :
  - parseur RLE ;
  - moteur de référence `wasm-seq` (chargé dans Node) sur motifs connus : bloc (still
    life), blinker (période 2), glider (décalé d'une cellule en diagonale en
    4 générations) ;
  - conformité des autres moteurs WASM vs `wasm-seq` par hash, dans Node.
- **Playwright** (Chrome avec WebGPU) : page `?selftest` qui vérifie les 5 moteurs contre
  la référence dans le navigateur.

## 9. Jalons (chacun livre quelque chose de visible)

| # | Jalon | Estimation |
|---|---|---|
| 1 | Base : Vite, toolchain emcc, `wasm-seq` (C d'origine compilé), renderer WebGPU, RLE, zoom/pan, déploiement Pages → démo en ligne | ~1 jour |
| 2 | WebGPU naïf + tuilé | ~½ jour |
| 3 | `life.c` tuilé + lazy tiling → WASM SIMD avec emcc | ~½ jour |
| 4 | WASM multithread + coi-serviceworker | ~½ jour |
| 5 | Mode benchmark + graphique + garde de correction | ~1 jour |
| 6 | Monitoring : build instrumenté, Gantt, overlays | ~1 jour |
| 7 | easypap natif sur macOS, `native.json`, README « 2020 → 2026 » | ~1 soirée |
| 8 | Captures GIF/vidéo (live, graphique benchmark, Gantt monitoring) → README + portfolio | ~1 h |

Le build WASM tourne en CI (GitHub Action avec emsdk) : les `.wasm` ne sont pas
commités.
