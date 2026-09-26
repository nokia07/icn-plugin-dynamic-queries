# API de búsqueda de ICN (verificada)

Relevamiento de la Fase 0 sobre el ambiente de pruebas: **IBM Content Navigator 3.0.10**, Dojo 1.15.3,
escritorio `Proteccion` (repositorios P8 `Proteccion` y `P8Pruebas`, ambos sobre el object store `Proteccion`).
Todo lo que sigue se comprobó en ese servidor inspeccionando los widgets en ejecución; los métodos con `_` son
internos de IBM y pueden cambiar entre versiones de ICN.

## Cómo arma ICN "Nueva búsqueda"

```
SearchPane (feature Buscar)
└── SearchTabContainer
    └── ecm.widget.search.SearchBuilder          ← la pestaña "Nueva búsqueda"
        ├── searchTemplate: ecm.model.SearchTemplate (isNew() === true)
        ├── searchDefinition: BasicSearchDefinition   ← "Criterios de búsqueda"
        │   ├── SearchInDropDown           "Buscar en"
        │   ├── SearchClassSelector        "Clase"
        │   ├── SearchMoreOptions          "Opciones de búsqueda" (Documentos, Versión de release)
        │   ├── attributeDefinitionFormWid: AttributeDefinitionsForm   ← filas y grupos
        │   └── botones (attach points): searchButton, resetButton, saveButton, saveAsButton,
        │       cancelButton, resultsDisplayButton, addPropertyButton, _addGroupButton, showAllLink
        └── searchResults: ecm.widget.listView.ContentList   ← "Resultados de búsqueda"
```

Parámetros con los que `SearchPane` crea el `SearchBuilder`: `title`, `uid`, `repository`, `closable`,
`selected`, `parentPane` (el `SearchPane`), `tabContainer`, `tabType: "searchbuilder"`. No recibe un
`searchTemplate`: el builder crea uno nuevo (`BasicSearchDefinition.createSearchTemplate(repository)`).
Pendiente para la Fase 2: comprobar qué funcionalidades dependen de `parentPane`, que en DQ no será un `SearchPane`.

## Leer lo que definió el usuario

Los valores escritos en el formulario **no** se copian al `SearchTemplate` hasta ejecutar o guardar. Para leerlos:

```js
var criteria = searchBuilder.searchDefinition.attributeDefinitionFormWid
		.createSearchCriteriaFromAttributeDefintions();   // (sic) así se llama en ICN
```

Devuelve un arreglo cuyos elementos son:
- `ecm.model.SearchCriterion`: `id` (nombre simbólico), `name` (etiqueta), `dataType`, `selectedOperator`,
  `values` (puede traer un `""` sobrante al final; hay que limpiarlo).
- `ecm.model.SearchCriteria` (un grupo): `anded` (`false` = "cualquiera de estas propiedades") y `criteria`
  (arreglo recursivo).

Del `SearchTemplate`: `andSearch` (coincidencia total/cualquiera del nivel raíz), `classes[]` (`id`, `name`),
`includeSubclasses`, `objectType`, `folders[]`, `moreOptions`. `toJson()` devuelve un **string** JSON con
`searchCriteria`, `search_classes`, `search_folders`, `search_objectstores`, `searchSubclasses`, `andSearch`,
`objectType`, `moreOptions`, `resultsDisplay`.

`BasicSearchDefinition._updateSearchTemplate(template)` no sincroniza los valores de las filas.

## Guardar

`BasicSearchDefinition` maneja Guardar / Guardar como con `_onSave()` / `_onSaveAs()` (abren el diálogo de
búsqueda guardada de P8) y los habilita con `isSaveSupported()` / `configureSaveButton()`. DQ debe ocultar
`saveButton` y `saveAsButton` y usar su propio botón, para no escribir en P8.

## Selector de repositorio (`_RepositorySelectorMixin`)

- `createRepositorySelector()` crea `this.repositorySelector` pero **no** lo inserta en el DOM.
- `doRepositorySelectorConnections()` invoca `this.setRepository(repo)` al iniciar sesión y al seleccionar otro
  repositorio. Ni el mixin ni `_LaunchBarPane` implementan `setRepository`: el feature pane debe hacerlo.
- También expone `setRepositoryTypes`, `setPaneDefaultLayoutRepository`, `onRepositoryChange(pane, repository)`.

## Operadores y tipos de dato

Operadores que ofrece ICN por tipo (clase `Document`, 172 propiedades):

| Tipo ICN | Operadores |
|---|---|
| `xs:string` | STARTSWITH, ENDSWITH, LIKE, NOTLIKE, EQUAL, NOTEQUAL, LESS, LESSOREQUAL, GREATER, GREATEROREQUAL, INANY, NOTIN, NULL, NOTNULL |
| `xs:timestamp`, `xs:integer`, `xs:double` | EQUAL, NOTEQUAL, LESS, LESSOREQUAL, GREATER, GREATEROREQUAL, BETWEEN, NOTBETWEEN, INANY, NOTIN, NULL, NOTNULL |
| `xs:boolean`, `xs:guid` | EQUAL, NOTEQUAL, INANY, NOTIN, NULL, NOTNULL |
| `xs:object` | EQUAL, NOTEQUAL, NULL, NOTNULL |

Correspondencia con el contrato (`docs/api/dynamic-queries.openapi.yaml`):

| ICN | Contrato | | ICN | Contrato |
|---|---|---|---|---|
| EQUAL | EQUAL | | LIKE | CONTAINS |
| NOTEQUAL | NOT_EQUAL | | NOTLIKE | NOT_CONTAINS |
| LESS | LESS | | BETWEEN | BETWEEN |
| LESSOREQUAL | LESS_OR_EQUAL | | NOTBETWEEN | NOT_BETWEEN |
| GREATER | GREATER | | INANY | IN |
| GREATEROREQUAL | GREATER_OR_EQUAL | | NOTIN | NOT_IN |
| STARTSWITH | STARTS_WITH | | NULL | IS_NULL |
| ENDSWITH | ENDS_WITH | | NOTNULL | IS_NOT_NULL |

| ICN | Contrato |
|---|---|
| `xs:string` | STRING |
| `xs:integer` | INTEGER |
| `xs:double` | FLOAT |
| `xs:timestamp` | DATETIME |
| `xs:boolean` | BOOLEAN |
| `xs:guid` | GUID |
| `xs:object` | OBJECT |
