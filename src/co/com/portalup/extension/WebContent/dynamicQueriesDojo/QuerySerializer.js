define([
	"dojo/_base/array",
	"ecm/model/SearchTemplate"
],
function(array, SearchTemplate) {

	// Traducciones de ICN al vocabulario del contrato (docs/api/dynamic-queries.openapi.yaml).
	// Valores de ICN verificados en 3.0.10; ver docs/icn-search-api.md.
	var OPERATORS = {
		EQUAL: "EQUAL",
		NOTEQUAL: "NOT_EQUAL",
		LESS: "LESS",
		LESSOREQUAL: "LESS_OR_EQUAL",
		GREATER: "GREATER",
		GREATEROREQUAL: "GREATER_OR_EQUAL",
		STARTSWITH: "STARTS_WITH",
		ENDSWITH: "ENDS_WITH",
		LIKE: "CONTAINS",
		NOTLIKE: "NOT_CONTAINS",
		BETWEEN: "BETWEEN",
		NOTBETWEEN: "NOT_BETWEEN",
		INANY: "IN",
		NOTIN: "NOT_IN",
		NULL: "IS_NULL",
		NOTNULL: "IS_NOT_NULL"
	};

	var DATA_TYPES = {
		"xs:string": "STRING",
		"xs:integer": "INTEGER",
		"xs:double": "FLOAT",
		"xs:timestamp": "DATETIME",
		"xs:boolean": "BOOLEAN",
		"xs:guid": "GUID",
		"xs:object": "OBJECT"
	};

	var VERSIONS = {
		releasedversion: "releasedVersion",
		currentversion: "currentVersion",
		allversions: "allVersions"
	};

	function invert(map) {
		var inverted = {};
		for (var key in map) {
			inverted[map[key]] = key;
		}
		return inverted;
	}
	var ICN_OPERATORS = invert(OPERATORS);
	var ICN_DATA_TYPES = invert(DATA_TYPES);
	var ICN_VERSIONS = invert(VERSIONS);

	var NO_VALUE_OPERATORS = { IS_NULL: true, IS_NOT_NULL: true };
	var RANGE_OPERATORS = { BETWEEN: true, NOT_BETWEEN: true };
	var MULTI_VALUE_OPERATORS = { IN: true, NOT_IN: true };

	// ICN suele agregar un "" al final de values; los números y booleanos llegan como texto.
	function cleanValues(values, dataType) {
		var cleaned = array.filter(values || [], function(v) {
			return v !== "" && v !== null && v !== undefined;
		});
		return array.map(cleaned, function(v) {
			if ((dataType === "INTEGER" || dataType === "FLOAT") && typeof v === "string" && !isNaN(Number(v))) {
				return Number(v);
			}
			if (dataType === "BOOLEAN" && typeof v === "string") {
				return v === "true";
			}
			return v;
		});
	}

	// Convierte un ecm.model.SearchCriterion o un ecm.model.SearchCriteria (grupo). Devuelve null si la fila quedó
	// vacía: ICN también ignora esas filas al buscar.
	function convertNode(node, errors) {
		if (node.criteria) {
			var children = array.filter(array.map(node.criteria, function(child) {
				return convertNode(child, errors);
			}), function(child) {
				return child !== null;
			});
			return children.length ? { type: "group", match: node.anded ? "ALL" : "ANY", criteria: children } : null;
		}

		var label = node.name || node.id;
		var operator = OPERATORS[node.selectedOperator];
		var dataType = DATA_TYPES[node.dataType];
		if (!operator || !dataType) {
			errors.push("“" + label + "”: operador " + node.selectedOperator + " o tipo " + node.dataType + " no soportado.");
			return null;
		}

		var values = cleanValues(node.values, dataType);
		if (NO_VALUE_OPERATORS[operator]) {
			values = [];
		} else if (!values.length) {
			return null;
		} else if (RANGE_OPERATORS[operator]) {
			if (values.length < 2) {
				errors.push("“" + label + "”: el operador de rango requiere dos valores.");
				return null;
			}
			values = values.slice(0, 2);
		} else if (!MULTI_VALUE_OPERATORS[operator]) {
			values = values.slice(0, 1);
		}

		return {
			type: "condition",
			property: node.id,
			label: node.name,
			dataType: dataType,
			operator: operator,
			values: values
		};
	}

	// "Folder,{object store},{carpeta}" → "{carpeta}"
	function folderGuid(itemId) {
		var match = /\{[^}]+\}$/.exec(itemId || "");
		return match ? match[0] : itemId;
	}

	// Ruta de P8 ("/Carga CRM"; "/" es la raíz), que es la que usa ICN al reconstruir la búsqueda. Si el item no trae
	// PathName se deduce de la ruta que muestra ICN ("\Proteccion\Carga CRM").
	function folderPath(folder, repository) {
		var attributes = folder.item.attributes;
		if (attributes && attributes.PathName) {
			return attributes.PathName;
		}
		var prefix = "\\" + repository.objectStoreName;
		var path = folder.path.indexOf(prefix) === 0 ? folder.path.substring(prefix.length) : folder.path;
		return path.replace(/\\/g, "/") || "/";
	}

	// Nodo del contrato → criterio o grupo en el formato con que ICN devuelve una búsqueda guardada
	// (lo consume SearchTemplate._applyRetrievedSearchCriteria).
	function toIcnNode(node) {
		if (node.type === "group") {
			return { anded: node.match === "ALL", searchCriteria: array.map(node.criteria, toIcnNode) };
		}
		var operator = ICN_OPERATORS[node.operator];
		var dataType = ICN_DATA_TYPES[node.dataType];
		if (!operator || !dataType) {
			throw new Error("La consulta guardada usa un operador (" + node.operator + ") o tipo de dato (" +
				node.dataType + ") que el plug-in no reconoce.");
		}
		return {
			name: node.property,
			label: node.label || node.property,
			dataType: dataType,
			selectedOperator: operator,
			values: array.map(node.values, String)
		};
	}

	return {
		SCHEMA_VERSION: "1.0",

		/**
		 * Arma la definición de consulta del contrato a partir del estado del constructor.
		 *
		 * @param state {
		 *   repository: ecm.model.Repository,
		 *   folder: ecm.model.SelectedFolder | null,   // "Buscar en"
		 *   contentClass: ecm.model.ContentClass,
		 *   includeSubclasses: boolean,
		 *   moreOptions: { objectType, versionOption }, // SearchMoreOptions.getSelectedOptions()
		 *   matchAll: boolean,                          // SearchPropertyOptions: coincidencia total
		 *   criteria: Array,                            // AttributeDefinitionsForm.createSearchCriteriaFromAttributeDefintions()
		 *   resultsDisplay: { columns, sortBy, sortAsc }
		 * }
		 * @return { definition: Object, errors: String[] } — errors vacío si la definición es válida.
		 */
		build: function(state) {
			var errors = [];
			var definition = {
				schemaVersion: this.SCHEMA_VERSION,
				repository: {
					id: state.repository.id,
					objectStore: state.repository.objectStoreName,
					type: "p8"
				},
				objectType: state.moreOptions.objectType || "document"
			};

			if (state.folder && state.folder.item) {
				definition.scope = {
					folderId: folderGuid(state.folder.item.id),
					folderPath: folderPath(state.folder, state.repository),
					includeSubfolders: !!state.folder.includeSubfolders
				};
			}

			if (state.contentClass) {
				definition.documentClass = {
					symbolicName: state.contentClass.id,
					displayName: state.contentClass.name,
					includeSubclasses: !!state.includeSubclasses
				};
			} else {
				errors.push("Seleccione una clase.");
			}

			definition.versionSelection = VERSIONS[state.moreOptions.versionOption] || "releasedVersion";
			definition.match = state.matchAll ? "ALL" : "ANY";
			definition.criteria = array.filter(array.map(state.criteria || [], function(node) {
				return convertNode(node, errors);
			}), function(node) {
				return node !== null;
			});
			if (!definition.criteria.length && !errors.length) {
				errors.push("Defina al menos una condición con valor.");
			}

			if (state.resultsDisplay) {
				definition.resultsDisplay = {
					columns: state.resultsDisplay.columns || [],
					sortBy: state.resultsDisplay.sortBy,
					sortAscending: !!state.resultsDisplay.sortAsc
				};
			}

			return { definition: definition, errors: errors };
		},

		/**
		 * Inverso de build: convierte una definición del contrato en el formato con que ICN devuelve una búsqueda
		 * guardada. repository es el ecm.model.Repository donde se ejecuta (aporta el id del object store).
		 */
		toIcnSearch: function(definition, repository) {
			var objectType = definition.objectType || "document";
			var icnSearch = {
				andSearch: definition.match !== "ANY",
				objectType: objectType,
				search_classes: [ {
					name: definition.documentClass.symbolicName,
					displayName: definition.documentClass.displayName || definition.documentClass.symbolicName,
					searchSubclasses: !!definition.documentClass.includeSubclasses,
					objectType: objectType
				} ],
				moreOptions: {
					objectType: objectType,
					versionOption: ICN_VERSIONS[definition.versionSelection] || "releasedversion"
				},
				criterias: array.map(definition.criteria, toIcnNode)
			};
			if (definition.scope) {
				icnSearch.search_folders = [ {
					id: definition.scope.folderId,
					pathName: definition.scope.folderPath,
					objectStoreId: repository.objectStoreId,
					objectStoreName: repository.objectStoreName,
					searchSubfolders: !!definition.scope.includeSubfolders,
					view: "editable"
				} ];
			}
			if (definition.resultsDisplay) {
				icnSearch.resultsDisplay = {
					columns: definition.resultsDisplay.columns,
					sortBy: definition.resultsDisplay.sortBy,
					sortAsc: !!definition.resultsDisplay.sortAscending
				};
			}
			return icnSearch;
		},

		/**
		 * SearchTemplate listo para abrir en el constructor con la definición guardada. Como ya trae sus criterios,
		 * retrieveSearchCriteria no consulta al servidor; el id "NewSearch_…" hace que ICN la trate como búsqueda nueva
		 * (no guardada en P8). Lanza Error si la definición usa operadores o tipos desconocidos.
		 */
		toSearchTemplate: function(definition, repository, name) {
			var searchTemplate = new SearchTemplate({ id: "NewSearch_dq_" + new Date().getTime(), name: name, repository: repository });
			searchTemplate._applyRetrievedSearchCriteria(this.toIcnSearch(definition, repository));
			return searchTemplate;
		},

		/**
		 * Lee el formulario del constructor de ICN (BasicSearchDefinition) sin ejecutar la búsqueda y arma la
		 * definición. Los valores de las filas no se copian al SearchTemplate hasta buscar, por eso se leen de los
		 * widgets.
		 */
		serialize: function(searchDefinition, repository) {
			return this.build({
				repository: repository,
				folder: searchDefinition.folderSelector.getSelected(),
				contentClass: searchDefinition.contentClassSelector.getSelected(),
				includeSubclasses: searchDefinition.contentClassSelector.isIncludeSubclasses(),
				moreOptions: searchDefinition._moreOptions.getSelectedOptions(),
				matchAll: searchDefinition._propertyOptions.getSelectedOptions().matchAll,
				criteria: searchDefinition.attributeDefinitionFormWid.createSearchCriteriaFromAttributeDefintions(),
				resultsDisplay: searchDefinition.resultsDisplayOptions.getResultsDisplay()
			});
		}
	};
});
