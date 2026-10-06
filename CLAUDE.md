# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An **IBM Content Navigator (ICN) plug-in** ("DynamicQueries", version reported by `DynamicQueries.getVersion()`). It is packaged as a single JAR that an ICN administrator registers in the ICN admin tool; ICN loads the Java classes server-side and serves everything under `WebContent/` to the browser. The project was generated from the ICN plug-in Eclipse template. The feature being built is **DQ**: it hosts ICN's native search builder, serializes the query the user defines (document class, fields, conditions, groups) to JSON and sends it through a plug-in service to an external REST API; all queries target the single repository configured for the plug-in. The API's contract is `docs/api/dynamic-queries.openapi.yaml` (draft; the API itself does not exist yet). The feature config pane and the global script are still empty stubs.

## Build

Ant is the only build system (no Maven/Gradle, no linter):

```sh
ant            # default target "all" = clean, compile, jar → ./DynamicQueriesICNPlugin.jar
```

- Compiles with `source/target 1.8` — don't use Java 9+ language features or APIs.
- Dependencies live in `lib/`: `navigatorAPI.jar` (ICN API, `com.ibm.ecm.extension.*`) and `j2ee.jar` (servlet API). `lib/` is git-ignored because this is a public repo and the jars are proprietary — each developer supplies them locally. Never commit them. `build.xml` and `.classpath` reference them by relative path; `.classpath` uses the generic `JRE_CONTAINER`, so keep it free of machine-specific absolute paths.
- The `jar` target copies `src/**/WebContent/**` into the JAR alongside the classes and writes the manifest `Plugin-Class: co.com.portalup.extension.DynamicQueries`. `META-INF/MANIFEST.MF` in the repo is a reference copy; the build generates its own.
- `bin/` is Eclipse's output folder, not used by Ant.
- Tests: `node test/QuerySerializer.test.js` (plain Node, no dependencies; a minimal `define` shim loads the AMD module).

Deploying/testing means loading the built JAR into a running ICN instance (admin tool → Plugins), then enabling the feature on a desktop.

## Architecture

Java side (`src/co/com/portalup/extension/`):
- `DynamicQueries.java` — the `Plugin` subclass (entry point named in the manifest). Declares the plug-in id, the global script `DynamicQueries.js`, CSS `DynamicQueries.css`, the Dojo module path `dynamicQueriesDojo`, the plug-in config dijit, and returns the feature list. New actions, services (`PluginService`), filters, menus, etc. must be instantiated and returned from the corresponding `get*()` array here, or ICN won't see them.
- `QueryStoreService.java` — the only `PluginService` (id `QueryStoreService`): the browser's gateway to query storage and to the projects microservice (`createProject` → `POST {projectsApiUrl}/project` with `{ name, description }`; while the config was never saved it uses `PluginConfiguration.DEFAULT_PROJECTS_API_URL` = `http://localhost:8080/api/v1`, mirrored in `ConfigurationPane.js`; no simulated mode, errors with `NOT_CONFIGURED` if the admin left it empty). Request param `operation` (not `action`, which ICN overwrites with the service id); every operation except `getSettings` needs the `repositoryId` param, because `callbacks.getUserId()` throws NPE without it (the client adds it); always answers HTTP 200 with `{ ok, mode, data | error }`. Logic lives in `handle(...)`, which doesn't take `PluginServiceCallbacks` (can't be instantiated outside ICN) so it can be tested.
- `QueryStore.java` — storage interface mirroring the API contract; `HttpQueryStore` calls the external REST API through `RestClient` (shared JSON HTTP client: Bearer token, `X-ICN-User` URL-encoded, contract error mapping); `InMemoryQueryStore` is the simulated mode used while `apiUrl` is not configured (shared by all users, lost on restart). `QueryStoreException` carries HTTP status + contract error code + user-facing message.
- `PluginConfiguration.java` — parses the plug-in configuration (`repositoryId`, `apiUrl`, `apiToken`, `timeoutSeconds`, `projectsApiUrl`) saved by `ConfigurationPane.js`; the names must match. `repositoryId` is the single repository queries are designed and saved against: `getSettings` exposes it to the browser (never the token/URL) and `saveQuery` rejects other repositories.
- `DQ.java` — a `PluginFeature` (left-side launch bar feature, id `DQ`). Its `getContentClass()` → `dynamicQueriesDojo.DQ` and `getConfigurationDijitClass()` → `dynamicQueriesDojo.FeatureConfigurationPane` link it to the client widgets.

Client side (`src/co/com/portalup/extension/WebContent/`, Dojo AMD):
- `DynamicQueries.js` — global script loaded before login.
- `dynamicQueriesDojo/` — registered by ICN as the `dynamicQueriesDojo` module path; each widget has an HTML template in `templates/` loaded via `dojo/text!`.
  - `DQ.js` — the feature pane, extends `ecm/widget/layout/_LaunchBarPane` (implement `loadContent`/`reset`; `isLoaded`/`needReset` control lifecycle). Leading pane: the repository configured for the plug-in (`repositoryId`, read-only; fetched with the service's `getSettings`, "Nueva consulta" stays disabled until it resolves in the desktop), "Nueva consulta" and a `dijit/Tree` with a single "Consultas guardadas" folder filled from the query service (`refreshTree`). Clicking a query opens it; the context menu offers Abrir / Ejecutar / Eliminar. `openSavedQuery` rebuilds the ICN `SearchTemplate` from the stored JSON (`QuerySerializer.toSearchTemplate`) and reuses the tab if the query is already open. Center: a `StackContainer` switching between an empty state and a `TabContainer` of `QueryTab`s.
  - `QueryTab.js` — one tab per query: a subclass of ICN's `ecm/widget/search/SearchBuilder` (criteria, Buscar, results) with the parts DQ doesn't use hidden via the `dqHiddenAction` class: P8 save buttons, "Buscar en"/"Opciones de búsqueda" (always root folder, documents, released version), "Visualización de resultados", "Mostrar todas las propiedades", "Buscar en varias clases" and "Incluir todas las propiedades" in the class dropdown (hidden, unchecked and disabled, so multi-class mode can't be triggered), and in the results toolbar "Añadir documento", "Exportar todo" and "Acciones" (`getContentListModules` configures the `Toolbar2` module). `DQ` acts as its `tabContainer`/`parentPane` (`closeTab`, `openTab`, `openSearch`). The ICN search API as verified on 3.0.10 is documented in `docs/icn-search-api.md`. "Ver JSON" shows the query definition.
  - `QuerySerializer.js` — both directions between the ICN builder and the API contract's `QueryDefinition`. `serialize(searchDefinition, repository)` reads the form without running the search; `build(state)` (pure) converts it and validates. `toIcnSearch` (pure) / `toSearchTemplate` go back: contract → the JSON ICN uses for saved searches → `SearchTemplate` the builder can open. Pure parts are unit-tested.
  - `SaveQueryDialog.js` — "Guardar consulta" (ICN `BaseDialog`): name and description; creates or updates (sends `id` + `version`). `QueryTab` keeps the saved query in `savedQuery` and fires `onQuerySaved`.
  - `NewProjectDialog.js` — "Nuevo proyecto" (ICN `BaseDialog`, button in the leading pane below "Nueva consulta"): asks for name and description, creates the project through `QueryStoreClient.createProject` and fires `onCreated({ name, description, response })`.
  - `QueryStoreClient.js` — promise wrapper over `ecm/model/Request` for `QueryStoreService`; rejects with `{ status, code, message }`.
  - `ConfigurationPane.js` — plug-in–level admin config (extends `ecm/widget/admin/PluginConfigurationPane`): repository of the queries (required; a select filled with ICN's P8 repositories via `ecm.model.admin.appCfg.getRepositoryObjects`), query service URL, token, timeout, projects microservice base URL.
  - `FeatureConfigurationPane.js` — per-desktop feature config; `load()` reads `this.configurationString`, `save()` must serialize values back into it.

String identifiers are the glue between the Java and JS halves: the Dojo module name, widget class names, file names and the plugin/feature ids returned in Java must match the JS `define`/`declare` names and file paths exactly. Plug-in and feature ids must be alphanumeric (used in URLs). Keep `declare` names in the lowercase `dynamicQueriesDojo.*` namespace.

CSS in `DynamicQueries.css` is loaded globally into ICN, so scope every feature rule under `.dqPane`; dialogs are attached to `<body>`, so scope theirs under their own `dq*Dialog` class.
