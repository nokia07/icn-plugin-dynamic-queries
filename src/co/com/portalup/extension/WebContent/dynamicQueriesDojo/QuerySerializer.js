define([
	"dojo/_base/array"
],
function(array) {

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
					folderPath: state.folder.path,
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
