# Vidéo motion design « Descente dans le silicium » — design

Date : 2026-10-19 · Statut : à valider par Laurent

## Intention

Une vidéo de motion design d'environ 75 s pour la fiche du projet dans le portfolio (`~/perso/portfolio`). Le spectateur doit en sortir avec une seule idée : **ce code est ultra-optimisé**, preuve à l'appui avec des courbes de perf GPU vs CPU sur **toutes** les versions.

Elle complète la démo actuelle (`docs/media/gameoflife-demo.webm`, capture d'écran brute de l'app) : celle-ci montre l'outil, la nouvelle vidéo raconte le projet.

## Décisions de Laurent

- **DA C « Silicium néon »** : nuit profonde, cellules en points lumineux avec bloom, dégradé froid (CPU) → chaud (GPU), écrans en verre flottants, profondeur de champ. Styleframes de référence : `.superpowers/brainstorm/*/content/directions-artistiques.html` (frames `c1`, `c2`).
- **Concept 2 « Descente dans le silicium »** : un voyage 2020 → 2026, du C natif au GPU. Chaque moteur ajoute une couche à la musique : plus le code va vite, plus le morceau est dense. Référence : `.superpowers/brainstorm/*/content/concepts-da-c.html`.
- **Une seule vidéo** (pas 3 versions).
- **Animations, musique et SFX**, plus un **rendu de l'app réelle** avec l'affichage de charge des threads (Gantt, overlay tile → thread), comme dans la démo actuelle.
- **L'idée des 5 écrans** (un écran central « pop » qui montre l'évolution, 4 écrans autour avec 4 autres scénarios) est **une scène parmi d'autres**, pas toute la vidéo.
- **Exhaustif** : les 7 moteurs et plus de graines que Random + Guns.
- **Textes à l'écran en anglais**, un seul export pour les versions fr et en du portfolio.

## Objectifs

1. Montrer les 7 moteurs : C natif séquentiel (`omp` à 1 thread), C natif `omp_tiled` (15 threads), `wasm-seq`, `wasm-simd`, `wasm-mt`, `webgpu-naive`, `webgpu-tiled`.
2. Montrer au moins 5 graines qui évoluent (Random 50 %, Gosper guns, LWSS tagalongs, Clown, Diehard) plus l'OTCA metapixel en ouverture.
3. Chiffres réels uniquement, lus depuis `bench/web.json` et `bench/native.json` (régénérés, voir « Données »).
4. Raconter les retournements, qui sont le cœur du projet : sur un motif creux, `wasm-simd` sur 1 thread bat le GPU (26 900 vs 19 000 gen/s à 1024²) ; `webgpu-tiled` est plus lent que `webgpu-naive` ; `wasm-mt` plafonne (barrières).
5. Une musique et des SFX synchronisés à l'image près sur les événements visuels.

## Non-objectifs

- Pas de voix off.
- Pas de version française, pas de déclinaisons 3 DA / 3 versions.
- Pas de modification de l'app `web/` elle-même (sauf ajout de presets au bench si nécessaire, voir « Données »).

## Anti-objectifs (échec même si « ça marche »)

- Un chiffre inventé, arrondi de façon trompeuse ou non traçable vers un JSON de bench.
- Cacher les cas où le GPU perd : la vidéo deviendrait une pub, pas une preuve.
- Une esthétique « template After Effects » générique : la DA C doit venir des vraies cellules simulées, pas de particules décoratives sans lien avec Life.
- Du texte illisible sur la carte du portfolio (petite taille) : peu de texte, gros chiffres.

## Le film (timing indicatif, calé ensuite sur la grille musicale)

| # | Temps | Scène | Image | Son |
|---|---|---|---|---|
| 1 | 0–6 s | **Life in Life** | Gros plan sur une cellule ; dézoom continu : c'est un pixel d'un métapixel OTCA, lui-même cellule d'un Life plus grand (preset `meta3x3`). Titre : *Optimized Game of Life*. | Drone, son de révélation au dézoom |
| 2 | 6–14 s | **2020 · native C** | easypap, C séquentiel : une seule « lane » lumineuse qui balaie la grille ligne par ligne, lentement. Compteur : 188 gen/s (Random 1024²). Puis OpenMP natif 15 threads : 633 gen/s. | Un kick lent, seul ; un 2ᵉ élément rythmique pour OpenMP |
| 3 | 14–22 s | **WASM + SIMD** | Compilation vers WASM (glitch de transition). `wasm-seq` 548 gen/s, puis `wasm-simd` : 16 cellules calculées par instruction, montrées comme une rangée de 16 points qui s'allument ensemble. 5 359 gen/s. | + hi-hats, glitch de compilation, « laser ×16 » |
| 4 | 22–34 s | **Threads** | **L'app réelle**, capturée puis incrustée dans un écran en verre incliné en 3D : moteur `wasm-mt`, monitoring activé, overlay tile → thread, Gantt des 15 threads, barres d'activité (10–30 %). On montre le plafonnement : 3 644 gen/s, moins que `wasm-simd`. | + basse ; chaque thread qui s'allume dans le Gantt = une note |
| 5 | 34–44 s | **GPU** | Vue aérienne de milliers de workgroups qui s'allument. `webgpu-naive` 22 198 gen/s, puis `webgpu-tiled` 16 563 gen/s (« shared memory tiling: slower on Apple GPUs »). | + lead, montée puis **drop** sur 22 198 |
| 6 | 44–54 s | **5 screens** | Écran central « pop » (Random) et 4 satellites en profondeur de champ (Guns, LWSS, Clown, Diehard), chacun étiqueté avec son moteur et son gen/s réel. | Morceau complet ; chaque satellite entre sur un temps (whoosh de verre) |
| 7 | 54–68 s | **The curves** | (a) Course des générations sur 1 s, éventail de lumière, ×N vs C séquentiel (styleframe `c2`). (b) Scaling 512² → 2048². (c) Bascule Random → Guns : `wasm-simd` dépasse le GPU, texte « lazy tiling ». | Breakdown sur (c) (tout coupe sauf le kick), puis dernier refrain |
| 8 | 68–75 s | **End** | Titre, crédits (Laurent Genty, Clément Bertin, Emeric Duchemin · easypap by Raymond Namyst), URL de la démo live. | Les couches s'éteignent une à une, tick final |

Scènes-clés (à soigner en priorité) : 4, 5, 6, 7.

## Direction artistique C (rappel)

- Palette : nuit `#05040f` → `#1a1240` (dégradé radial), cyan CPU `#4cc9f0` → violet `#b14cff` → magenta `#ff3d81` → orange GPU `#ff9e3d`.
- La couleur suit la vitesse : un moteur lent est froid, un moteur rapide est chaud. Le même code couleur sert dans toutes les scènes et dans les courbes.
- Typo : Space Grotesk (gros poids pour les ×N et les gen/s, léger pour les légendes).
- Cellules : points ronds en addition de lumière (`lighter`) avec un bloom ; satellites floutés et assombris pour la profondeur.
- Mouvement : travellings caméra lents, mises au point, bloom qui pulse au rythme des générations, éventail de lignes qui s'ouvre.

## Son

- Morceau électronique qui passe de l'ambient à la techno. **Une couche (stem) par palier de moteur** : kick (C natif) → hi-hats (SIMD) → basse (threads) → lead (GPU). Le morceau est complet seulement quand tous les moteurs ont été montrés.
- SFX : tick de génération, whoosh de verre, glitch de compilation, impact sur les chiffres-clés, révélation OTCA.
- **Mon choix :** musique et SFX synthétisés en code (Web Audio, rendu hors ligne avec `OfflineAudioContext` vers un WAV), donc libres de droits et calés exactement sur les événements des scènes. Tempo 120 BPM (1 mesure = 2 s) ; les timings ci-dessus sont arrondis à la mesure.
- La vidéo doit rester compréhensible **sans le son** : le portfolio la lit en `muted` par défaut (`Stage.tsx`, `SideProjectDrawer.tsx` ; le tiroir a des `controls`, donc on peut activer le son).

## Données

- Les courbes et compteurs lisent `bench/web.json` et `bench/native.json`, jamais des valeurs recopiées à la main.
- **À compléter :** le bench web ne couvre aujourd'hui que `random` et `guns` (512, 1024, 2048). Mesurer `bugs`, `clown` et `diehard` à 1024² sur la même machine (M5 Pro), en **ajoutant** ces lignes à `bench/web.json` sans relancer Random et Guns : les chiffres cités ici et dans le README restent valides (mon choix). Ajouter ces presets à `web/e2e-bench` est autorisé.
- **Scène 6, mon choix :** chaque écran affiche **deux** chiffres pour sa graine à 1024² : `wasm-simd` (1 thread, lazy tiling) et `webgpu-naive`. Même paire partout, donc pas de moteur choisi au cas par cas. Cette paire montre aussi pourquoi le CPU gagne sur les motifs creux. Diehard meurt à la génération 130 : son écran redémarre en boucle.
- **C natif, mon choix :** il n'apparaît que sur Random et Guns (scènes 2 et 7), les seules graines mesurées par `native.json`. Pas de nouveau run natif.
- La machine et la taille de grille de chaque chiffre apparaissent quelque part à l'écran (petit texte), par honnêteté.

## Fabrication (mes choix)

- Nouveau dossier `motion/` dans ce repo (Vite + TypeScript, comme `web/`), qui réutilise `web/src/patterns` (RLE, presets) et la simulation. Il ne touche pas `web/`.
- Rendu **déterministe image par image** : une page expose `renderFrame(i)` ; Playwright parcourt les frames et les capture ; ffmpeg les assemble et mixe le WAV. Pas de capture temps réel, pour éviter les saccades.
- Les simulations lourdes (OTCA, 2048²) sont précalculées une fois et mises en cache.
- La scène 4 utilise une **vraie capture** de l'app (Playwright, même approche que `web/e2e-video/demo.spec.ts`), incrustée comme texture dans l'écran en verre.

## Livrables

- Master 1920×1200 (16:10, comme les autres vidéos du portfolio), 60 i/s, avec son.
- Export portfolio : `.webm` (VP9 + Opus), avec son, 1440×900 à 30 i/s, **≤ 20 Mo** (mon choix : à 12 Mo, le bloom se dégraderait en blocs ; les vidéos du tiroir sont en `preload="none"`, donc le poids ne coûte qu'au clic).
- Boucle muette ~10 s pour la carte (`.webm` 1024×640, ~3 Mo) + poster `.webp`.
- Copie dans `docs/media/` de ce repo pour le README.

## Intégration au portfolio (décision de Laurent : option 1)

- La **boucle muette de 10 s** remplace `gameoflife.webm` comme `videos[0]` de l'entrée `gameoflife` (carte + tiroir), avec un nouveau poster. Elle garde la durée courte qui convient à l'auto-avance du carrousel (`SideProjects.tsx`).
- Le **film complet** est ajouté dans `recordings.desktop` de la même entrée, **à côté** de l'actuelle démo filmée, qui y est déplacée (deux clips : film puis démo).
- Fichiers dans `public/projects/videos/` et `public/projects/posters/` du portfolio. Travail sur la branche partagée `feat/new-projects` (`git pull --rebase`, `npx vitest run`, `npm run build` avant le commit, pas de push sans l'accord de Laurent).
- Pas de modification des composants du portfolio : les `<video>` de `recordings` ont déjà des `controls`, ce qui permet d'activer le son.

## Laissé au constructeur

- Le moteur de rendu des scènes (Canvas 2D ou WebGL), tant que le rendu correspond aux styleframes C.
- Le design sonore précis (synthèse, mixage), dans le cadre « une couche par moteur ».
- Les transitions entre scènes.
- L'ordre de construction des scènes.
