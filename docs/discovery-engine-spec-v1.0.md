# DriftSignal — Discovery Engine
## Spécification technique v1.0 — RFC pour revue stratégique et technique

**Statut :** DRAFT / à challenger — aucune décision ouverte ci-dessous n'est considérée comme validée.
**Date :** 18 novembre 2026
**Produit :** DriftSignal, application Atlassian Forge Jira + Confluence
**Référence de départ :** Milestone 1, commit 204cd5f, branche main
**Périmètre :** M2 — découverte documentaire, pertinence, contexte, preuves et évaluation. La qualification des écarts relève de M3.

> **Thèse de conception.** DriftSignal doit découvrir, sans mapping métier préalable, les documents opérationnels potentiellement affectés par un changement Jira. Il doit justifier les rapprochements, préserver le contexte, déclarer ses limites et pouvoir s'abstenir. Une source documentaire divergente n'est pas une preuve de l'état réel de production.

---

## 1. Vision, problème et promesse

### 1.1 Problème métier

Un changement technique est décrit dans Jira, tandis que les procédures réellement utilisées par les équipes sont réparties dans Confluence. Les noms, niveaux de détail, propriétaires, environnements et vocabulaires diffèrent. Il n'existe pas nécessairement de relation explicite entre le ticket et le runbook. Les ingénieurs doivent chercher manuellement quels documents sont concernés, interpréter leur pertinence puis vérifier les instructions.

La découverte automatique n'est donc pas un simple prétraitement de la détection d'écarts : elle constitue une proposition de valeur indépendante et un facteur de différenciation potentiel.

### 1.2 Promesse utilisateur

**« À partir des informations et des relations déjà disponibles dans Jira et Confluence, DriftSignal retrouve les documents pertinents sans association manuelle préalable, explique pourquoi ils sont proposés et signale lorsque les preuves sont insuffisantes. »**

Le « zero setup » signifie **zéro configuration métier obligatoire** (pas de mapping manuel, catalogue imposé ou enregistrement préalable de runbooks). Il ne signifie ni absence d'installation Forge ni contournement des permissions ni capacité à retrouver un document dépourvu de tout indice exploitable.

### 1.3 Résultat attendu

Le moteur doit produire, pour chaque ticket :

1. un profil du changement et ses indices sourcés ;
2. un ensemble de documents candidats retrouvés par plusieurs stratégies ;
3. un classement explicable et une distinction entre runbook et contexte documentaire ;
4. des références précises aux preuves et versions des sources ;
5. une synthèse de couverture, erreurs, limites et ambiguïtés ;
6. un paquet de contexte prêt pour la qualification M3, **sans préjuger de l'existence d'un drift**.

### 1.4 Non-objectifs de M2

- Prouver l'état réel de production (CMDB, runtime, observabilité ou déploiement).
- Déclarer un incident opérationnel sur la seule base d'un désaccord Jira/Confluence.
- Modifier automatiquement des pages Confluence ou des tickets Jira.
- Fournir une découverte sémantique universelle sans corpus indexé.
- Implémenter le workflow complet de correction et revalidation (M4).
- Apprendre une règle générale de correspondance à partir d'un simple rejet utilisateur.
- Faire de l'IA générative un prérequis de la découverte initiale.

---

## 2. Principes architecturaux non négociables

| Principe | Conséquence technique |
|---|---|
| Sans association manuelle obligatoire | Les liens explicites existants sont exploités comme signaux forts, jamais comme condition d'entrée |
| Recall et precision distincts | Mesurer séparément **retrieval**, **ranking** et qualité des rapprochements |
| Pas de document inventé | Un modèle ne peut classer que des candidats effectivement récupérés et autorisés |
| Relation ≠ écart | Le statut de pertinence documentaire est indépendant du statut de qualification M3 |
| Le contexte compte | Service, environnement, période, rôle, dépendance, rollback, coexistence ne sont pas aplatis en simple score |
| Chaque preuve est traçable | ID, version, emplacement, extrait minimal et méthode d'extraction |
| Les indices faibles restent faibles | Une répétition du même nom dans plusieurs champs ne devient pas plusieurs preuves indépendantes |
| Échec explicite | Erreurs partielles, pagination interrompue, absence d'accès et budget épuisé sont visibles |
| Respect des permissions | Aucun document inaccessible à l'utilisateur ne doit être révélé, même via index ou cache |
| Coût maîtrisé | Recherche bornée, déduplication précoce, caches gouvernés, étape IA facultative |
| Tests avant sophistication | Toute nouvelle stratégie se compare à une baseline sur corpus étiqueté |

---

## 3. Périmètre réel de l'implémentation M1

Le code GitHub existant fournit un socle vérifié :

- **src/index.js :** resolver Forge, lecture Jira (summary, description, status), recherche Confluence CQL, lecture de pages, appels api.asUser().
- **src/core.mjs :** conversion ADF/HTML en texte ; extraction structurée Service/Endpoint ; comparaison déterministe ; extraction d'un seul token.
- **src/scan.mjs :** orchestration du scan, recherche sur un unique token, déduplication et lecture de 15 candidats maximum.
- **static/app/src/App.jsx :** panneau Jira, scan manuel, synthèse et preuves.
- **test/** : tests unitaires et d'intégration simulée ; 20 tests validés au bilan M1.

**Limites structurantes :** extraction trop dépendante des lignes explicites, ancien endpoint non modélisé comme signal distinct, recherche lexicale unique, peu de métadonnées documentaires, pas de corpus benchmark ni mesure de rappel, pertinence et comparaison encore fortement couplées.

**Contrainte de compatibilité :** garder le scan M1 disponible pendant le développement, avec tests de non-régression. Ne pas réinterpréter le résultat historique SOURCE_CONFLICT comme une preuve de production.

---

## 4. Architecture logique cible

~~~mermaid
flowchart TD
    A[Jira issue + user context] --> B[Change Profiler]
    B --> C[Signal Registry]
    C --> D[Query Planner]
    D --> E1[Explicit refs and links]
    D --> E2[Confluence CQL lexical retrieval]
    D --> E3[Semantic retrieval adapter - optional]
    E1 --> F[Candidate Fusion]
    E2 --> F
    E3 --> F
    F --> G[Document Fetch + Structured Parsing]
    G --> H[Evidence and Context Extraction]
    H --> I[Relevance Ranking + Abstention]
    I --> J[Discovery Report + Coverage]
    J --> K[Investigation UI]
    J --> L[M3 Drift Qualification]
~~~

### 4.1 Séparation des composants

**Change Profiler.** Transforme le ticket en signaux typés, contextualisés et sourcés ; distingue faits explicites et hypothèses extraites.

**Query Planner.** Détermine des recherches complémentaires, sûres et bornées, en conservant la provenance de chaque requête.

**Retrieval Adapters.** Fournissent une interface homogène aux liens existants, à CQL et, plus tard, à un éventuel index sémantique. Un adapter est optionnel : son indisponibilité n'empêche pas forcément le scan.

**Candidate Fusion.** Déduplique par identité de page, regroupe les hits et conserve toutes les stratégies ayant retrouvé un candidat.

**Document Parser.** Convertit le format source en sections structurées (titre, heading, paragraphe, tableau, macro, liste, code) et extrait les références techniques. Le texte plat est un fallback, pas le contrat final.

**Relevance Engine.** Évalue la relation entre changement et document : signaux concordants, rôle du document, contexte, contradictions et ambiguïtés ; produit des justifications lisibles.

**Coverage Engine.** Enregistre limites d'exploration, pages non lues, réponses API, troncatures, droits et erreurs.

**M3 Adapter.** Transmet des passages et assertions avec sources et contexte, mais n'affirme pas qu'un runbook est erroné.

---

## 5. Contrats de données — version 1

Les interfaces ci-dessous sont des **contrats conceptuels TypeScript**, pas des modules déjà implémentés. Elles seront traduites en types validés à l'exécution (p. ex. JSON Schema/Zod ou validateurs dédiés), sérialisables et versionnés. Tous les identifiants de tenant et d'objets sont opaques.

### 5.1 Types communs et provenance

~~~typescript
type SourceProduct = "jira" | "confluence";
type Environment = "production" | "staging" | "development" | "test" | "unknown";
type ExtractionMethod = "explicit" | "parser" | "inference";

interface SourceRef {
  product: SourceProduct;
  tenantId: string;
  objectId: string;          // issue key/id or Confluence page ID
  version?: string;          // Confluence version, Jira updated timestamp, etc.
  field?: string;            // description, summary, body, table cell...
  sectionPath?: string[];    // hierarchical headings, when available
  locator?: { kind: "line" | "range" | "block"; value: string };
  quote?: string;            // minimal excerpt; never fabricate
  url?: string;              // validated Atlassian URL, when available
}

interface DiscoverySignal {
  id: string;
  family:
    | "service_identity"
    | "endpoint"
    | "domain"
    | "component"
    | "explicit_link"
    | "issue_reference"
    | "environment"
    | "deployment_state"
    | "technical_identifier"
    | "document_role"
    | "semantic_topic";
  role?: "old" | "new" | "current" | "target" | "dependency" | "unknown";
  rawValue: string;
  normalizedValue: string;
  extraction: ExtractionMethod;
  source: SourceRef;
  ambiguity?: string;
}
~~~

**Règles :** un signal ne se transforme pas silencieusement en fait vérifié ; une inférence n'est pas une preuve indépendante ; les chaînes sont normalisées sans perdre les valeurs originales (casse, slash, hôte, variables de chemin, version d'API).

### 5.2 ChangeProfile

~~~typescript
interface ChangeProfile {
  schemaVersion: "1.0";
  issue: SourceRef;
  summary: string;
  signals: DiscoverySignal[];
  context: {
    environment: Environment;
    deploymentState: "planned" | "in_progress" | "deployed" | "rolled_back" | "unknown";
    temporalScope?: { effectiveFrom?: string; effectiveTo?: string };
    uncertainties: string[];
  };
  dataQuality: {
    level: "sufficient" | "partial" | "insufficient";
    missingFamilies: string[];
    explanation: string;
  };
}
~~~

Exemple : un ticket disant « Service: payment-gateway ; Old endpoint: /api/v1/payments ; New endpoint: /api/v2/payments ; Deployment status: Deployed to production » doit produire **deux signaux endpoint distincts**, une référence de production et une déclaration de déploiement. La dernière n'est pas une vérification indépendante de production.

### 5.3 SearchPlan et SearchHit

~~~typescript
interface SearchQuery {
  id: string;
  strategy: "existing_link" | "cql_exact" | "cql_text" | "semantic";
  signalIds: string[];
  queryText?: string;          // never an untrusted raw CQL fragment
  priority: number;
  maxPages: number;
  rationale: string;
}

interface SearchHit {
  pageId: string;
  tenantId: string;
  strategy: SearchQuery["strategy"];
  queryId: string;
  pageTitle?: string;
  sourceRank?: number;
  sourceUrl?: string;
}
~~~

Les chaînes de recherche sont construites via un builder d'expressions contrôlées et un échappement adapté ; elles ne proviennent jamais directement d'une concaténation non validée de CQL fourni par l'utilisateur.

### 5.4 DocumentCandidate, CandidateAssessment, EvidenceReference

~~~typescript
type RelationStatus =
  | "SUPPORTED_RELATION"
  | "PLAUSIBLE_RELATION"
  | "WEAK_CANDIDATE"
  | "UNRELATED"
  | "INSUFFICIENT_EVIDENCE";

type DocumentRole =
  | "operational_runbook"
  | "architecture"
  | "reference"
  | "change_log"
  | "unknown";

interface EvidenceReference {
  id: string;
  source: SourceRef;
  signalIds: string[];
  observation: string;        // factual, short, grounded in quote
}

interface DocumentCandidate {
  page: SourceRef;
  title: string;
  searchHits: SearchHit[];    // preserve all discovery paths
  documentRole: DocumentRole;
  retrievedVersion?: string;
  fetchStatus: "fetched" | "not_accessible" | "failed" | "truncated";
  assessment?: {
    relationStatus: RelationStatus;
    rankScore?: number;       // sorting heuristic, NOT a probability
    evidence: EvidenceReference[];
    independentSignalFamilies: string[];
    contextCompatibility: "compatible" | "different" | "unknown";
    explanation: string;
    uncertainties: string[];
  };
}
~~~

**RelationStatus ne dit rien de l'existence d'un drift.** Un runbook peut avoir SUPPORTED_RELATION et être parfaitement cohérent, ou être pertinent mais concerner un autre environnement. Un document d'architecture peut être utile au contexte sans devoir être corrigé.

### 5.5 DiscoveryReport et couverture

~~~typescript
interface DiscoveryReport {
  schemaVersion: "1.0";
  issueKey: string;
  profile: ChangeProfile;
  candidates: DocumentCandidate[];
  coverage: {
    plannedQueries: number;
    executedQueries: number;
    failedQueries: number;
    returnedHits: number;
    uniqueCandidates: number;
    fetchedPages: number;
    excludedPages: number;
    truncated: boolean;
    paginationExhausted: boolean;
    unavailableSources: string[];
    errors: { stage: string; code: string; recoverable: boolean }[];
    completeness: "bounded" | "partial" | "unknown";
    limitations: string[];
  };
  decision: "CANDIDATES_FOUND" | "NO_CANDIDATE_FOUND" | "INSUFFICIENT_INPUT" | "PARTIAL_RESULT";
  modelUsage?: { provider: string; model: string; calls: number; tokens?: number; estimatedCost?: number };
  timingsMs: Record<string, number>;
}
~~~

**Attention :** NO_CANDIDATE_FOUND n'implique jamais « aucun runbook n'existe ». Même une recherche achevée sur ses requêtes prévues reste limitée par la stratégie, les permissions et l'indexation Atlassian.

---

## 6. Moteur de découverte : algorithme proposé

### 6.1 Étape A — Extraction des indices

Sources initiales : summary, description ADF, composants Jira lorsqu'ils existent, liens mentionnés, références de tickets, champs et statuts pertinents. Les liens distants Jira sont une source additionnelle possible, soumise à validation de scope et permission.

Familles d'indices :
- **Identité :** service, composant, équipe, application, aliases possibles.
- **Technique :** ancien et nouvel endpoint, hostname, domaine, port, route, paramètre de configuration, identifiant d'API.
- **Contexte :** environnement, statut du changement, date d'effet, ancienne/nouvelle version, rollback, coexistence.
- **Relations :** liens vers Confluence, issue references, dépendances explicitement déclarées.
- **Intention :** migration, dépréciation, remplacement, ajout, retrait, configuration, incident/recovery.

Conserver l'extrait exact, la provenance et l'incertitude. Les données ADF doivent préserver titres, listes et tableaux lorsque possible ; ne pas inférer à partir du seul résumé si des détails les contredisent.

### 6.2 Étape B — Query Planner multi-stratégies

Priorité indicative :
1. Pages Confluence déjà référencées explicitement depuis Jira (lien existant, sans intervention utilisateur).
2. Identifiants de service et références techniques distinctives.
3. **Ancien endpoint** et host/path historiques (critique pour une migration).
4. Nouvel endpoint, composants, domaines et références communes.
5. Variantes lexicales contrôlées et synonymes ciblés.
6. Recherche sémantique, **uniquement si un index disponible et autorisé existe**.

Limiter les requêtes explosives : une route /health, des mots comme API, server, payment ou production, isolés, ne justifient pas une exploration massive. Une requête faible peut compléter un faisceau d'autres indices, pas servir de preuve suffisante.

Le planner doit adapter le budget à la qualité des indices. Avec trop peu d'informations, produire INSUFFICIENT_INPUT et expliquer ce qui manque au lieu de lancer une recherche arbitraire sur tout Confluence.

Chaque plan contient une justification, le budget de requêtes, le budget de pages et l'ordre d'exécution. Paramètres proposés comme configuration interne versionnée, **pas comme réglages métier obligatoires**.

### 6.3 Étape C — Retrieval et déduplication

Chaque adapter renvoie des SearchHit avec queryId et stratégie. Les résultats sont fusionnés sur (tenantId, pageId). Conserver :
- toutes les requêtes ayant retrouvé la page ;
- le rang d'origine dans chacune ;
- les métadonnées utiles et l'état de récupération ;
- la raison du hit (ancien endpoint, lien Jira, nom du composant, etc.).

Respecter la pagination offerte par l'API utilisée, les limites de requêtes et les quotas. Ne jamais décrire comme exhaustif un résultat tronqué par un plafond arbitraire. Prévoir retries bornés sur erreurs temporaires avec backoff et traitement explicite de 401/403/404/429/5xx ; ne pas réessayer indéfiniment.

### 6.4 Étape D — Parsing documentaire structuré

Construire une représentation hiérarchique :
- page, espace, version, titre, ancêtres et URL ;
- sectionPath ;
- blocs de type heading / paragraph / list / table / code / macro / unknown ;
- texte normalisé, valeurs originales et localisation ;
- rôle documentaire hypothétique (procédure de reprise, runbook, architecture, référence).

Les endpoints présents dans des tableaux ou macros Confluence ne doivent pas disparaître lors de la conversion HTML. Une assertion doit pouvoir pointer vers un bloc précis, pas seulement vers une page entière.

Les documents qui présentent un service comme **dépendance** doivent être distingués des procédures qui exploitent directement le composant modifié.

### 6.5 Étape E — Candidate Ranking

Éviter de confondre répétition et corroboration. Exemple : même nom de service dans titre, paragraphe et label = généralement **une famille d'indice répétée**, non trois validations indépendantes.

Proposition de classement à expérimenter :
- **Candidate generation :** union des hits de chaque stratégie.
- **First-stage ranking :** fusion de rangs (ex. Reciprocal Rank Fusion) + signaux distinctifs.
- **Second-stage reranking :** vérification au niveau bloc/section, rôle du document, concordance d'identité et contexte.
- **Decision gates :** un candidat ne reçoit SUPPORTED_RELATION que si une relation est étayée par des preuves suffisantes ; une similarité textuelle isolée reste PLAUSIBLE ou WEAK.
- **Abstention :** absence de preuves, conflit non résolu, autre environnement, source non accessible.

Signaux potentiellement forts : lien Jira–Confluence existant, identifiant de service exact avec instruction opérationnelle, endpoint spécifique assorti d'un contexte compatible.

Signaux faibles : mots génériques, similitude de sujet sans ancrage technique, endpoint commun très générique.

**Le score numérique reste un outil de tri, pas une probabilité calibrée.** Les seuils seront déterminés par le benchmark, non inventés a priori. Documenter le poids des signaux et garder une version de l'algorithme pour comparer les résultats.

### 6.6 Étape F — Résultat

Le DiscoveryReport expose :
- documents suggérés et degré d'étayage de la relation ;
- nature du document : runbook à examiner ou contexte documentaire ;
- preuves indépendantes et extraits cliquables lorsque possible ;
- divergences de contexte et inconnues ;
- couverture, erreurs, limites et coûts.

M3 reçoit des candidats et des assertions sourcées. Il peut ensuite statuer sur **SUPPORTED_DRIFT, REVIEW_REQUIRED, INSUFFICIENT_EVIDENCE, DIFFERENT_CONTEXT ou NO_MISMATCH_IN_SCOPE**. Ces verdicts sont exclus du moteur M2.

---

## 7. Recherche sémantique : option d'architecture à concevoir maintenant

### 7.1 Pourquoi elle importe

Un reranker sémantique ne peut pas récupérer une page absente des résultats lexicaux. Pour la découverte réellement sémantique, il faut soit un moteur externe capable de rechercher un corpus, soit maintenir un index documentaire exploitable.

### 7.2 Modes de fonctionnement

| Mode | Description | Avantages | Limites |
|---|---|---|---|
| **On-demand** | CQL + liens + lecture/reranking des pages récupérées | Faible setup, coût initial faible, permissions de l'utilisateur appliquées par les API | Rappel limité aux documents retrouvés |
| **Indexed (optionnel)** | Collecte autorisée et index incrémental par sections, lexique et embeddings | Peut retrouver des formulations différentes sans token commun | Ingestion, synchronisation, coût, résidence des données, permission et révocation complexes |
| **Hybrid** | Union on-demand + index autorisé, fusion et vérification | Potentiel de rappel plus élevé | Davantage d'orchestration et d'évaluation |

**Décision proposée :** développer une interface SemanticRetriever dès M2, sans imposer son activation ; démarrer avec la recherche on-demand et un benchmark. Décider d'une indexation réelle à partir des lacunes de rappel mesurées et d'une revue sécurité.

### 7.3 Exigences avant activation d'un index

- Corpus et périmètre autorisés, sans « scan intégral implicite » des contenus privés.
- Cloisonnement strict par installation/tenant ; pas de mélange inter-tenant.
- Permissions d'accès préservées ; revalidation d'accès et de version **avant d'afficher une preuve**, y compris après un hit vectoriel.
- Gestion des suppressions, révocations d'accès, changements de permissions, mises à jour et désinstallation.
- Chunks ancrés sur sections, IDs et versions ; index recalculable ; source de vérité = Confluence.
- Politique explicite de stockage, rétention, chiffrement, logs, coûts et éventuel fournisseur de modèles.
- Consentement et analyse de conformité avant tout envoi de contenus confidentiels vers une API IA externe.
- Benchmark lexical vs hybrid démontrant un gain qui justifie le coût.

Le choix d'un modèle d'embeddings, d'une base vectorielle et d'une stratégie d'ingestion est **ouvert** ; ne pas figer le fournisseur avant le benchmark et l'étude des contraintes Forge.

---

## 8. Permissions, sécurité et gouvernance

**Hypothèse de base :** lecture avec api.asUser() pour les accès Jira/Confluence, conformément à l'implémentation actuelle. Les nouvelles APIs et scopes nécessaires doivent être évalués explicitement et testés sur le tenant de développement. Aucune modification du manifest n'est autorisée par cette RFC.

Points à traiter avant toute indexation :
1. **Autorisations :** absence de fuite par titre, extrait, score, nombre de résultats ou cache lorsqu'une page n'est pas accessible. Le fait qu'un document existe peut être sensible.
2. **Identité :** tenant, installation, utilisateur et document doivent être distingués ; un cache partagé ne doit pas élargir les droits du demandeur.
3. **Version :** associer preuve et page à la version effectivement lue ; signaler les résultats obsolètes.
4. **Entrées non fiables :** contenus Jira/Confluence, liens et textes sont des données, jamais des instructions à exécuter par un modèle ; défense contre prompt injection et sorties trompeuses.
5. **CQL et URLs :** escaping, allowlists de paramètres, validation stricte des URLs Atlassian et prévention d'accès hors domaine.
6. **Données personnelles :** minimisation des extraits, absence de documents complets dans les logs et dans les erreurs frontend.
7. **Fiabilité :** limites de débit, annulation, retries, timeout, budgets, traitements partiels et déduplication.
8. **IA externe :** désactivée par défaut jusqu'à une décision sécurité/produit explicite.

Les appels de fond via Forge Async Events sont une **option technique**, utile pour une exploration coûteuse ; elle ne règle pas à elle seule la propagation des autorisations utilisateur ni la gestion de l'état des investigations.

---

## 9. Évaluation : benchmark de découverte

### 9.1 Constitution du corpus

Créer un corpus de référence **indépendant de la démo CLSD-6**, initialement 40 à 60 scénarios annotés, puis l'étendre. Pour chaque scénario :
- ticket Jira et contexte ;
- ensemble de pages Confluence accessibles ;
- pages réellement pertinentes (multi-label possibles) ;
- niveau de relation attendu et preuves ;
- pages distractrices et cas d'abstention ;
- jugement séparé de la pertinence et du drift éventuel.

Les annotations doivent être revues manuellement et accompagnées d'une justification. Éviter que les fixtures du moteur soient des copies trop proches des règles implémentées.

### 9.2 Cas minimaux obligatoires

| ID | Scénario | Comportement attendu |
|---|---|---|
| D01 | Runbook au titre différent, ancien endpoint présent | Retrouver le runbook sans lien explicite |
| D02 | Deux services possédant /health | Ne pas attribuer un document sur l'endpoint générique seul |
| D03 | Architecture + procédure de reprise du même service | Distinguer document de contexte et instructions à examiner |
| D04 | Service cité uniquement comme dépendance | Ne pas conclure à une relation opérationnelle directe |
| D05 | Ticket sans service ni référence exploitable | Abstention justifiée |
| D06 | Plusieurs runbooks réellement pertinents | Ne pas s'arrêter au premier |
| D07 | Production vs staging | Conserver le conflit de contexte |
| D08 | Rollback / coexistence v1 et v2 | Ne pas surinterpréter une différence de valeur |
| D09 | Document non accessible / erreur API | Aucun contenu divulgué ; couverture partielle |
| D10 | Recherche paginée / limites atteintes | Indiquer la troncature et son impact |
| D11 | Page modifiée pendant le scan | Version et fraîcheur cohérentes ou signalées |
| D12 | Noms différents et aucun token commun | Mesurer échec lexical puis gain éventuel du mode indexé |
| D13 | Terme répété dans plusieurs champs | Pas de surpondération comme preuves indépendantes |
| D14 | Page longue avec instruction en tableau ou macro | Localiser l'instruction dans la bonne section |
| D15 | Ticket mentionnant old + new endpoint | Interroger notamment l'ancien endpoint |

### 9.3 Métriques distinctes

**Retrieval :**
- Recall@K sur les pages pertinentes récupérables, avant reranking.
- Search coverage : requêtes, pagination, pages vues/non vues, limites.
- No-hit rate : taux de scans sans candidats exploitables, segmenté par qualité des tickets.

**Ranking :**
- Recall@K après classement.
- Precision@K et MRR/nDCG, selon l'usage UI visé.
- False-supported-relation rate : rapprochements déclarés étayés mais incorrects.
- Relevance labeling agreement : accord avec les annotations humaines.

**Evidence :**
- Evidence support rate : proportion de justifications réellement supportées par l'extrait cité.
- Provenance completeness : présence ID/version/localisation pour les preuves.
- Context error rate : mauvaises associations prod/staging, dépendance/procédure, ancien/nouveau.

**Système :**
- latence p50/p95, API calls, taux de 429/5xx, consommation par scan ;
- coûts de modèles et d'index si activés ;
- performance par taille de corpus et qualité des tickets.

### 9.4 Baselines et expérimentation

Comparer dans le même corpus :
- B0 : moteur M1, un token + exact service ID ;
- B1 : multi-signaux + CQL ;
- B2 : fusion + reranking déterministe ;
- B3 : reranking sémantique sur **les mêmes candidats** (améliore le rang, pas le rappel de récupération) ;
- B4 : retrieval hybride avec index sémantique (si autorisé).

Utiliser les mêmes jeux de test, budgets et conditions de permissions. Séparer train/dev/test dès qu'il y a réglage de seuils ou sélection de modèles. Consigner chaque configuration, version de règles et modèle.

### 9.5 Seuils proposés pour discussion — NON VALIDÉS

Pour un premier corpus contrôlé, propositions d'objectifs à challenger :
- **Recall@10 ≥ 0,90** parmi les pages accessibles et étiquetées pertinentes ;
- **Precision@5 ≥ 0,70** sur les scénarios qui possèdent des documents pertinents ;
- **False-supported-relation rate ≤ 0,05** ;
- **100 %** des relations affichées comme étayées doivent avoir au moins une preuve vérifiable ;
- **100 %** des scans tronqués/échoués doivent afficher l'incomplétude.

Ces nombres sont des **objectifs de conception**, pas des performances constatées, ni des critères statistiquement robustes tant que l'échantillon est petit. Les évaluations doivent fournir comptes bruts, intervalles d'incertitude et résultats par catégorie de scénario.

Le test produit décisif : **retrouver un runbook sans titre identique ni lien Jira préalable tout en écartant un document trompeur**, avec preuves compréhensibles par un ingénieur.

---

## 10. UX minimum pendant M2

Ne pas attendre M5 pour exposer le raisonnement du moteur. Dès M2, une vue d'investigation simple doit montrer :
- ce que DriftSignal a compris du ticket ;
- les stratégies de recherche utilisées ;
- les pages candidates, leur rôle estimé et le niveau de relation ;
- **« Pourquoi cette page ? »**, avec indices et extraits ancrés ;
- les facteurs de doute (autre environnement, dépendance seulement, source non lue) ;
- la couverture et les limites ;
- action facultative « pertinent / non pertinent / ajouter une page », enregistrée **dans le contexte de cette investigation**, sans apprentissage global implicite.

Cette UI n'a pas besoin de la sophistication visuelle de M5 pour constituer un outil d'évaluation et de démonstration solide.

---

## 11. Plan d'implémentation incrémental

| Incrément | Livraison | Gate de sortie |
|---|---|---|
| **M2.0** | RFC, contrat, benchmark skeleton, invariants | Design review ; aucune régression M1 |
| **M2.1** | Change Profiler typé : old/new endpoint, contexte, références, qualité de données | Tests pour extraction et abstention |
| **M2.2** | Query Planner + adapters lexical et liens existants | Retrouver D01 sans association manuelle |
| **M2.3** | Fusion, budgets, pagination, erreurs partielles, couverture | D02, D06, D09, D10 passants |
| **M2.4** | Parsing par sections, métadonnées, version et preuves | D07, D11, D14 passants |
| **M2.5** | Ranking, rôle documentaire, contexte et abstention | Mesures B0/B1/B2 + tests D03/D04/D13 |
| **M2.6** | Investigation UI légère + feedback contextuel | Démo « pourquoi cette page ? » intelligible |
| **M2.7 (spike)** | Prototype de retrieval sémantique contrôlé | B4 apporte un gain de rappel démontré et sécurité validée |

**Principes de livraison :** changements de code par petites unités, tests avant push sur main, comparaison au benchmark, historique M1 préservé. Le spike B4 ne doit pas retarder M3 si son coût ou les exigences d'accès dépassent le bénéfice prouvé.

### 11.1 Arborescence envisagée (non implémentée)

~~~text
src/
  discovery/
    contracts.mjs
    change-profiler.mjs
    signal-normalizer.mjs
    query-planner.mjs
    adapters/
      cql-retriever.mjs
      explicit-links-retriever.mjs
      semantic-retriever.mjs
    candidate-fusion.mjs
    document-parser.mjs
    relevance-engine.mjs
    coverage.mjs
    discovery-orchestrator.mjs
  core.mjs          # M1 comparison; later adapted, not deleted blindly
  scan.mjs          # current orchestration; migrate behind compatible adapter
  index.js          # Forge API gateway
test/
  discovery/
    benchmark/      # labels + fixtures versionnés
    profiler.test.mjs
    retrieval.test.mjs
    ranking.test.mjs
    coverage.test.mjs
docs/
  discovery-engine-spec-v1.0.md
~~~

Les modules de logique métier doivent rester indépendants de Forge grâce à l'injection des gateways ; cela permet de tester localement le moteur avec corpus et mocks.

---

## 12. Risques, compromis et mesures d'atténuation

| Risque | Impact | Mesure proposée |
|---|---|---|
| CQL manque le bon runbook | Faux négatif de découverte | Recherche ancienne valeur, multi-stratégies, mesurer le rappel ; index optionnel |
| Documents bruités dominent le classement | Perte de confiance utilisateur | Signaux indépendants, rôle du document, tests distracteurs |
| Mauvaise interprétation de l'environnement | Faux rapprochement / mauvais diagnostic | Champ contextCompatibility, preuves, abstention |
| Latence et quotas Atlassian | Scan lent ou interrompu | Budgets, déduplication, pagination, retries, async si nécessaire |
| Exposition de contenu via index | Incident de confidentialité | Cloisonnement, ACL, revalidation, politique de suppression |
| Coûts IA sans gain | Produit difficile à exploiter | Baselines et comparaisons B0–B4, budget par scan |
| Benchmarks artificiellement faciles | Performance illusoire | Cas négatifs difficiles, labels manuels, jeu de test séparé |
| Couplage M2/M3 | Architecture fragile | Contrats explicites DiscoveryReport + EvidenceReference |
| Périmètre M2 sans fin | Retard du produit complet | Incréments, gates, spike sémantique à durée bornée |

---

## 13. Décisions à challenger avec les consultants

### Revue stratégie / produit

1. Le persona primaire reste-t-il l'ingénieur responsable d'un changement technique, ou faut-il viser l'équipe support/runbook owner ?
2. Quelle action constitue la valeur la plus forte : **trouver** un runbook ignoré, **prouver sa pertinence**, ou **identifier l'instruction affectée** ?
3. Quel niveau de faux rapprochements est acceptable pour maintenir la confiance ?
4. Quel scénario de démo représente une difficulté réelle et observable pour le jury ?
5. La promesse « zero setup » doit-elle rester absolue sur le mapping métier, même si cela réduit la couverture initiale ?
6. Quel investissement dans l'indexation sémantique est justifié avant un premier workflow complet de correction ?

### Revue architecture / technique

1. Les scopes actuels suffisent-ils pour les champs Jira supplémentaires et les remote issue links, et quels consentements exigent leurs évolutions ?
2. Quel comportement d'accès doit-on garantir pour des documents Confluence indexés puis devenus privés ?
3. Faut-il un index lexical local avant les embeddings, ou les limites CQL restent-elles acceptables sur des tenants réels ?
4. Comment interpréter proprement Storage HTML, ADF, tables et macros sans perdre l'emplacement des preuves ?
5. Quelle fusion/reranking choisir comme première baseline simple et explicable ?
6. Quels budgets réalistes de pagination, pages et latence peuvent tenir dans Forge ?
7. Quelle stratégie d'actualisation et de suppression des données d'index respecterait les exigences de sécurité ?
8. Comment garantir des benchmarks représentatifs sans disposer d'un grand tenant Confluence réel ?
9. Quel traitement asynchrone permettrait des scans longs sans perte de contexte ni escalade de permissions ?

---

## 14. Definition of Done de M2 (à valider)

M2 pourra être considéré comme terminé lorsque :

- le parcours fonctionne à partir d'un ticket Jira sans mapping préalable ;
- un runbook pertinent peut être retrouvé sans titre identique ni lien explicite ;
- les candidats montrent des raisons et extraits vérifiables de leur rapprochement ;
- le moteur sait distinguer runbook opérationnel, contexte documentaire, dépendance et autre environnement ;
- l'absence de preuve conduit à une abstention explicite ;
- la couverture du scan est toujours visible, y compris en cas d'échec partiel ;
- un benchmark documenté mesure rappel, précision, associations erronées, latence et coûts ;
- la comparaison au moteur M1 démontre un gain mesurable sur les cas difficiles ;
- aucun contenu inaccessible n'est exposé par les résultats ou caches ;
- le contrat de sortie est utilisable par M3 sans réécrire M2 ;
- la démonstration CLSD-6 et les tests de non-régression M1 restent fonctionnels.

**Important :** la réalisation de B4 (index sémantique) n'est pas un critère obligatoire tant qu'aucune mesure n'a prouvé qu'il est nécessaire et viable.

---

## 15. Références techniques à vérifier pendant la mise en œuvre

Sources officielles Atlassian consultées pour fonder les options d'intégration (les règles de scopes, limites et APIs peuvent évoluer) :

- [Confluence — Advanced searching using CQL](https://developer.atlassian.com/cloud/confluence/advanced-searching-using-cql/)
- [Confluence REST — Search](https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-search/)
- [Confluence REST v2 — Pages](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-page)
- [Confluence REST v2 — Versions](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-version/)
- [Jira REST v3 — Remote issue links](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-remote-links/)
- [Forge — Permissions](https://developer.atlassian.com/platform/forge/manifest-reference/permissions/)
- [Forge — Platform quotas and limits](https://developer.atlassian.com/platform/forge/platform-quotas-and-limits/)
- [Forge — Async events](https://developer.atlassian.com/platform/forge/runtime-reference/async-events-api/)

---

## 16. Synthèse de la RFC

**Décisions proposées à valider :**

- Discovery Engine = cœur technologique de DriftSignal.
- Zéro association manuelle obligatoire ; liens existants valorisés.
- Architecture modulaire, multi-stratégies, preuves et couverture natives.
- Relation documentaire et drift constituent deux décisions distinctes.
- Recherche sémantique anticipée dans les interfaces, activation conditionnée au gain mesuré et à la sécurité.
- Benchmark créé au début du chantier, avant les modèles et les optimisations.
- Livraison incrémentale sur main, avec protection de la baseline M1.

**Statut final :** spécification candidate pour discussion, non une architecture figée. Les revues doivent prioritairement challenger la pertinence de l'indexation, les contrats d'évidence, le modèle d'autorisations et les objectifs mesurables.
