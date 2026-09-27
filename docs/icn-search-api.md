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

"Buscar en" (`folderSelector`) y "Opciones de búsqueda" (`_moreOptionsNode`) comparten la celda con attach point
`searchOptionContainer`; su fila (`searchOptionContainer.parentNode`) solo tiene además la etiqueta "Buscar en:". DQ
oculta esa fila con la clase `dqHiddenAction`: las consultas siempre usan los valores predeterminados del constructor
(raíz del repositorio con subcarpetas, documentos, versión de release).

También oculta "Visualización de resultados" (`resultsDisplayButton`) y la casilla "Mostrar todas las propiedades"
(`_displayAllPropsArea`, un `<span>` con la casilla y su etiqueta).

**Barra de la lista de resultados.** `SearchBuilder.getContentListModules()` arma los módulos de la `ContentList`; la
barra es `{ moduleClass: ecm/widget/listView/modules/Toolbar2 }` dentro de un módulo `Bar`, y las propiedades extra de
esa configuración se aplican a la instancia del módulo. `showActionsButton: false` quita "Acciones", y
`onToolbarButtonsCreated(botones)` (vacío en ICN) se invoca cada vez que se crean los botones. Ids de acción en
ICN 3.0.10: `RefreshGrid` (Renovar), `Import` (Añadir documento), `ExportAll` (Exportar todo); hay además un
`DropDownButton` "Nuevo" sin acción y un `ToolbarSeparator`.

Parámetros con los que `SearchPane` crea el `SearchBuilder`: `title`, `uid`, `repository`, `closable`,
`selected`, `parentPane` (el `SearchPane`), `tabContainer`, `tabType: "searchbuilder"`. No recibe un
`searchTemplate`: el builder crea uno nuevo (`BasicSearchDefinition.createSearchTemplate(repository)`).
Del contenedor solo se usan (verificado en la Fase 2):
- `tabContainer.closeTab(builder)`: lo llama Cancelar.
- `parentPane`: se pasa a la lista de resultados; `openTab(params)` / `openSearch(tabType, repository, uid, template)`
  se invocan al abrir una búsqueda guardada desde los resultados.

`SearchBuilder` funciona dentro de un `dijit/layout/TabContainer` común, pero no define `onClose`, y
`TabContainer.closeChild()` solo cierra la pestaña si `onClose()` devuelve `true`: sin eso ni la X ni Cancelar la cierran.

Al pulsar Buscar, ICN 3.0.10 registra `TypeError: Cannot read properties of undefined (reading 'onRequestCompleted')`
en `BasicSearchDefinition._executeSearch`. Ocurre igual en la búsqueda nativa de ICN y los resultados se muestran bien;
no es un problema del plug-in. Si se llama a `_search()` desde código, el error se lanza al llamador (después de enviar
la búsqueda): `QueryTab.runSearch` lo captura y lo registra.

## Widgets de ICN en plantillas propias

- El `TextBox` que ICN usa en lugar de `dijit/form/TextBox` todavía no tiene su nodo de texto en el `postCreate` del
  widget que lo contiene: `get("value")` falla ahí. Guardar el valor en `onChange` en lugar de leerlo.
- El tema de ICN impone el color de los enlaces `<a>`: para cambiarlo (p. ej. un enlace deshabilitado) hace falta
  `!important`.
- `dijit/Menu` con `selector` sobre el contenedor del árbol sigue funcionando aunque el árbol se vuelva a dibujar;
  `menu.currentTarget` es la fila sobre la que se abrió.

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

## Leer las opciones del formulario sin buscar

Todas en `BasicSearchDefinition` (`searchBuilder.searchDefinition`); es lo que usa `QuerySerializer.serialize`:

| Qué | Cómo | Ejemplo |
|---|---|---|
| Buscar en | `folderSelector.getSelected()` → `ecm.model.SelectedFolder` | `path: "\Proteccion"`, `includeSubfolders: true`, `root: true`, `item.id: "Folder,{os},{carpeta}"` |
| Clase | `contentClassSelector.getSelected()` / `isIncludeSubclasses()` | `ContentClass` `id: "Document"`, `name: "Documento"` |
| Coincidencia | `_propertyOptions.getSelectedOptions()` | `{ matchAll: true }` |
| Opciones de búsqueda | `_moreOptions.getSelectedOptions()` | `{ objectType: "document" \| "folder", versionOption: "releasedversion" \| "currentversion" \| "allversions" }` |
| Visualización de resultados | `resultsDisplayOptions.getResultsDisplay()` | `{ columns: ["{NAME}", …], sortBy: "{NAME}", sortAsc: true }` |

Formato de los valores en `SearchCriterion.values`: todo llega como texto, con un `""` sobrante al final. Las fechas
(`xs:timestamp`, formato de pantalla `d/M/yyyy`) llegan en ISO-8601 con zona horaria: `2026-03-15T00:00:00.000-05:00`.

## Reabrir una consulta guardada en el constructor

ICN abre sus búsquedas guardadas así: `retrieveSearchCriteria` pide la búsqueda al servidor y
`SearchTemplate._applyRetrievedSearchCriteria(respuesta)` arma el modelo. Si la plantilla **ya tiene
`searchCriteria`**, `retrieveSearchCriteria` no llama al servidor. `QuerySerializer.toSearchTemplate` aprovecha eso:
convierte la definición al formato de esa respuesta (`toIcnSearch`), la aplica a un `SearchTemplate` nuevo y lo pasa
al `SearchBuilder`, que dibuja la consulta completa (carpeta, clase, opciones, condiciones, rangos, grupos).

Formato de la respuesta que acepta `_applyRetrievedSearchCriteria`:

```js
{
  andSearch: true, objectType: "document",
  search_classes: [ { name: "Document", displayName: "Documento", searchSubclasses: true, objectType: "document" } ],
  search_folders: [ { id: "{GUID carpeta}", pathName: "/Carga CRM", objectStoreId: "{GUID os}",
                      objectStoreName: "Proteccion", searchSubfolders: true, view: "editable" } ],
  moreOptions: { versionOption: "releasedversion", objectType: "document" },
  criterias: [
    { name: "DocumentTitle", label: "Título del documento", dataType: "xs:string",
      selectedOperator: "STARTSWITH", values: ["POL-"] },
    { anded: false, searchCriteria: [ /* criterios o grupos */ ] }          // grupo
  ],
  resultsDisplay: { columns: ["{NAME}", "DateCreated"], sortBy: "DateCreated", sortAsc: false }
}
```

- `isNew()` es verdadero si el id está vacío o empieza por `NewSearch_`; con ese id ICN la trata como búsqueda nueva.
- `pathName` es la ruta de P8 (`/` es la raíz; `ContentItem.attributes.PathName`), no la que se muestra
  (`\Proteccion\Carga CRM`).
- El constructor **reemplaza la visualización de resultados** por la predeterminada al cargar la clase:
  `setContentClass` y enseguida `resultsDisplayOptions.setResultsDisplay(predeterminada)`. Hay que volver a aplicar la
  guardada después de ese primer `setResultsDisplay`; en ese momento el formulario ya está listo para buscar.
- El texto "Se están mostrando resultados para: Nueva búsqueda" no toma el nombre de la consulta (ni con
  `searchTemplate.name` ni con `_newSearchName`); queda así.

## Guardar

`BasicSearchDefinition` maneja Guardar / Guardar como con `_onSave()` / `_onSaveAs()` (abren el diálogo de
búsqueda guardada de P8) y los habilita con `isSaveSupported()` / `configureSaveButton()`. DQ debe ocultar
`saveButton` y `saveAsButton` y usar su propio botón, para no escribir en P8. Restablecer los vuelve a mostrar
(reescribe su estilo en línea), así que se ocultan con una clase CSS con `!important`.

El tema de ICN oculta la X de cierre de `dijit/Dialog`: los diálogos propios necesitan un botón Cerrar.

## Selector de repositorio (`_RepositorySelectorMixin`)

DQ ya no lo usa (trabaja sobre el repositorio configurado en el plug-in); queda como referencia.

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

## Servicios del plug-in desde el navegador (`ecm/model/Request`)

- `Request.invokePluginService(pluginId, serviceId, { requestParams, requestCompleteCallback, requestFailedCallback })`.
- `Request.postPluginService(pluginId, serviceId, contentType, { requestBody, requestParams, … })`: envía `requestBody`
  crudo por POST con ese `Content-Type`; en Java se lee con `request.getReader()`.
- Ambos agregan a los parámetros `plugin`, `action` (= id del servicio) y `desktop`, **sobrescribiendo** los que
  uno envíe con esos nombres. Por eso `QueryStoreService` recibe la operación en `operation`.
- `requestCompleteCallback` recibe la respuesta JSON ya parseada.

En Java, `PluginServiceCallbacks.getUserId()` da el usuario de ICN, pero lo resuelve con el parámetro `repositoryId` de
la solicitud: sin él lanza `NullPointerException`. Una excepción que se escapa de `execute` llega al navegador como
**HTTP 599 sin cuerpo** (el detalle solo queda en el log del servidor). `PluginServiceCallbacks` no puede instanciarse
fuera de ICN (depende de clases que no están en `navigatorAPI.jar`): la lógica del servicio va en un método que no lo
reciba, para poder probarla.

## Diálogos (`ecm/widget/dialog/BaseDialog`)

- `addButton(label, onClick, disabled, isDefault)` devuelve el botón; trae su propio Cancelar.
- `setMessage(texto, "error")` muestra el aviso rojo estándar de ICN arriba del contenido (y el diálogo crece).
- `contentArea` es el nodo donde va el formulario.
- Con `fitContentArea: true` (predeterminado) fija el alto del contenido al abrirse y recorta lo que se agregue
  después; `setIntroText` se mide antes del salto de línea y el diálogo queda corto. Para formularios: cargar los
  datos antes de `show()`, `fitContentArea: false` y los avisos dentro de `contentArea`.

## Configuración del plug-in (herramienta de administración)

`ecm.model.admin.appCfg.getRepositoryObjects(callback)` devuelve los repositorios configurados en ICN
(`ecm.model.admin.RepositoryConfig`: `id`, `getName()`, `getType()` → `"p8"`, `getObjectStoreDisplayName()`), no solo
los de un escritorio. Al cargar valores en `load()` hay que usar `set("value", v, false)`: si se dispara `onChange`,
`_onParamChange` reescribe `configurationString` con campos que todavía no terminaron de cargar.
