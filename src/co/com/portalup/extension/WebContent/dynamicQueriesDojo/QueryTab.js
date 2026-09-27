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
	"ecm/widget/listView/modules/Toolbar2",
	"dynamicQueriesDojo/QuerySerializer",
	"dynamicQueriesDojo/SaveQueryDialog"
],
function(declare, lang, array, aspect, domClass, domConstruct, Dialog, Button, SearchBuilder, Toolbar2,
		QuerySerializer, SaveQueryDialog) {

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

		// Consulta guardada que muestra la pestaña ({ id, version, name, description }); null si es nueva.
		savedQuery: null,

		// Visualización de resultados guardada ({ columns, sortBy, sortAsc }): el constructor la reemplaza por la
		// predeterminada al cargar la clase, así que se vuelve a aplicar después.
		initialResultsDisplay: null,

		// true para ejecutar la búsqueda apenas el formulario termine de cargar ("Ejecutar" desde el árbol).
		runOnOpen: false,

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

			var viewJsonButton = new Button({
				label: "Ver JSON",
				onClick: lang.hitch(this, this._showJson)
			});
			this.own(viewJsonButton);
			viewJsonButton.placeAt(searchDefinition.cancelButton.domNode, "after");

			if (this.initialResultsDisplay || this.runOnOpen) {
				// El formulario queda listo cuando ICN fija la visualización de resultados de la clase (verificado en
				// ICN 3.0.10: setContentClass y enseguida setResultsDisplay con la predeterminada).
				var resultsDisplayOptions = searchDefinition.resultsDisplayOptions;
				var formReady = aspect.after(resultsDisplayOptions, "setResultsDisplay", lang.hitch(this, function() {
					formReady.remove();
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
			return QuerySerializer.serialize(this.searchDefinition, this.repository);
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
