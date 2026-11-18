# DriftSignal Discovery Engine — Amendement A01 à la RFC v1.0

**Statut :** proposition consolidée après revues stratégique et technique — **à valider avant implémentation**  
**Date :** 18 novembre 2026  
**Document parent :** [Discovery Engine RFC v1.0](discovery-engine-spec-v1.0.md)  
**Portée :** précision des contrats de preuve, résultats partiels, classement en deux temps et protocole comparatif B0/B1. Cet amendement **complète** la RFC et prévaut sur ses formulations incompatibles ; il ne réécrit pas sa vision.

## 1. Synthèse des décisions

**Décisions proposées :**
1. Le rapprochement Jira–Confluence est automatique, sans association ni alias métier obligatoires. Les liens explicites existants constituent des **indices forts, facultatifs**.
2. Deux classements indépendants : **pré-lecture** (quelles pages méritent le budget de lecture ?) et **post-lecture** (quelles pages sont effectivement pertinentes ?).
3. Une relation « étayée » exige une **preuve côté ticket et côté document**, leurs références de version ou empreintes et leurs localisations. Les **conditions d'application** appartiennent aux passages, pas à une étiquette globale sur la page.
4. Le **résultat métier** et **l'état d'exécution** sont orthogonaux : trouver un runbook utile n'empêche pas qu'un scan soit partiel.
5. Les résultats sont **filtrés côté backend à la portée de l'utilisateur** ; les documents interdits n'apparaissent ni dans les extraits ni dans les titres, classements ou compteurs exposés.
6. L'expérience prioritaire est **B0 vs B1 sur des recherches réelles du tenant Confluence de démonstration**, avec corpus annoté à l'avance et rapport des pertes à chaque étape.
7. Les modes B2/B3/B4 sont définis à l'avance, mais ne sont **pas** des dépendances de la première livraison ; aucun index vectoriel obligatoire.
8. M2 justifie **pourquoi le document concerne le changement**. M3 décide **si une instruction est affectée**, avec prise en compte du rollback, de la coexistence et du calendrier.

**Observations revues (source : consultant technique, reproductibles selon sa revue) :**
- Dans le M1 actuel, le mock de test searchPages renvoie les fixtures indépendamment du terme recherché ; les 20 tests ne mesurent pas le rappel de recherche réel.
- Une route V1 dans une section « rollback uniquement » peut produire SOURCE_CONFLICT ; la structure de la section est nécessaire avant interprétation M3.
- Dans l'orchestrateur M1, une exception sur une page stoppe toute la réponse ; une stratégie de résultat partiel est requise.

Ces observations précisent **ce que M1 valide** sans invalider l'intégration Atlassian réalisée.

---

## 2. Pipeline en deux classements et traçage des pertes

### 2.1 Étapes séparées

~~~text
Jira issue
  -> Change Profile / indices
  -> Query Planner (B0 ou B1)
  -> Search hits (pages retrouvées)
  -> Déduplication
  -> Pre-read ranking + budget de lecture diversifié
  -> Fetch/parse des pages retenues
  -> Post-read relevance assessment + preuves
  -> Discovery result + Execution/Coverage status
  -> Vue d'investigation et export de benchmark
  -> M3 qualification (distincte)
~~~

**Pré-lecture :** classer les hits sur les seules métadonnées et signaux disponibles (lien explicite, titre, stratégie, snippets si disponibles) sans prétendre connaître les instructions. Budget partagé entre *familles d'indices distinctes* plutôt que consommé par une famille répétée (« payment » sous cinq variantes). Prévoir un reliquat pour les meilleurs hits globaux. Le quota et la méthode d'allocation sont configuration d'expérience, pas règle métier imposée.

**Post-lecture :** examiner les sections, extraire leurs rôles (procédure active, rollback, architecture, historique, dépendance), vérifier identité/service, environnement, version et passage, puis classer **la pertinence du document** indépendamment de tout écart d'endpoint.

### 2.2 Traçage diagnostique par page attendue

Pour chaque document du *gold set* (annotation d'évaluation exclusivement, jamais fournie au moteur) :

| Étape | Champ de diagnostic | Question |
|---|---|---|
| Search | inSearchHits | La requête a-t-elle retrouvé la page ? |
| Pre-read | selectedForFetch | Était-elle dans le budget de lecture ? |
| Fetch | fetchedSuccessfully | La lecture a-t-elle abouti avec les droits courants ? |
| Relevance | assessedRelevant | Après lecture, la relation a-t-elle été correctement reconnue ? |
| M3 (spike) | qualifiedCorrectly | La bonne instruction a-t-elle été interprétée dans son contexte ? |

En cas de perte : **retrieval miss**, **budget/ranking miss**, **fetch/access miss**, **relevance miss** ou **qualification miss**. Une même erreur peut avoir plusieurs causes ; enregistrer les étapes sans prétendre à une causalité automatique.

**Limite de confidentialité :** les champs issus des labels de benchmark peuvent apparaître dans un **rapport de développeur hors UI utilisateur** seulement. Le panneau Jira ne révèle jamais les pages interdites, même pour expliquer la couverture.

---

## 3. Contrats de données — précisions sur la RFC

### 3.1 Preuves bilatérales et conditions au niveau du passage

Une relation étayée doit référencer au minimum :
- une observation ancrée **dans le ticket Jira** ;
- une observation ancrée **dans le document Confluence** ;
- leur articulation explicite (p. ex. même endpoint historique spécifique + même domaine ou service, ou référence explicite existante) ;
- pour chaque observation : objet, version (ou empreinte de contenu lorsque la plateforme ne fournit pas de version adéquate), champ/section/bloc, extrait minimal.

Un lien explicite existant mérite un rang prioritaire, mais **ne suffit pas à affirmer qu'une instruction opérationnelle est affectée**. Si la preuve document n'a pas encore été lue, classer « candidat prioritaire » plutôt que « relation étayée ».

Proposition de complément de contrat, conceptuel et non implémenté :

~~~typescript
type Applicability = "normal_operation" | "rollback_only" | "historical"
  | "planned" | "coexistence" | "unknown";

interface SourceAnchor {
  product: "jira" | "confluence";
  tenantId: string;
  objectId: string;
  versionOrFingerprint: string;
  field?: string;
  sectionPath?: string[];
  blockIdOrRange?: string;
  quote: string;
}

interface RelationEvidencePair {
  jira: SourceAnchor;
  confluence: SourceAnchor;
  relationType: "same_service" | "same_endpoint" | "explicit_reference"
    | "shared_component" | "inferred_relation";
  explanation: string;
}

interface DocumentRelation {
  documentId: string;
  relationStatus: "SUPPORTED_RELATION" | "PLAUSIBLE_RELATION"
    | "WEAK_CANDIDATE" | "UNRELATED" | "INSUFFICIENT_EVIDENCE";
  documentRole: "operational_runbook" | "architecture"
    | "reference" | "change_log" | "unknown";
  evidencePairs: RelationEvidencePair[];
}

interface PassageContext {
  source: SourceAnchor;
  applicability: Applicability;
  environment: "production" | "staging" | "development"
    | "test" | "unknown";
  temporalScope?: { from?: string; until?: string };
  notes?: string[];
}
~~~

Un document **peut être pertinent sans contenir de passage à corriger**. Exemple : un runbook décrit V2 en exploitation normale et V1 pour le rollback. M2 transmet les **deux passages et leurs conditions** à M3 ; M2 ne déclare pas SOURCE_CONFLICT comme un verdict opérationnel.

**Principe de preuve :** si une source ne fournit pas une localisation stable, indiquer explicitement un ancrage approximatif plutôt que prétendre à une citation exacte. Une empreinte permet de constater un changement, mais ne remplace pas un identifiant versionné officiel lorsqu'il existe.

### 3.2 Résultat métier ≠ statut d'exécution

Proposition de découplage :

~~~typescript
interface DiscoveryOutcome {
  relationDecision: "CANDIDATES_FOUND" | "NO_CANDIDATE_FOUND"
    | "INSUFFICIENT_INPUT";
  candidates: DocumentRelation[];
}

interface ScanExecution {
  status: "COMPLETE_WITHIN_BUDGET" | "PARTIAL" | "FAILED";
  queryPlanId: string;
  completedQueries: number;
  failedQueries: number;
  fetchedPages: number;
  truncated: boolean;
  timeoutReached: boolean;
  visibleErrors: Array<{ stage: string; code: string }>;
  limitations: string[];
}
~~~

**Exemples corrects :**
- CANDIDATES_FOUND **et** PARTIAL : une bonne page lue, seconde page en échec.
- NO_CANDIDATE_FOUND **et** COMPLETE_WITHIN_BUDGET : aucune page utile dans le périmètre effectivement exploré, **pas** « aucune documentation n'existe ».
- INSUFFICIENT_INPUT **et** COMPLETE_WITHIN_BUDGET : le moteur s'abstient car les indices Jira sont insuffisants.

Le backend construit une projection du rapport **strictement autorisée pour le demandeur**, y compris les agrégats. Éviter d'afficher « 1 page inaccessible » si cela révèle l'existence d'une page que l'utilisateur ne devrait pas connaître ; préférer une limite technique non identifiable, lorsque nécessaire.

### 3.3 Résilience des lectures

- Une erreur sur une page doit être capturée **au niveau de cette page** si les autres lectures sont indépendantes.
- Préserver les résultats déjà autorisés et correctement récupérés.
- Distinguer explicitement absence de résultats, accès refusé, timeout, indexation en retard, pagination stoppée et budget dépassé lorsque cette distinction peut être exposée sans fuite.
- La panne Jira initiale peut rendre l'investigation impossible ; la panne d'une page ne doit pas effacer les autres.
- Aucune promotion d'un résultat partiel au statut « vérification exhaustive ».

### 3.4 Vie privée : frontière du résultat

En mode api.asUser(), vérifier les permissions réelles sur **deux profils**. Ne pas supposer que le futur index hérite automatiquement de ces droits : filtrage et revalidation avant restitution. Les logs, fichiers d'évaluation partagés et captures ne doivent pas contenir de secrets ou de corps de pages privés.

---

## 4. Définition stable des variantes B0 à B4

Les comparaisons doivent être reproductibles. Pour chaque run, archiver : code commit, configuration, stratégie, entrées, identifiant utilisateur de test anonymisé, nombre de requêtes, budget de lecture, limites, pages effectivement obtenues et timings. Répéter les mesures pour éviter qu'une fluctuation d'indexation/faible trafic soit prise pour un gain.

| Variante | Entrées et recherches | Sélection pour lecture | Post-lecture / modèles |
|---|---|---|---|
| **B0 — M1 baseline** | Même ticket ; extraction service M1 ; **une recherche CQL réellement exécutée** sur le token M1 | Déduplication + premiers 15 hits, dans les limites de M1 | Comparateur M1 ; noter séparément les documents pertinents qui ont été retrouvés, même si M1 ne les marque pas « liés » |
| **B1 — Multi-signal lexical** | Même ticket, liens existants + service/composant/host + **ancien endpoint** + nouvel endpoint ; recherches CQL réelles planifiées et tracées | Fusion dédupliquée, budget de lecture explicitement fixé, diversité entre familles d'indices | Évaluation de pertinence déterministe simple ; mêmes preuves et conditions de couverture |
| **B2 — Relevance ranking** | **Même pool de hits que B1**, idéalement rejoué depuis un snapshot versionné et autorisé | Pré-lecture améliorée + diversification ; enregistrer la perte par étape | Parsing sections + contexte + ranking déterministe contextualisé |
| **B3 — Semantic reranking** | **Exactement les candidats de B2** | Même budget de lecture | Modèle sur passages récupérés ; peut améliorer le rang mais **pas retrouver un document absent des hits** |
| **B4 — Hybrid retrieval** | B2/B3 + index lexical/semantic **du corpus autorisé**, avec évaluation distincte de l'apport des embeddings | Fusion, diversification et budget explicites | Même qualification post-lecture ; exige revue sécurité / synchronisation / permissions |

**Équité :** l'expérience initiale peut comparer deux configurations à **budget égal de lectures** et montrer, séparément, le gain sous budget total de requêtes différent. Ne pas masquer qu'une variante gagne grâce à plus d'appels API. Le résultat B0 doit provenir du vrai endpoint de recherche Confluence, non du mock qui retourne des pages indépendamment du CQL.

**B0 et B1 ne mesurent pas la même chose si le classement après lecture change également** : publier les résultats *retrieved*, *selected for fetch* et *read* séparément, puis signaler les différences de classement post-lecture.

---

## 5. Protocole prioritaire : diagnostic B0/B1

### 5.1 Corpus pilote

**Taille indicative de diagnostic :** six tickets, environ quinze pages Confluence et **deux utilisateurs de test** (un accès large, un restreint). Ce corpus permet de choisir une direction technique, **pas** de déclarer M2 validé.

Créer les annotations avant l'exécution :
- pages attendues par ticket (une ou plusieurs) ;
- nature de la relation (directe, indirecte, trompeuse, insuffisante) ;
- preuves pertinentes et contexte du passage ;
- pages hors périmètre pour le profil restreint ;
- scénario où il n'existe **aucune preuve exploitable**.

**Familles à inclure obligatoirement :**
1. **Directe :** ancien endpoint/host/path historique dans un runbook au titre différent et sans lien Jira ;
2. **Indirecte :** ticket → page de service → procédure liée, nécessitant au moins un saut autorisé ;
3. **Lexicalement difficile :** vocabulaire différent sans token commun — cas témoin pour révéler la limite B1 ;
4. **Distracteurs :** deux services avec /health ; un document d'architecture ; simple dépendance ;
5. **Contexte :** V1 citée seulement dans une section rollback, V2 en exploitation normale ;
6. **Qualité d'entrée :** ticket incomplet devant produire une abstention motivée.

Le nombre de tickets étant limité, regrouper plusieurs situations dans un même ticket est acceptable **si les annotations restent explicites**. Éviter de sélectionner uniquement des scénarios qu'une recherche exacte d'endpoint gagnerait facilement.

**Zéro configuration métier :** gold labels conservés **hors des données accessibles au moteur** ; aucun ID de page attendue injecté, aucun alias spécifique codé en dur et aucune modification artificielle des titres ou des tickets pour aider B1.

### 5.2 Mesures par étage

| Indicateur | Lecture |
|---|---|
| Candidate recall@budget | Proportion des pages pertinentes accessibles apparaissant dans les hits de recherche |
| Read recall@budget | Proportion effectivement lue après pré-classement / budget |
| Relevant recall@K | Pages correctement reconnues parmi les K premières propositions |
| First useful rank / MRR | Rang du premier runbook utile, adapté aux tickets à peu de pages positives |
| Time to first useful finding | Temps entre ouverture du scan et première preuve exploitable |
| False supported relations | Propositions « étayées » incorrectes |
| Abstention correctness | Cas sans preuve où le moteur n'invente pas de relation |
| Coverage / partial-result honesty | Couverture et erreurs correctement exposées |
| Permission non-disclosure | Aucune fuite de titres, extraits, totaux ou rangs de documents restreints |
| Latence / coûts | p50/p95 lorsque l'échantillon le permet, appels API, pages, tokens et coûts IA éventuels |

La Precision@5 reste disponible à titre descriptif mais ne doit **pas** être le seul critère de validation. Avec un seul runbook pertinent, même un classement parfait ne peut dépasser 1/5 en Precision@5.

### 5.3 Critère provisoire de poursuite B1

L'expérience constitue un **signal positif** si B1 :
- récupère des runbooks manqués par B0 dans **au moins deux familles distinctes** ;
- traite /health seul comme signal insuffisant ;
- ne révèle aucune nouvelle information sur la page restreinte au profil sans permission ;
- affiche la provenance de chaque relation et la couverture réelle du scan ;
- mesure latence et coût supplémentaires, sans les éluder.

**Ne pas présenter ce seuil comme une validation statistique du produit.** La validation M2 nécessitera un corpus plus large et **des familles inédites**, avec arbitrage entre rappel, précision, latence et coût. La validation utilisateur exigera une revue réelle par un ingénieur.

### 5.4 Livrable exploitable

**Rapport comparatif** (Markdown/JSON/CSV, au choix de l'implémentation) avec une ligne par **ticket × utilisateur × page attendue × variante**, plus une synthèse par ticket et variante. Colonnes obligatoires :

~~~text
case_id, persona, variant, expected_page_id, accessible_to_persona,
search_hit, selected_for_fetch, fetch_succeeded, relevant_after_read,
relation_reason, missed_stage, execution_status, coverage_limitations,
query_count, api_call_count, elapsed_ms
~~~

Les **identifiants gold** et le flag accessible_to_persona sont réservés au rapport de développement sur données de démo ; ne pas exposer ces colonnes ni leurs comptes privés aux utilisateurs. Le rapport contient aussi une liste de faux candidats proposés, les indices qui les ont fait remonter et les raisons de leur rejet.

**Dans le panneau Jira existant :** intégrer une vue légère exposant ce que l'utilisateur a le droit de voir : « indice de recherche → document trouvé → passage justifiant la pertinence », plus limites et durée du scan. Une page trompeuse écartée peut être affichée à des fins de démo si elle est autorisée et présentée clairement comme *non retenue*, pas comme alerte.

---

## 6. Première expérimentation M2 → M3 en parallèle

Sans construire tout M3, préparer un test contrôlé :

- Jira : migration déclarée de V1 vers V2 en production.
- Runbook : instruction V2 dans « Procédure normale », instruction V1 dans « Rollback uniquement ».
- **M2 :** page pertinente, deux passages ancrés, avec conditions distinctes.
- **M3 minimal / test de contrat :** ne pas déclarer l'ancienne route en rollback comme une instruction normale obsolète ; si l'activation du rollback ou la date d'effet manque, demander une revue au lieu d'inventer.

Ce test est un **test de contrat et d'interprétation**, pas une promesse de détection exhaustive d'écarts.

---

## 7. Contraintes Forge et expériences API à isoler

Les valeurs et permissions ci-dessous sont des références à **revalider pendant l'implémentation** sur la version courante de Forge et sur l'installation réelle.

- Vérifier la syntaxe et l'indexation CQL pour les routes contenant slash, tirets et segments versionnés, ainsi que la pagination et les droits de recherche.
- Les liens Jira existants peuvent être interrogés sous réserve de configuration du produit et d'autorisation ; tester si les scopes M1 suffisent avant toute extension du manifest.
- Garder un parcours interactif **borné** ; si une investigation dépasse les limites d'invocation Forge, évaluer Async Events, état durable, idempotence et permissions d'exécution.
- Isoler toute expérimentation Teamwork Graph, Rovo Search ou Forge LLM derrière un adapter, sans la rendre critique pour l'expérience B0/B1 ou la démo Codegeist.

Références officielles pour revue :
- [Confluence Search REST](https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-search/)
- [Jira remote issue links REST](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-remote-links/)
- [Forge invocation limits](https://developer.atlassian.com/platform/forge/limits-invocation/)
- [Forge Async Events](https://developer.atlassian.com/platform/forge/runtime-reference/async-events-api/)

---

## 8. Ordre de travail proposé (modifié)

| Ordre | Action | Gate |
|---|---|---|
| 0 | Valider amendement et labels du corpus pilote | Gold set indépendant du moteur ; critères B0/B1 figés |
| 1 | Ajouter un harness de diagnostic **réel** avec CQL B0 et logs de recherche autorisés | Montrer qu'un hit dépend effectivement de la requête |
| 2 | Change Profiler minimal (old/new, host, composant, contexte) + planner B1 | Requêtes distinctes et provenance conservée |
| 3 | Pré-classement diversifié + budget + rapport des pertes | Mesurer search → selected → fetched |
| 4 | Preuve bilatérale, passages contextualisés, résultats partiels | M2 ne confond plus rollback et procédure active |
| 5 | Vue d'investigation dans le panneau Jira + rapport comparatif | Présentation compréhensible « pourquoi ce document ? » |
| 6 | Décider B2 / exploration des liens / B3 / B4 à partir des pertes observées | Investissement argumenté par les métriques |

**Garde-fous :** conserver M1 opérationnel, valider chaque petit incrément par tests et vérification Forge, ne pas modifier arbitrairement les scopes ou créer un index de contenus privés. Le script npm actuel ne lance que \`test/*.test.mjs\` : si les nouveaux tests vont dans \`test/discovery/\`, modifier le script ou exécuter explicitement ces suites, sinon elles seront invisibles à \`npm test\`.

---

## 9. Décisions restant ouvertes

1. Quel quota initial de recherche et de pages lire, et quelle politique précise de diversification entre familles ?
2. Comment réconcilier budget égal et nombre de requêtes différent entre B0 et B1 ?
3. Quel format exact pour les anchors quand Confluence Storage HTML ne fournit pas de positions stables ?
4. Quels scénarios peuvent être créés sur le tenant de démo sans fausser la qualité du benchmark ?
5. Comment obtenir et tester un second profil suffisamment restreint sans publication de métadonnées privées ?
6. Quand passer à une exploration de graphe de liens, puis éventuellement un index sémantique ?
7. Quels critères de revue humaine doivent remplacer des seuils statistiques fragiles sur six tickets ?

**Décision immédiate proposée :** lancer **l'expérience B0/B1 réelle**, pas l'indexation vectorielle. Le livrable doit montrer les pages attendues, retrouvées, sélectionnées, lues et retenues, les preuves et les raisons des pertes, ainsi que les limites de scan — sans révéler à un utilisateur les données qu'il ne peut pas consulter.
