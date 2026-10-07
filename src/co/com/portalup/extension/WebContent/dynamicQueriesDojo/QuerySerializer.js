define([
	"dojo/_base/array",
	"ecm/model/SearchTemplate"
],
function(array, SearchTemplate) {

	// Traducciones de ICN al vocabulario de la definición de consulta (QueryDefinition en
	// docs/api/dynamic-queries.openapi.yaml), que se guarda como config en el servicio de consultas.
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

	// --- CE SQL (Content Engine de P8) ---

	// Columna "{NAME}" de ICN: la propiedad de nombre de la clase. En las clases de documento es DocumentTitle.
	var NAME_COLUMN = "{NAME}";
	var NAME_PROPERTY = "DocumentTitle";

	function sqlProperty(symbolicName) {
		return "d.[" + (symbolicName === NAME_COLUMN ? NAME_PROPERTY : symbolicName) + "]";
	}

	function sqlString(text) {
		return "'" + String(text).replace(/'/g, "''") + "'";
	}

	// "2026-03-15T00:00:00.000-05:00" → 20260315T050000Z (literal de fecha de CE SQL, en UTC y sin comillas).
	function sqlDate(value) {
		var date = new Date(value);
		if (isNaN(date.getTime())) {
			throw new Error("Fecha no válida: " + value);
		}
		return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
	}

	function sqlLiteral(value, dataType) {
		switch (dataType) {
		case "INTEGER":
		case "FLOAT":
			if (typeof value !== "number" || !isFinite(value)) {
				throw new Error("Número no válido: " + value);
			}
			return String(value);
		case "BOOLEAN":
			return value === true || value === "true" ? "TRUE" : "FALSE";
		case "DATETIME":
			return sqlDate(value);
		case "GUID":
			if (!/^\{?[0-9A-Fa-f-]{36}\}?$/.test(String(value))) {
				throw new Error("Identificador no válido: " + value);
			}
			return String(value).charAt(0) === "{" ? String(value) : "{" + value + "}";
		case "OBJECT":
			return "OBJECT(" + sqlString(value) + ")";
		default:
			return sqlString(value);
		}
	}

	function sqlCondition(node) {
		var property = sqlProperty(node.property);
		var values = node.values;
		var literal = function(value) {
			return sqlLiteral(value, node.dataType);
		};
		var like = function(pattern) {
			return property + " LIKE " + sqlString(pattern);
		};
		var anyEqual = function() {
			return "(" + array.map(values, function(value) { return property + " = " + literal(value); }).join(" OR ") + ")";
		};
		switch (node.operator) {
		case "EQUAL": return property + " = " + literal(values[0]);
		case "NOT_EQUAL": return property + " <> " + literal(values[0]);
		case "LESS": return property + " < " + literal(values[0]);
		case "LESS_OR_EQUAL": return property + " <= " + literal(values[0]);
		case "GREATER": return property + " > " + literal(values[0]);
		case "GREATER_OR_EQUAL": return property + " >= " + literal(values[0]);
		case "STARTS_WITH": return like(values[0] + "%");
		case "ENDS_WITH": return like("%" + values[0]);
		case "CONTAINS": return like("%" + values[0] + "%");
		case "NOT_CONTAINS": return "NOT (" + like("%" + values[0] + "%") + ")";
		case "BETWEEN": return "(" + property + " >= " + literal(values[0]) + " AND " + property + " <= " + literal(values[1]) + ")";
		case "NOT_BETWEEN": return "NOT (" + property + " >= " + literal(values[0]) + " AND " + property + " <= " + literal(values[1]) + ")";
		// Para propiedades de un solo valor; las multivaluadas usarían "valor IN d.[Propiedad]".
		case "IN": return anyEqual();
		case "NOT_IN": return "NOT " + anyEqual();
		case "IS_NULL": return property + " IS NULL";
		case "IS_NOT_NULL": return property + " IS NOT NULL";
		}
		throw new Error("Operador no soportado en CE SQL: " + node.operator);
	}

	function sqlCriteria(nodes, match) {
		var parts = array.map(nodes, function(node) {
			return node.type === "group" ? "(" + sqlCriteria(node.criteria, node.match) + ")" : sqlCondition(node);
		});
		return parts.join(match === "ANY" ? " OR " : " AND ");
	}

	return {
		SCHEMA_VERSION: "1.0",

		/**
		 * CE SQL equivalente a una definición del contrato: columnas de resultados (siempre con Id primero), clase con o
		 * sin subclases, condiciones y grupos, carpeta, versión y orden. Lanza Error si un valor no se puede expresar
		 * (fecha o número no válido, operador desconocido).
		 */
		toCeSql: function(definition) {
			var columns = [ "Id" ];
			array.forEach((definition.resultsDisplay && definition.resultsDisplay.columns) || [ NAME_COLUMN ], function(column) {
				var property = column === NAME_COLUMN ? NAME_PROPERTY : column;
				if (array.indexOf(columns, property) < 0) {
					columns.push(property);
				}
			});
			var sql = "SELECT " + array.map(columns, sqlProperty).join(", ") +
				" FROM [" + definition.documentClass.symbolicName + "] d WITH " +
				(definition.documentClass.includeSubclasses ? "INCLUDESUBCLASSES" : "EXCLUDESUBCLASSES");

			var where = [];
			if (definition.criteria && definition.criteria.length) {
				where.push(definition.criteria.length > 1 && definition.match === "ANY" ?
					"(" + sqlCriteria(definition.criteria, "ANY") + ")" : sqlCriteria(definition.criteria, definition.match));
			}
			if (definition.scope && definition.scope.folderPath) {
				where.push("d.This " + (definition.scope.includeSubfolders ? "INSUBFOLDER " : "INFOLDER ") +
					sqlString(definition.scope.folderPath));
			}
			if (definition.versionSelection === "releasedVersion") {
				where.push("d.[VersionStatus] = 1");
			} else if (definition.versionSelection === "currentVersion") {
				where.push("d.[IsCurrentVersion] = TRUE");
			}
			if (where.length) {
				sql += " WHERE " + where.join(" AND ");
			}

			var sortBy = definition.resultsDisplay && definition.resultsDisplay.sortBy;
			if (sortBy) {
				sql += " ORDER BY " + sqlProperty(sortBy) + (definition.resultsDisplay.sortAscending ? " ASC" : " DESC");
			}
			return sql;
		},

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
