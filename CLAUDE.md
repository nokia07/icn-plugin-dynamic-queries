# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An **IBM Content Navigator (ICN) plug-in** ("DynamicQueries", version reported by `DynamicQueries.getVersion()`). It is packaged as a single JAR that an ICN administrator registers in the ICN admin tool; ICN loads the Java classes server-side and serves everything under `WebContent/` to the browser. The project was generated from the ICN plug-in Eclipse template. The feature being built is **DQ**: it hosts ICN's native search builder, serializes the query the user defines (document class, fields, conditions, groups) to JSON and sends it through a plug-in service to an external REST API, grouped in categories. The API's contract is `docs/api/dynamic-queries.openapi.yaml` (draft; the API itself does not exist yet). The config panes and global script are still empty stubs.

## Build

Ant is the only build system (no Maven/Gradle, no tests, no linter):

```sh
ant            # default target "all" = clean, compile, jar → ./DynamicQueriesICNPlugin.jar
```

- Compiles with `source/target 1.8` — don't use Java 9+ language features or APIs.
- Dependencies live in `lib/`: `navigatorAPI.jar` (ICN API, `com.ibm.ecm.extension.*`) and `j2ee.jar` (servlet API). `lib/` is git-ignored because this is a public repo and the jars are proprietary — each developer supplies them locally. Never commit them. `build.xml` and `.classpath` reference them by relative path; `.classpath` uses the generic `JRE_CONTAINER`, so keep it free of machine-specific absolute paths.
- The `jar` target copies `src/**/WebContent/**` into the JAR alongside the classes and writes the manifest `Plugin-Class: co.com.portalup.extension.DynamicQueries`. `META-INF/MANIFEST.MF` in the repo is a reference copy; the build generates its own.
- `bin/` is Eclipse's output folder, not used by Ant.

Deploying/testing means loading the built JAR into a running ICN instance (admin tool → Plugins), then enabling the feature on a desktop.

## Architecture

Java side (`src/co/com/portalup/extension/`):
- `DynamicQueries.java` — the `Plugin` subclass (entry point named in the manifest). Declares the plug-in id, the global script `DynamicQueries.js`, CSS `DynamicQueries.css`, the Dojo module path `dynamicQueriesDojo`, the plug-in config dijit, and returns the feature list. New actions, services (`PluginService`), filters, menus, etc. must be instantiated and returned from the corresponding `get*()` array here, or ICN won't see them.
- `DQ.java` — a `PluginFeature` (left-side launch bar feature, id `DQ`). Its `getContentClass()` → `dynamicQueriesDojo.DQ` and `getConfigurationDijitClass()` → `dynamicQueriesDojo.FeatureConfigurationPane` link it to the client widgets.

Client side (`src/co/com/portalup/extension/WebContent/`, Dojo AMD):
- `DynamicQueries.js` — global script loaded before login.
- `dynamicQueriesDojo/` — registered by ICN as the `dynamicQueriesDojo` module path; each widget has an HTML template in `templates/` loaded via `dojo/text!`.
  - `DQ.js` — the feature pane, extends `ecm/widget/layout/_LaunchBarPane` + `_RepositorySelectorMixin` (implement `loadContent`/`reset`; `isLoaded`/`needReset` control lifecycle). Leading pane: repository selector, "Nueva consulta", name filter and a `dijit/Tree` of categories/queries (`setTreeItems`). Center: a `StackContainer` switching between an empty state and a `TabContainer` of `QueryTab`s.
  - `QueryTab.js` — one tab per query; will host the native ICN search builder.
  - `ConfigurationPane.js` — plug-in–level admin config (extends `ecm/widget/admin/PluginConfigurationPane`).
  - `FeatureConfigurationPane.js` — per-desktop feature config; `load()` reads `this.configurationString`, `save()` must serialize values back into it.

String identifiers are the glue between the Java and JS halves: the Dojo module name, widget class names, file names and the plugin/feature ids returned in Java must match the JS `define`/`declare` names and file paths exactly. Plug-in and feature ids must be alphanumeric (used in URLs). Keep `declare` names in the lowercase `dynamicQueriesDojo.*` namespace.

CSS in `DynamicQueries.css` is loaded globally into ICN, so scope every feature rule under `.dqPane`.
