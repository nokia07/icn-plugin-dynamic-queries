define([
	"dojo/_base/declare",
	"dojo/_base/lang",
	"dojo/_base/array",
	"dojo/aspect",
	"dojo/dom-class",
	"dojo/dom-construct",
	"dijit/Dialog",
	"dijit/form/Button",
	"ecm/widget/search/SearchBuilder",
	"ecm/widget/search/BasicSearchDefinition",
	"ecm/widget/listView/modules/Toolbar2",
	"dynamicQueriesDojo/QuerySerializer",
	"dynamicQueriesDojo/SaveQueryDialog",
	"dynamicQueriesDojo/ParametersDialog"
],
function(declare, lang, array, aspect, domClass, domConstruct, Dialog, Button, SearchBuilder, BasicSearchDefinition,
		Toolbar2, QuerySerializer, SaveQueryDialog, ParametersDialog) {

	// ICN ignora la clase de una búsqueda nueva (isNew(), id "NewSearch_…"): _initContentClassSelector elige la primera
	// del árbol (Document) y, aunque mantiene las condiciones, la consulta reabierta queda sobre otra clase. Elegir la
	// clase después no sirve (ICN rehace el formulario y borra las condiciones), y un id no nuevo hace que ICN busque y
	// bloquee la plantilla en P8. Por eso, solo para las plantillas de QuerySerializer.toSearchTemplate (dqRestoreClass)
	// y solo mientras se inicializa el selector, la plantilla se presenta como no nueva: ICN selecciona su clase y luego
	// dibuja las condiciones, como con sus búsquedas guardadas. Verificado en ICN 3.0.10.
	aspect.around(BasicSearchDefinition.prototype, "_initContentClassSelector", function(original) {
		return function(reset) {
			var template = this.searchTemplate;
			if (!template || !template.dqRestoreClass || reset) {
				return original.apply(this, arguments);
			}
			template.isNew = function() {
				return false;
			};
			try {
				return original.apply(this, arguments);
			} finally {
				delete template.isNew;
			}
		};
	});

	// Acciones de la barra de resultados que DQ no ofrece (ids verificados en ICN 3.0.10): "Añadir documento" y
	// "Exportar todo". "Acciones" se quita con la opción showActionsButton del módulo.
	var HIDDEN_RESULT_ACTIONS = { Import: true, ExportAll: true };

	// Oculta las acciones anteriores y los separadores que queden sin un botón visible a cada lado.
	function hideResultActions(toolbar) {
		var children = toolbar.getChildren();
		array.forEach(children, function(child) {
			if (child.action && HIDDEN_RESULT_ACTIONS[child.action.id]) {
				domClass.add(child.domNode, "dqHiddenAction");
			}
		});
		var visible = function(child) {
			return !/Separator/.test(child.declaredClass) && !domClass.contains(child.domNode, "dqHiddenAction") &&
				child.domNode.style.display !== "none";
		};
		array.forEach(children, function(child, i) {
			if (/Separator/.test(child.declaredClass) &&
					!(array.some(children.slice(0, i), visible) && array.some(children.slice(i + 1), visible))) {
				domClass.add(child.domNode, "dqHiddenAction");
			}
		});
	}

	// Deja el desplegable de clases solo con el árbol e "Incluir subclases": quita "Buscar en varias clases" e "Incluir
	// todas las propiedades". ICN crea esas casillas antes de QueryTab.postCreate y otros métodos del selector las usan
	// sin comprobar que existan, así que no se destruyen: se ocultan con su etiqueta y ayuda, y quedan desmarcadas y
	// deshabilitadas para que su onChange (el modo de varias clases) no pueda dispararse. dijitHidden y no
	// dqHiddenAction: el desplegable se abre fuera de .dqPane.
	function simplifyClassSelector(classSelector) {
		array.forEach([
			{ checkBox: classSelector._multipleClassesChk, areaClass: "multClassChkBoxArea" },
			{ checkBox: classSelector._includeAllPropertiesChk, areaClass: "includeAllPropertiesArea" }
		], function(option) {
			if (!option.checkBox) {
				return;
			}
			option.checkBox.set("checked", false);
			option.checkBox.set("disabled", true);
			for (var area = option.checkBox.domNode; area; area = area.parentNode) {
				if (domClass.contains(area, option.areaClass)) {
					domClass.add(area, "dijitHidden");
					break;
				}
			}
		});
	}

	// Configura el módulo Toolbar2 dentro de la estructura de módulos de la lista de resultados.
	function configureResultsToolbar(node) {
		if (lang.isArray(node)) {
			array.forEach(node, configureResultsToolbar);
		} else if (node && typeof node === "object") {
			if (node.moduleClass === Toolbar2) {
				node.showActionsButton = false;
				node.onToolbarButtonsCreated = function() {
					hideResultActions(this.toolbar);
				};
			}
			for (var key in node) {
				if (key !== "moduleClass" && node[key] && typeof node[key] === "object") {
					configureResultsToolbar(node[key]);
				}
			}
		}
	}

	/**
	 * @name dynamicQueriesDojo.QueryTab
	 * @class Pestaña de una consulta: el constructor de búsqueda nativo de ICN (criterios, Buscar y resultados) sin
	 *        las opciones de guardar en P8 (las consultas de DQ se guardan en el servicio externo) ni "Buscar en" /
	 *        "Opciones de búsqueda" (siempre desde la raíz, documentos, versión de release).
	 *        Ver docs/icn-search-api.md.
	 * @augments ecm.widget.search.SearchBuilder
	 */
	return declare("dynamicQueriesDojo.QueryTab", [ SearchBuilder ], {
		/** @lends dynamicQueriesDojo.QueryTab.prototype */

		// Consulta guardada que muestra la pestaña ({ id, name, status, cesql, config, ... } del servicio); null si es
		// nueva.
		savedQuery: null,

		// Visualización de resultados guardada ({ columns, sortBy, sortAsc }): el constructor la reemplaza por la
		// predeterminada al cargar la clase, así que se vuelve a aplicar después.
		initialResultsDisplay: null,

		// true para ejecutar la búsqueda apenas el formulario termine de cargar ("Ejecutar" desde el árbol).
		runOnOpen: false,

		// Comodines de la consulta: { clave: nombre } (claves de QuerySerializer.getConditions). Al abrir una consulta
		// guardada vienen de su definición.
		parameters: null,

		postCreate: function() {
			this.inherited(arguments);
			var searchDefinition = this.searchDefinition;
			// Con clase y no con estilo en línea: Restablecer vuelve a mostrar estos botones.
			domClass.add(searchDefinition.saveButton.domNode, "dqHiddenAction");
			domClass.add(searchDefinition.saveAsButton.domNode, "dqHiddenAction");
			// Fila "Buscar en" + "Opciones de búsqueda" (la misma celda searchOptionContainer): las consultas de DQ
			// siempre buscan documentos, versión de release, desde la raíz con subcarpetas, que son los valores
			// predeterminados del constructor. Se ocultan en vez de quitarse porque el constructor los sigue usando.
			domClass.add(searchDefinition.searchOptionContainer.parentNode, "dqHiddenAction");
			// "Visualización de resultados" y la casilla "Mostrar todas las propiedades" (con su etiqueta).
			domClass.add(searchDefinition.resultsDisplayButton.domNode, "dqHiddenAction");
			domClass.add(searchDefinition._displayAllPropsArea, "dqHiddenAction");
			var classSelector = searchDefinition.contentClassSelector;
			simplifyClassSelector(classSelector);
			this.own(aspect.after(classSelector, "_createDropDown", function() {
				simplifyClassSelector(classSelector);
			}, true));

			var saveQueryButton = new Button({
				label: "Guardar consulta",
				onClick: lang.hitch(this, this._showSaveDialog)
			});
			this.own(saveQueryButton);
			saveQueryButton.placeAt(searchDefinition.saveAsButton.domNode, "after");

			this._parametersButton = new Button({
				onClick: lang.hitch(this, this._showParametersDialog)
			});
			this.own(this._parametersButton);
			this._parametersButton.placeAt(saveQueryButton.domNode, "after");
			this._setParameters(this.parameters || {});

			var viewJsonButton = new Button({
				label: "Ver JSON",
				onClick: lang.hitch(this, this._showJson)
			});
			this.own(viewJsonButton);
			viewJsonButton.placeAt(searchDefinition.cancelButton.domNode, "after");

			var restoredClass = this.searchTemplate && this.searchTemplate.dqRestoreClass;
			if (this.initialResultsDisplay || this.runOnOpen || restoredClass) {
				// El formulario queda listo cuando ICN fija la visualización de resultados de la clase (verificado en
				// ICN 3.0.10: setContentClass y enseguida setResultsDisplay con la predeterminada).
				var resultsDisplayOptions = searchDefinition.resultsDisplayOptions;
				var formReady = aspect.after(resultsDisplayOptions, "setResultsDisplay", lang.hitch(this, function() {
					formReady.remove();
					if (restoredClass) {
						this._restoreIncludeSubclasses();
					}
					if (this.initialResultsDisplay) {
						resultsDisplayOptions.setResultsDisplay(lang.clone(this.initialResultsDisplay));
					}
					if (this.runOnOpen) {
						this.runSearch();
					}
				}), true);
				this.own(formReady);
			}
		},

		// Al restaurar la clase, ICN deja marcado "Incluir subclases" aunque la plantilla diga lo contrario. Cambiarlo
		// no rehace el formulario, pero la etiqueta del selector ("Clase (Incluye subclases)") no se actualiza sola.
		_restoreIncludeSubclasses: function() {
			var classSelector = this.searchDefinition.contentClassSelector;
			var includeSubclasses = !!this.searchTemplate.dqIncludeSubclasses;
			if (classSelector.isIncludeSubclasses() !== includeSubclasses && classSelector.getSelected()) {
				classSelector.setIncludeSubclasses(includeSubclasses);
				if (!includeSubclasses) {
					classSelector._setSelectedItemLabel(classSelector.getSelected());
				}
			}
		},

		/**
		 * Módulos de la lista de resultados de ICN, sin "Añadir documento", "Exportar todo" ni "Acciones".
		 */
		getContentListModules: function() {
			var modules = this.inherited(arguments);
			configureResultsToolbar(modules);
			return modules;
		},

		// dijit/layout/TabContainer.closeChild solo cierra la pestaña si onClose devuelve true; SearchBuilder no lo
		// define porque en ICN lo cierra SearchTabContainer.
		onClose: function() {
			return true;
		},

		/**
		 * Ejecuta la búsqueda como el botón Buscar. En ICN 3.0.10 BasicSearchDefinition._search lanza
		 * "Cannot read properties of undefined (reading 'onRequestCompleted')" después de enviar la búsqueda (también
		 * en la búsqueda nativa; ver docs/icn-search-api.md): se registra para que no interrumpa a quien llama.
		 */
		runSearch: function() {
			try {
				this.searchDefinition._search();
			} catch (e) {
				this.logWarning("runSearch", "Error de ICN al lanzar la búsqueda: " + e.message);
			}
		},

		/**
		 * Definición de la consulta según el contrato de la API: { definition, errors }.
		 */
		getQueryDefinition: function() {
			return QuerySerializer.serialize(this.searchDefinition, this.repository, this.parameters);
		},

		_setParameters: function(parameters) {
			this.parameters = parameters;
			var count = 0;
			for (var key in parameters) {
				count++;
			}
			this._parametersButton.set("label", count ? "Comodines (" + count + ")" : "Comodines");
		},

		_showParametersDialog: function() {
			var dialog = new ParametersDialog({
				// Con los nombres visibles de las condiciones, que la definición que se guarda no lleva.
				definition: QuerySerializer.serialize(this.searchDefinition, this.repository, this.parameters, true).definition,
				parameters: this.parameters
			});
			dialog.own(dialog.on("apply", lang.hitch(this, this._setParameters)), dialog.on("hide", function() {
				dialog.destroyRecursive();
			}));
			dialog.show();
		},

		_showSaveDialog: function() {
			var result = this.getQueryDefinition();
			var dialog = new SaveQueryDialog({
				query: lang.mixin({}, this.savedQuery, { definition: result.definition }),
				definitionErrors: result.errors
			});
			dialog.own(dialog.on("saved", lang.hitch(this, this._onQuerySaved)), dialog.on("hide", function() {
				dialog.destroyRecursive();
			}));
			dialog.show();
		},

		_onQuerySaved: function(savedQuery) {
			this.savedQuery = savedQuery;
			this.set("title", savedQuery.name);
			this.onQuerySaved(savedQuery);
		},

		/**
		 * Se invoca después de guardar la consulta en el servicio, con la consulta tal como la devolvió.
		 */
		onQuerySaved: function(savedQuery) {
		},

		_showJson: function() {
			var result = this.getQueryDefinition();
			var content = domConstruct.create("div", { "class": "dqJsonContent" });
			if (result.errors.length) {
				domConstruct.create("p", { "class": "dqJsonErrorsTitle", textContent: "La consulta todavía no es válida:" }, content);
				var list = domConstruct.create("ul", { "class": "dqJsonErrors" }, content);
				array.forEach(result.errors, function(error) {
					domConstruct.create("li", { textContent: error }, list);
				});
			}
			if (!result.errors.length) {
				var cesql;
				try {
					cesql = QuerySerializer.toCeSql(result.definition);
				} catch (e) {
					cesql = "No se pudo generar el CE SQL: " + e.message;
				}
				domConstruct.create("p", { "class": "dqJsonLabel", textContent: "CE SQL:" }, content);
				domConstruct.create("pre", { "class": "dqJson dqCesql", textContent: cesql }, content);
				domConstruct.create("p", { "class": "dqJsonLabel", textContent: "Definición (config):" }, content);
			}
			domConstruct.create("pre", { "class": "dqJson", textContent: JSON.stringify(result.definition, null, 2) }, content);

			var dialog = new Dialog({ title: "Definición de la consulta", "class": "dqJsonDialog", content: content });
			// El tema de ICN oculta la X de dijit/Dialog.
			var actionBar = domConstruct.create("div", { "class": "dijitDialogPaneActionBar" }, content);
			var closeButton = new Button({
				label: "Cerrar",
				onClick: function() {
					dialog.hide();
				}
			});
			closeButton.placeAt(actionBar);
			dialog.own(closeButton, dialog.on("hide", function() {
				dialog.destroyRecursive();
			}));
			dialog.show();
		}
	});
});
