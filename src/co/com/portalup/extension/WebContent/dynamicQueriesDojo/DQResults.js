define([
	"dojo/_base/declare",
	"dojo/_base/lang",
	"dojo/_base/array",
	"dojo/Deferred",
	"dojo/promise/all",
	"dojo/when",
	"dojo/dom-class",
	"dojo/dom-construct",
	"dojo/json",
	"dojo/keys",
	"dojo/on",
	"dojo/store/Memory",
	"dojo/data/ObjectStore",
	"dijit/tree/ObjectStoreModel",
	"dijit/Tree",
	"dijit/registry",
	"dojox/grid/DataGrid",
	"dijit/form/Select",
	"dijit/form/ValidationTextBox",
	"dijit/form/NumberTextBox",
	"dijit/form/DateTextBox",
	"ecm/model/Desktop",
	"ecm/widget/dialog/MessageDialog",
	"ecm/widget/layout/_LaunchBarPane",
	"dynamicQueriesDojo/DqApiClient",
	"dynamicQueriesDojo/DocumentPropertiesClient",
	"dynamicQueriesDojo/ExecuteQueriesClient",
	"dynamicQueriesDojo/QuerySerializer",
	"dynamicQueriesDojo/SettingsClient",
	"dojo/text!./templates/DQResults.html",
	// Script sin AMD: define window.UTIF (decodificador de TIFF).
	"dynamicQueriesDojo/UTIF",
	"idx/layout/BorderContainer",
	"dijit/layout/BorderContainer",
	"dijit/layout/ContentPane",
	"dijit/form/Button"
],
function(declare,
		lang,
		array,
		Deferred,
		all,
		when,
		domClass,
		domConstruct,
		JSON,
		keys,
		on,
		Memory,
		ObjectStore,
		ObjectStoreModel,
		Tree,
		registry,
		DataGrid,
		Select,
		ValidationTextBox,
		NumberTextBox,
		DateTextBox,
		Desktop,
		MessageDialog,
		_LaunchBarPane,
		DqApiClient,
		DocumentPropertiesClient,
		ExecuteQueriesClient,
		QuerySerializer,
		SettingsClient,
		template) {

	// Escritorio de ICN con el que bookmark.jsp muestra los documentos que no vienen de S3.
	var VIEWER_DESKTOP = "LPADocViewer";
	// Nombre de la pestaña donde "Abrir en pestaña nueva" muestra el documento: se reutiliza en cada click.
	var DETACHED_WINDOW = "dqResultsViewer";
	// Cada cuánto se revisa la sesión de ICN (ver _checkSession).
	var SESSION_CHECK_MS = 500;
	// Espera máxima por las definiciones de atributos de una clase: si la clase no existe, ICN 3.0.10 no llama ni al
	// callback ni al de error de retrieveAttributeDefinitions.
	var ATTRIBUTES_TIMEOUT_MS = 10000;
	// Documento cuya composición tardó más que el timeout del servidor: cada cuánto se pregunta si ya existe su versión 2
	// (el PDF compuesto ya cargado en FileNet) y cuántas veces antes de dejar de esperar (~30 min).
	var COMPOSE_CHECK_MS = 25000;
	var COMPOSE_CHECK_MAX = 72;
	var FEATURE_ID = "DQResults"; // DQResults.getId()

	var MIME_TYPES = {
		pdf: "application/pdf",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		png: "image/png",
		gif: "image/gif",
		bmp: "image/bmp",
		tiff: "image/tiff",
		tif: "image/tiff",
		webp: "image/webp",
		svg: "image/svg+xml",
		heic: "image/heic",
		txt: "text/plain",
		csv: "text/csv",
		json: "application/json",
		xml: "application/xml"
	};

	function isActive(item) {
		return item.status !== "INACTIVE";
	}

	function byName(a, b) {
		return String(a.name).localeCompare(String(b.name));
	}

	// Comodines de las consultas de un proyecto, sin repetir: el mismo #Nombre en varias consultas es un solo campo
	// (como #NroIdentificacion en las de la consulta general); el rótulo y el tipo son los de la primera. sources son
	// las { className, property } de todas, donde se busca la lista de opciones. Ordenados por el orden que les dio el
	// diseñador (el menor si el comodín está en varias consultas); los que no tienen, al final en el orden en que aparecen.
	function projectParameters(queries) {
		var parameters = [];
		var byName = {};
		array.forEach(queries, function(query) {
			array.forEach(QuerySerializer.getQueryParameters(query), function(parameter) {
				var merged = byName[parameter.name];
				if (!merged) {
					merged = byName[parameter.name] = lang.mixin({ sources: [] }, parameter);
					parameters.push(merged);
				} else if (parameter.order !== undefined && (merged.order === undefined || parameter.order < merged.order)) {
					merged.order = parameter.order;
				}
				if (parameter.className && parameter.property) {
					merged.sources.push({ className: parameter.className, property: parameter.property });
				}
			});
		});
		return QuerySerializer.sortParameters(parameters);
	}

	// Opciones de una lista de opciones de P8 ({ displayName, value }); las de un grupo anidado van con su ruta.
	function choiceOptions(choices, prefix) {
		var options = [];
		array.forEach(choices || [], function(choice) {
			if (choice.choices) {
				options = options.concat(choiceOptions(choice.choices, (prefix || "") + choice.displayName + " / "));
			} else {
				options.push({ label: (prefix || "") + choice.displayName, value: String(choice.value) });
			}
		});
		return options;
	}

	function base64ToBytes(base64Data) {
		var binary = atob(base64Data);
		var bytes = new Uint8Array(binary.length);
		for (var i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes;
	}

	/**
	 * @name dynamicQueriesDojo.DQResults
	 * @class Feature pane "Resultados de consultas": ejecuta las consultas de un proyecto del microservicio de DQ. El
	 *        usuario elige un proyecto (activo y con consultas activas), llena los comodines de sus consultas y Buscar
	 *        las ejecuta (ExecuteQueriesService, con su sesión de P8) y muestra los documentos agrupados en carpetas
	 *        como la consulta general; al elegir uno, sus propiedades y el documento (DocumentPropertiesService, que
	 *        trae de S3 el contenido de los documentos con file_key y storage_name). El árbol y el visor vienen de
	 *        GQViewFeature (PortalUpICN).
	 * @augments ecm.widget.layout._LaunchBarPane
	 */
	return declare("dynamicQueriesDojo.DQResults", [
		_LaunchBarPane
	], {
		/** @lends dynamicQueriesDojo.DQResults.prototype */

		templateString: template,

		// Set to true if widget template contains DOJO widgets.
		widgetsInTemplate: true,

		postCreate: function() {
			this.logEntry("postCreate");
			this.inherited(arguments);

			this._buildTree([ { id: "root", name: "Documentos", type: "folder" } ]);

			this._gridStore = new Memory({ data: [] });
			this.grid = new DataGrid({
				store: new ObjectStore({ objectStore: this._gridStore }),
				structure: [
					{ name: "Nombre", field: "key", width: "50%" },
					{ name: "Valor", field: "value", width: "50%" }
				],
				style: "width:100%; height:100%;"
			}, this.gridNode);
			this.grid.startup();

			// Abierto desde la URL (&feature=DQResults), en 3.0.10 ICN crea y selecciona el panel antes del login y no
			// llama a loadContent, y Desktop.onLogin no avisa del primer inicio de sesión (igual que en DynamicQueries.js):
			// se revisa la sesión periódicamente y se carga en cuanto haya usuario. También vacía el panel al cambiar de
			// usuario, porque ICN lo reutiliza entre sesiones en la misma pestaña.
			this._sessionTimer = setInterval(lang.hitch(this, this._checkSession), SESSION_CHECK_MS);

			this.logExit("postCreate");
		},

		/**
		 * Optional method that sets additional parameters when the user clicks on the launch button associated with
		 * this feature.
		 */
		setParams: function(params) {
			this.logEntry("setParams", params);

			if (params) {

				if (!this.isLoaded && this.selected) {
					this.loadContent();
				}
			}

			this.logExit("setParams");
		},

		/**
		 * Loads the content of the pane. This is a required method to insert a pane into the LaunchBarContainer.
		 */
		loadContent: function() {
			this.logEntry("loadContent");

			if (!this.isLoaded) {
				this.isLoaded = true;
				this.needReset = false;
				this._loadProjects();
			}

			this.logExit("loadContent");
		},

		/**
		 * Resets the content of this pane.
		 */
		reset: function() {
			this.logEntry("reset");

			this.needReset = false;

			this.logExit("reset");
		},

		destroy: function() {
			clearInterval(this._sessionTimer);
			this._stopCompositions();
			this._revokeViewerUrl();
			this._revokeDetachedUrl();
			this._destroyFields();
			this.inherited(arguments);
		},

		_checkSession: function() {
			var user = Desktop.connected ? Desktop.userId || "" : "";
			if (user !== this._sessionUser) {
				this._sessionUser = user;
				this._resetSession();
			}
			// Una sola carga automática por sesión: si falla, se reintenta al volver a abrir el feature (loadContent).
			if (user && this.selected && !this.isLoaded && !this._sessionLoaded) {
				this._sessionLoaded = true;
				this.loadContent();
			}
		},

		_resetSession: function() {
			this._stopCompositions();
			this._revokeDetachedUrl();
			this._sessionLoaded = false;
			this.isLoaded = false;
			this._projects = {};
			this.projectField.set("options", []);
			this.projectField.set("disabled", true);
			this.searchButton.set("disabled", true);
			this._destroyFields();
			this._clearScreen();
			this._setMessage("");
		},

		// Proyectos activos con al menos una consulta activa (la consulta y su asociación), del microservicio de DQ.
		_loadProjects: function() {
			this._projects = {};
			this._setMessage("Cargando proyectos...");
			SettingsClient.getSettings().then(lang.hitch(this, function(settings) {
				DqApiClient.baseUrl = settings.projectsApiUrl || "";
				// Para las listas de opciones de los comodines; si no está en el escritorio, los campos son de texto.
				this._repository = Desktop.getRepository(settings.repositoryId) || null;
				this._attributeDefinitions = {};
				return DqApiClient.listProjectQueryCompose();
			})).then(lang.hitch(this, function(projects) {
				var options = [];
				array.forEach(array.filter(projects || [], isActive).sort(byName), lang.hitch(this, function(project) {
					var queries = array.filter(project.queries || [], function(query) {
						return isActive(query) && query.projectQueryStatus !== "INACTIVE";
					});
					if (queries.length) {
						this._projects[project.id] = { project: project, queries: queries.sort(byName) };
						options.push({ label: project.name, value: String(project.id) });
					}
				}));
				this.projectField.set("options", [ { label: "Seleccione un proyecto", value: "" } ].concat(options));
				this.projectField.set("value", "");
				this.projectField.set("disabled", options.length === 0);
				this._onProjectChange("");
				this._setMessage(options.length ? "" : "No hay proyectos activos con consultas activas.");
			}), lang.hitch(this, function(error) {
				// Se reintenta la próxima vez que se abra el feature.
				this.isLoaded = false;
				this._setMessage("No se pudieron cargar los proyectos: " + error.message, true);
			}));
		},

		// Arma el formulario con los comodines de las consultas del proyecto elegido; antes busca las listas de opciones
		// de sus propiedades.
		_onProjectChange: function(projectId) {
			this._destroyFields();
			this._clearScreen();
			var entry = this._projects && this._projects[projectId];
			this.searchButton.set("disabled", true);
			// Si el usuario cambia de proyecto mientras se buscan las listas, solo vale la última elección.
			var request = this._fieldsRequest = (this._fieldsRequest || 0) + 1;
			if (!entry) {
				return;
			}
			var parameters = projectParameters(entry.queries);
			this._setMessage(parameters.length ? "Cargando campos..." : "");
			all(array.map(parameters, lang.hitch(this, this._getChoices))).then(lang.hitch(this, function(choices) {
				if (request === this._fieldsRequest) {
					this._buildFields(entry, parameters, choices);
				}
			}), lang.hitch(this, function(error) {
				// Un error inesperado al leer las listas no impide buscar: campos de texto.
				console.error("DQResults: error leyendo las listas de opciones", error);
				if (request === this._fieldsRequest) {
					this._buildFields(entry, parameters, []);
				}
			}));
		},

		_buildFields: function(entry, parameters, choices) {
			array.forEach(parameters, lang.hitch(this, function(parameter, i) {
				var item = domConstruct.create("div", { "class": "dqResultsSearchItem" }, this.parametersNode);
				var widget = choices[i] ? this._createChoiceField(parameter, choices[i]) : this._createField(parameter);
				domConstruct.create("label", { "for": widget.id, textContent: parameter.label + ":" }, item);
				widget.placeAt(item);
				widget.startup();
				// Enter en un campo es Buscar, como en la consulta general.
				widget.own(on(widget.domNode, "keydown", lang.hitch(this, function(event) {
					if (event.keyCode === keys.ENTER) {
						this._onSearch();
					}
				})));
				this._fields.push({ parameter: parameter, widget: widget });
			}));
			this.searchButton.set("disabled", false);
			var count = entry.queries.length;
			this._setMessage(count + (count === 1 ? " consulta" : " consultas") +
				(this._fields.length ? "; llene los campos y pulse Buscar." : " sin comodines; pulse Buscar."));
		},

		// La región superior del BorderContainer conserva la altura con que se dibujó: al cambiar los campos o el mensaje
		// (que pueden ocupar otra línea) hay que volver a calcularla, o la región central queda encima de los campos.
		_layoutSearchPane: function() {
			if (this.searchContainer && this.searchContainer._started) {
				this.searchContainer.layout();
			}
		},

		/**
		 * Lista de opciones de la propiedad del comodín en la clase de su consulta (la primera de sources que tenga una),
		 * de las definiciones de atributos de ICN: se resuelve con [ { label, value } ] o null. Nunca se rechaza: sin
		 * repositorio, si la clase no existe o falla la consulta, el campo es de texto.
		 */
		_getChoices: function(parameter) {
			var sources = parameter.sources || [];
			var next = lang.hitch(this, function(i) {
				if (i >= sources.length) {
					return null;
				}
				return this._getAttributeDefinitions(sources[i].className).then(function(definitions) {
					for (var j = 0; j < definitions.length; j++) {
						var choiceList = definitions[j].id === sources[i].property && definitions[j].choiceList;
						if (choiceList && choiceList.choices && choiceList.choices.length) {
							return choiceOptions(choiceList.choices);
						}
					}
					return next(i + 1);
				});
			});
			return when(next(0));
		},

		// Definiciones de atributos de una clase (ContentClass.retrieveAttributeDefinitions), una vez por clase; [] si fallan
		// o no llegan a tiempo (ATTRIBUTES_TIMEOUT_MS).
		_getAttributeDefinitions: function(className) {
			if (!this._attributeDefinitions[className]) {
				var deferred = new Deferred();
				this._attributeDefinitions[className] = deferred.promise;
				var contentClass = this._repository && this._repository.getContentClass(className);
				var done = function(definitions) {
					if (!deferred.isFulfilled()) {
						deferred.resolve(definitions || []);
					}
				};
				if (!contentClass) {
					done([]);
				} else {
					setTimeout(function() {
						done([]);
					}, ATTRIBUTES_TIMEOUT_MS);
					// true: en segundo plano, sin el indicador de progreso ni el diálogo de error de ICN.
					contentClass.retrieveAttributeDefinitions(done, true, function() {
						done([]);
					});
				}
			}
			return this._attributeDefinitions[className];
		},

		// Lista desplegable con las opciones de la lista de P8; la primera, vacía, obliga a elegir una.
		_createChoiceField: function(parameter, options) {
			return new Select({
				id: this.id + "_param_" + parameter.name,
				required: true,
				maxHeight: 300,
				"class": "dqResultsSearchField",
				options: [ { label: "Seleccione…", value: "" } ].concat(options)
			});
		},

		// Campo del comodín según su tipo; todos son obligatorios porque todas las consultas del proyecto se ejecutan.
		_createField: function(parameter) {
			var props = { id: this.id + "_param_" + parameter.name, required: true, "class": "dqResultsSearchField" };
			switch (parameter.dataType) {
			case "INTEGER":
				return new NumberTextBox(lang.mixin(props, { constraints: { places: 0 } }));
			case "FLOAT":
				return new NumberTextBox(props);
			case "DATETIME":
				return new DateTextBox(props);
			case "BOOLEAN":
				return new Select(lang.mixin(props, { options: [ { label: "Sí", value: "true" }, { label: "No", value: "false" } ] }));
			case "STRING":
				return new ValidationTextBox(lang.mixin(props, { trim: true }));
			default:
				// Sin tipo (consulta creada fuera del plug-in, comodín sin comillas en el CE SQL): un número.
				return new ValidationTextBox(lang.mixin(props, {
					trim: true,
					regExp: "-?\\d+(\\.\\d+)?",
					invalidMessage: "Escriba un número."
				}));
			}
		},

		_destroyFields: function() {
			array.forEach(this._fields || [], function(field) {
				field.widget.destroyRecursive();
			});
			this._fields = [];
			if (this.parametersNode) {
				domConstruct.empty(this.parametersNode);
			}
			this._layoutSearchPane();
		},

		_setMessage: function(text, isError) {
			this.messageNode.textContent = text || "";
			domClass.toggle(this.messageNode, "dqResultsMessageError", !!isError);
			this._layoutSearchPane();
		},

		// Buscar: reemplaza los comodines en el CE SQL de cada consulta del proyecto y las ejecuta; los documentos llegan
		// agrupados en las carpetas de la ruta de agrupación de cada consulta.
		_onSearch: function() {
			var entry = this._projects && this._projects[this.projectField.get("value")];
			if (!entry || this.searchButton.get("disabled")) {
				return;
			}
			var values = {};
			for (var i = 0; i < this._fields.length; i++) {
				var widget = this._fields[i].widget;
				if (widget.validate && !widget.validate()) {
					widget.focus();
					this._setMessage("Llene correctamente “" + this._fields[i].parameter.label + "”.", true);
					return;
				}
				values[this._fields[i].parameter.name] = widget.get("value");
			}

			var queries = [];
			var failures = [];
			array.forEach(entry.queries, function(query) {
				try {
					queries.push({
						name: query.name,
						cesql: QuerySerializer.fillParameters(query.cesql || "", QuerySerializer.getQueryParameters(query), values),
						config: query.projectQueryConfig || ""
					});
				} catch (e) {
					failures.push({ name: query.name, message: e.message });
				}
			});
			if (!queries.length) {
				this._showResults({ tree: [], failures: failures, truncated: [] });
				return;
			}

			this._showLoading(true);
			this.searchButton.set("disabled", true);
			this._setMessage("");
			ExecuteQueriesClient.execute(queries).then(lang.hitch(this, function(data) {
				this._showLoading(false);
				this.searchButton.set("disabled", false);
				data.failures = failures.concat(data.failures || []);
				this._showResults(data);
			}), lang.hitch(this, function(error) {
				this._showLoading(false);
				this.searchButton.set("disabled", false);
				console.error("DQResults: error en la consulta", error);
				this._clearScreen();
				this._setMessage("Ocurrió un error al procesar la búsqueda: " + error.message, true);
			}));
		},

		// Árbol con los documentos y, debajo del formulario, las consultas que fallaron o se recortaron.
		_showResults: function(data) {
			this._clearScreen();
			var notes = [];
			if (data.failures.length) {
				notes.push("No se pudieron ejecutar: " + array.map(data.failures, function(failure) {
					return failure.name + " (" + failure.message + ")";
				}).join("; ") + ".");
			}
			if (data.truncated && data.truncated.length) {
				notes.push("Se muestran solo los primeros documentos de: " + data.truncated.join(", ") + ".");
			}
			this._setMessage(notes.join(" "), data.failures.length > 0);
			if (data.tree && data.tree.length > 0) {
				this._buildTree(this.buildTreeData(data.tree));
			} else if (!data.failures.length) {
				this._showAlert("La búsqueda no obtuvo resultados.");
			}
		},

		/**
		 * Convierte el árbol de ExecuteQueriesService (la forma de queryContent de la consulta general) en los items del
		 * árbol. Cada carpeta trae en text su nombre o una ruta separada por comas ({ vnRoot: "A,B,C" }), que se separa
		 * en carpetas anidadas; en children, sus documentos ({ text, viewerUrl, mimeType, data }) y sus subcarpetas
		 * ({ vnRoot: [ { name }, … ] }). Las carpetas con la misma ruta se fusionan.
		 */
		buildTreeData: function(response) {
			var data = [ { id: "root", name: "Documentos", type: "folder" } ];
			// Carpeta ya creada por ruta completa, para no repetirla.
			var folderIds = {};
			var idCounter = 1;

			var addFolder = function(entry, parentId) {
				array.forEach(String(entry.text).split(","), function(folderName) {
					folderName = folderName.trim();
					var pathKey = parentId + "/" + folderName;
					if (!folderIds[pathKey]) {
						folderIds[pathKey] = "f" + (idCounter++);
						data.push({ id: folderIds[pathKey], name: folderName, type: "folder", parent: parentId });
					}
					parentId = folderIds[pathKey];
				});

				array.forEach(entry.children || [], function(child) {
					if (child.type === "Virtual") {
						addFolder(child, parentId);
						return;
					}
					data.push({
						id: "d" + (idCounter++),
						name: String(child.text).trim(),
						type: "document",
						parent: parentId,
						viewerUrl: child.viewerUrl || null,
						mimeType: child.mimeType || null,
						data: child.data || null
					});
				});
			};
			array.forEach(response, function(entry) {
				addFolder(entry, "root");
			});

			return data;
		},

		_buildTree: function(treeData) {
			var store = new Memory({
				data: treeData,
				getChildren: function(object) {
					return this.query({ parent: object.id });
				}
			});
			var model = new ObjectStoreModel({
				store: store,
				query: { id: "root" },
				mayHaveChildren: function(item) {
					return item.type === "folder";
				}
			});

			this._destroyTree();
			this.tree = new Tree({
				model: model,
				showRoot: false,
				getIconClass: lang.hitch(this, this._getIconClass),
				onClick: lang.hitch(this, function(item) {
					if (item && item.type === "document") {
						this.getDocumentProperties(item.data, item.name);
					}
				})
			});
			this.tree.placeAt(this.treeNode);
			this.tree.startup();
		},

		_destroyTree: function() {
			if (this.tree) {
				this.tree.destroyRecursive();
				this.tree = null;
			}
			domConstruct.empty(this.treeNode);
		},

		_getIconClass: function(item, opened) {
			if (!item) {
				return "dijitLeaf";
			}
			if (item.type === "folder") {
				return opened ? "dijitFolderOpened" : "dijitFolderClosed";
			}
			if (item.type !== "document") {
				return "dijitLeaf";
			}
			var mimeType = item.mimeType;
			if (!mimeType) {
				mimeType = this.getMimeType("filename." + (this.extractFileExtensionByTextNode(item.name) || "bin"));
			}
			if (mimeType === "application/pdf") {
				return "dqResultsIconPdf";
			} else if (mimeType.indexOf("tif") !== -1) {
				return "dqResultsIconTiff";
			} else if (mimeType.indexOf("png") !== -1) {
				return "dqResultsIconPng";
			} else if (mimeType.indexOf("jpeg") !== -1 || mimeType.indexOf("jpg") !== -1) {
				return "dqResultsIconJpg";
			} else if (mimeType.indexOf("msword") !== -1 || mimeType.indexOf("wordprocessingml") !== -1) {
				return "dqResultsIconDoc";
			} else if (mimeType.indexOf("excel") !== -1 || mimeType.indexOf("spreadsheetml") !== -1) {
				return "dqResultsIconXls";
			}
			return "dqResultsIconFile";
		},

		/**
		 * Propiedades del documento en el grid y el documento en el visor: con bookmark.jsp de ICN o, si está en S3
		 * (file_key y storage_name), su contenido en base64 decodificado en el navegador (DocumentPropertiesService lo
		 * descarga, como /portalUpApp/api/documents/properties de la consulta general). Si tiene file_key_multivalue, el
		 * servidor lo compone en un PDF y lo devuelve en base64 como los de file_key; si la composición tarda más que el timeout, se
		 * avisa al usuario y se espera en segundo plano (_watchComposition). name es el nombre del documento en el árbol.
		 */
		getDocumentProperties: function(doc, name) {
			if (!doc || !doc.objectStoreName || !doc.objId) {
				console.error("DQResults: documento inválido", doc);
				return;
			}
			this._showLoading(true);
			// Si el usuario elige otro documento antes de que llegue la respuesta, solo vale el último.
			var request = this._documentRequest = (this._documentRequest || 0) + 1;
			// Si ya se espera su composición, no se pide otra.
			var waiting = !!(this._compositions && this._compositions[doc.objId]);
			DocumentPropertiesClient.getProperties(doc.objId, waiting ? false : undefined).then(lang.hitch(this, function(data) {
				if (request !== this._documentRequest) {
					return;
				}
				var title = null;
				this._loadGridData(array.map(data.properties || [], function(property, i) {
					if (property.name === "DocumentTitle") {
						title = property.value;
					}
					return { id: i + 1, key: property.label || property.name, value: property.value || "" };
				}));
				if (waiting && !data.composePending) {
					this._endComposition(doc.objId);
				}
				if (!data.s3) {
					// releasedId: se eligió la versión 1 y la serie ya tiene la 2 (el PDF compuesto, con otro Id).
					this._showIcnViewer(data.releasedId ? lang.mixin({}, doc, { objId: data.releasedId }) : doc);
				} else if (data.file) {
					try {
						this.showViewerBase64(data.file, data.mimeType || this.getMimeType(title) || "application/pdf");
					} catch (e) {
						console.error("DQResults: no se pudo mostrar el contenido de S3", e);
						this._showViewerMessage("No se pudo mostrar el documento: " + e.message);
					}
				} else {
					if (data.composePending) {
						this._watchComposition(doc, name || title);
					}
					this._showViewerMessage(data.fileError || "El contenido del documento no está disponible.");
				}
				this._showLoading(false);
			}), lang.hitch(this, function(error) {
				if (request !== this._documentRequest) {
					return;
				}
				this._showLoading(false);
				console.error("DQResults: error consultando propiedades", error);
				this._showAlert("No se pudieron consultar las propiedades del documento: " + error.message);
			}));
		},

		/**
		 * Espera en segundo plano la composición de un documento que tardó más que el timeout: cada COMPOSE_CHECK_MS
		 * pregunta por la versión liberada de su serie y, cuando el workflow crea la versión 2 (el PDF compuesto ya en
		 * FileNet), muestra un aviso con el nombre del documento y un botón para verlo. Sigue aunque el usuario cambie de
		 * feature; se cancela al cambiar de usuario.
		 */
		_watchComposition: function(doc, name) {
			this._compositions = this._compositions || {};
			if (this._compositions[doc.objId]) {
				return;
			}
			this._compositions[doc.objId] = { doc: doc, name: name || "Documento sin título", checks: 0 };
			if (!this._compositionTimer) {
				this._compositionTimer = setInterval(lang.hitch(this, this._checkCompositions), COMPOSE_CHECK_MS);
			}
		},

		_checkCompositions: function() {
			for (var id in this._compositions) {
				if (this._compositions.hasOwnProperty(id) && !this._compositions[id].checking) {
					this._checkComposition(id, this._compositions[id]);
				}
			}
		},

		_checkComposition: function(id, entry) {
			entry.checking = true;
			entry.checks++;
			var giveUp = lang.hitch(this, function() {
				if (entry.checks >= COMPOSE_CHECK_MAX) {
					this._endComposition(id);
					this._showNotice("El documento «" + entry.name + "» sigue en composición. Vuelve a abrirlo más tarde.");
				}
			});
			DocumentPropertiesClient.getReleasedVersion(id).then(lang.hitch(this, function(version) {
				entry.checking = false;
				if (this._compositions[id] !== entry) {
					return; // Cancelada mientras tanto.
				}
				if (version.majorVersion > 1) {
					this._endComposition(id);
					this._showNotice("El documento «" + entry.name + "» ya está disponible.",
						lang.mixin({}, entry.doc, { objId: version.id }), entry.name);
				} else {
					giveUp();
				}
			}), lang.hitch(this, function(error) {
				entry.checking = false;
				if (this._compositions[id] === entry) {
					console.warn("DQResults: no se pudo consultar la versión de " + id, error);
					giveUp();
				}
			}));
		},

		_endComposition: function(id) {
			delete this._compositions[id];
			for (var other in this._compositions) {
				if (this._compositions.hasOwnProperty(other)) {
					return;
				}
			}
			clearInterval(this._compositionTimer);
			this._compositionTimer = null;
		},

		_stopCompositions: function() {
			clearInterval(this._compositionTimer);
			this._compositionTimer = null;
			this._compositions = {};
			if (this._noticesNode) {
				domConstruct.destroy(this._noticesNode);
				this._noticesNode = null;
			}
		},

		/**
		 * Aviso flotante (abajo a la derecha, sobre cualquier feature) que queda hasta que el usuario lo cierra; con doc,
		 * un botón "Ver" abre el documento en este feature. Van en <body>, como los diálogos.
		 */
		_showNotice: function(text, doc, name) {
			if (!this._noticesNode) {
				this._noticesNode = domConstruct.create("div", { "class": "dqNotices", role: "status" }, document.body);
			}
			var notice = domConstruct.create("div", { "class": "dqNotice" }, this._noticesNode);
			domConstruct.create("span", { "class": "dqNoticeText", textContent: text }, notice);
			if (doc) {
				var open = domConstruct.create("button", { type: "button", "class": "dqNoticeAction", textContent: "Ver" }, notice);
				on(open, "click", lang.hitch(this, function() {
					domConstruct.destroy(notice);
					this._selectPane();
					this.getDocumentProperties(doc, name);
				}));
			}
			var close = domConstruct.create("button", {
				type: "button", "class": "dqNoticeClose", title: "Cerrar", "aria-label": "Cerrar", textContent: "\u00d7"
			}, notice);
			on(close, "click", function() {
				domConstruct.destroy(notice);
			});
		},

		// Abre este feature si el usuario está en otro: con el botón de la barra (estilo "toolbar"); en el estilo
		// "flyout" no hay botón y el documento queda cargado para cuando lo abra.
		_selectPane: function() {
			if (this.selected) {
				return;
			}
			var bar = array.filter(registry.toArray(), function(widget) {
				return widget.declaredClass === "ecm.widget.layout.LaunchBarContainer";
			})[0];
			var button = bar && bar.getButtonByID(FEATURE_ID);
			if (button) {
				(button.focusNode || button.domNode).click();
			}
		},

		_showViewerMessage: function(message) {
			this._clearViewer();
			domConstruct.create("div", { "class": "dqResultsViewerMessage", textContent: message }, this.viewerNode);
		},

		_showIcnViewer: function(doc) {
			this._clearViewer();
			var url = "/navigator/bookmark.jsp?desktop=" + encodeURIComponent(VIEWER_DESKTOP) +
				"&feature=BookmarkLayout&repositoryId=" + encodeURIComponent(doc.objectStoreName) +
				"&repositoryType=p8&docid=" + encodeURIComponent(doc.objId) + "&embedded=true";
			domConstruct.create("iframe", { src: url, "class": "dqResultsViewerFrame" }, this.viewerNode);
			this._setDetachSource(url);
		},

		/**
		 * Muestra un documento en base64: TIFF dibujado en un canvas (UTIF), PDF en un iframe y el resto como imagen.
		 * PDF e imágenes van como blob: (la Content-Security-Policy de ICN no permite data:).
		 */
		showViewerBase64: function(base64Data, mimeType) {
			mimeType = mimeType || "image/png";
			this._clearViewer();
			var bytes = base64ToBytes(base64Data);

			if (mimeType === "image/tiff" || mimeType === "image/tif") {
				var UTIF = window.UTIF;
				var ifds = UTIF.decode(bytes);
				UTIF.decodeImage(bytes, ifds[0]); // Solo la primera página.
				var rgba = UTIF.toRGBA8(ifds[0]);
				var canvas = domConstruct.create("canvas", { width: ifds[0].width, height: ifds[0].height }, this.viewerNode);
				canvas.getContext("2d").putImageData(
					new ImageData(new Uint8ClampedArray(rgba), ifds[0].width, ifds[0].height), 0, 0);
				// El navegador no muestra TIFF: la pestaña nueva recibe la página como PNG.
				canvas.toBlob(lang.hitch(this, function(png) {
					if (png && canvas.parentNode) { // Sin parentNode, ya se eligió otro documento.
						this._setDetachSource(png);
					}
				}), "image/png");
				return;
			}

			var blob = new Blob([ bytes ], { type: mimeType });
			this._setDetachSource(blob);
			this._viewerUrl = URL.createObjectURL(blob);
			if (mimeType === "application/pdf") {
				domConstruct.create("iframe", { src: this._viewerUrl, "class": "dqResultsViewerFrame" }, this.viewerNode);
			} else {
				domConstruct.create("img", { src: this._viewerUrl, "class": "dqResultsViewerImage" }, this.viewerNode);
			}
		},

		_clearViewer: function() {
			this._revokeViewerUrl();
			this._setDetachSource(null);
			domConstruct.empty(this.viewerNode);
		},

		// source: URL de bookmark.jsp o Blob con el contenido del documento que muestra el visor; null si no hay.
		_setDetachSource: function(source) {
			this._detachSource = source;
			this.detachButton.set("disabled", !source);
		},

		_onDetach: function() {
			var url = this._detachSource;
			if (!url) {
				return;
			}
			if (typeof url !== "string") {
				// blob: propio: _clearViewer revoca el del visor en cuanto se elige otro documento.
				this._revokeDetachedUrl();
				url = this._detachedUrl = URL.createObjectURL(url);
			}
			var win = window.open(url, DETACHED_WINDOW);
			if (win) {
				win.focus();
			} else {
				this._showAlert("El navegador bloqueó la pestaña nueva. Permita las ventanas emergentes de este sitio.");
			}
		},

		_revokeDetachedUrl: function() {
			if (this._detachedUrl) {
				URL.revokeObjectURL(this._detachedUrl);
				this._detachedUrl = null;
			}
		},

		_revokeViewerUrl: function() {
			if (this._viewerUrl) {
				URL.revokeObjectURL(this._viewerUrl);
				this._viewerUrl = null;
			}
		},

		_loadGridData: function(rows) {
			this._gridStore.setData(rows);
			this.grid.setStore(new ObjectStore({ objectStore: this._gridStore }));
			this.grid.resize();
		},

		_showLoading: function(show) {
			domClass.toggle(this.loadingNode, "dqResultsLoadingVisible", show);
		},

		_showAlert: function(message) {
			new MessageDialog({ text: message }).show();
		},

		_clearScreen: function() {
			this._destroyTree();
			this._loadGridData([]);
			this._clearViewer();
		},

		getMimeType: function(filename) {
			if (typeof filename !== "string" || filename.indexOf(".") === -1) {
				return null;
			}
			return MIME_TYPES[filename.split(".").pop().toLowerCase()] || "application/octet-stream";
		},

		// Extensión a partir del nombre del nodo, que la trae entre corchetes: "Nombre [archivo.pdf]".
		extractFileExtensionByTextNode: function(text) {
			var match = /\[.*?\.([a-zA-Z0-9]+)\]/.exec(text || "");
			return match ? match[1].toLowerCase() : null;
		}
	});
});
