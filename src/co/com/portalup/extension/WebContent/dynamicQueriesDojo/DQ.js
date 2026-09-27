define([
	"dojo/_base/declare",
	"dojo/_base/lang",
	"dojo/_base/array",
	"dojo/aspect",
	"dojo/dom-class",
	"dojo/dom-construct",
	"dojo/store/Memory",
	"dijit/registry",
	"dijit/Menu",
	"dijit/MenuItem",
	"dijit/tree/ObjectStoreModel",
	"dijit/Tree",
	"ecm/model/Desktop",
	"ecm/widget/dialog/ConfirmationDialog",
	"ecm/widget/dialog/MessageDialog",
	"ecm/widget/layout/_LaunchBarPane",
	"dynamicQueriesDojo/QuerySerializer",
	"dynamicQueriesDojo/QueryStoreClient",
	"dynamicQueriesDojo/QueryTab",
	"dojo/text!./templates/DQ.html",
	"idx/layout/BorderContainer",
	"dijit/layout/ContentPane",
	"dijit/layout/StackContainer",
	"dijit/layout/TabContainer"
],
function(declare,
		lang,
		array,
		aspect,
		domClass,
		domConstruct,
		Memory,
		registry,
		Menu,
		MenuItem,
		ObjectStoreModel,
		Tree,
		Desktop,
		ConfirmationDialog,
		MessageDialog,
		_LaunchBarPane,
		QuerySerializer,
		QueryStoreClient,
		QueryTab,
		template) {

	var MAX_TREE_QUERIES = 500;

	// Carpeta única del árbol; se llena con las consultas que devuelve el servicio de consultas.
	var ROOT_ITEMS = [
		{ id: "root", name: "Consultas", type: "root" },
		{ id: "saved", name: "Consultas guardadas", type: "folder", parent: "root" }
	];

	/**
	 * @name dynamicQueriesDojo.DQ
	 * @class Feature pane de consultas dinámicas: repositorio configurado y consultas guardadas a la izquierda, una
	 *        pestaña por consulta en el centro.
	 * @augments ecm.widget.layout._LaunchBarPane
	 */
	return declare("dynamicQueriesDojo.DQ", [
		_LaunchBarPane
	], {
		/** @lends dynamicQueriesDojo.DQ.prototype */

		templateString: template,

		// Set to true if widget template contains DOJO widgets.
		widgetsInTemplate: true,

		// ecm.model.Repository configurado en el plug-in (repositoryId); null hasta cargar la configuración.
		repository: null,

		postCreate: function() {
			this.logEntry("postCreate");
			this.inherited(arguments);

			this.own(aspect.after(this.tabContainer, "removeChild", lang.hitch(this, this._updateCenterView)));
			this._createTreeMenu();
			this.setTreeItems([]);

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
				this._loadRepository();
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

		/**
		 * Recarga "Consultas guardadas" con las consultas que devuelve el servicio de consultas.
		 */
		refreshTree: function() {
			return QueryStoreClient.listQueries({ sort: "name", limit: MAX_TREE_QUERIES }).then(lang.hitch(this, function(page) {
				this.setTreeItems(array.map(page.items, function(query) {
					return { id: "q:" + query.id, name: query.name, type: "query", parent: "saved", queryId: query.id };
				}));
				this.treeMessageNode.textContent = page.total > page.items.length ?
					"Se muestran las primeras " + page.items.length + " de " + page.total + " consultas." : "";
			}), lang.hitch(this, function(error) {
				this.treeMessageNode.textContent = "No se pudieron cargar las consultas: " + error.message;
			}));
		},

		// El repositorio es el configurado en el plug-in (repositoryId); debe estar en el escritorio. Las demás
		// llamadas al servicio lo necesitan, por eso el árbol se carga después.
		_loadRepository: function() {
			QueryStoreClient.getSettings().then(lang.hitch(this, function(settings) {
				if (!settings.repositoryId) {
					this._showRepositoryProblem("El administrador no ha configurado el repositorio de las consultas.");
					return;
				}
				var repository = Desktop.getRepository(settings.repositoryId);
				if (!repository) {
					this._showRepositoryProblem("El repositorio \u201c" + settings.repositoryId +
						"\u201d no está disponible en este escritorio.");
					return;
				}
				this.repository = repository;
				QueryStoreClient.repositoryId = repository.id;
				this.repositoryNameNode.textContent = repository.name;
				domClass.remove(this.newQueryLink, "dqDisabled");
				this.newQueryLink.removeAttribute("aria-disabled");
				this.refreshTree();
			}), lang.hitch(this, function(error) {
				this._showRepositoryProblem("No se pudo leer la configuración del plug-in: " + error.message);
			}));
		},

		_showRepositoryProblem: function(message) {
			domClass.add(this.repositoryNameNode, "dqRepositoryError");
			this.repositoryNameNode.textContent = message;
		},

		/**
		 * Abre una consulta guardada en una pestaña; con run la ejecuta al terminar de cargar. Si ya está abierta,
		 * selecciona esa pestaña.
		 */
		openSavedQuery: function(queryId, run) {
			var openTab = this._findQueryTab(queryId);
			if (openTab) {
				this.tabContainer.selectChild(openTab);
				if (run) {
					openTab.runSearch();
				}
				return;
			}
			QueryStoreClient.getQuery(queryId).then(lang.hitch(this, function(query) {
				var repository = Desktop.getRepository(query.definition.repository.id);
				if (!repository) {
					this._showError("El repositorio \u201c" + query.definition.repository.id +
						"\u201d de la consulta no está disponible en este escritorio.");
					return;
				}
				var searchTemplate;
				try {
					searchTemplate = QuerySerializer.toSearchTemplate(query.definition, repository, query.name);
				} catch (e) {
					this._showError(e.message);
					return;
				}
				this.openQueryTab(repository, searchTemplate, {
					savedQuery: query,
					initialResultsDisplay: searchTemplate.resultsDisplay,
					runOnOpen: !!run
				});
			}), lang.hitch(this, function(error) {
				this._showError(error.message);
			}));
		},

		/**
		 * Reemplaza las consultas del árbol. Cada item es { id, name, type: "query", parent: "saved", queryId }.
		 */
		setTreeItems: function(items) {
			this._renderTree(ROOT_ITEMS.concat(items || []));
		},

		/**
		 * Abre una pestaña de consulta. Sin searchTemplate, el constructor crea una búsqueda nueva sobre el repositorio.
		 * options: { savedQuery, initialResultsDisplay, runOnOpen } (ver QueryTab).
		 */
		openQueryTab: function(repository, searchTemplate, options) {
			options = options || {};
			var title = options.savedQuery ? options.savedQuery.name :
				searchTemplate && !searchTemplate.isNew() ? searchTemplate.name : this._nextNewQueryTitle();
			var tab = new QueryTab(lang.mixin({
				title: title,
				closable: true,
				"class": "ecmCommonNoPadding",
				repository: repository,
				searchTemplate: searchTemplate,
				parentPane: this,
				tabContainer: this
			}, options));
			tab.own(tab.on("querySaved", lang.hitch(this, this.refreshTree)));
			this.tabContainer.addChild(tab);
			this._updateCenterView();
			this.tabContainer.selectChild(tab);
			return tab;
		},

		/**
		 * El constructor de ICN espera en tabContainer un SearchTabContainer; solo usa closeTab (botón Cancelar).
		 */
		closeTab: function(tab) {
			this.tabContainer.closeChild(tab);
		},

		/**
		 * El constructor de ICN usa parentPane.openTab / openSearch cuando se abre una búsqueda guardada desde los
		 * resultados; se abre en una pestaña de DQ.
		 */
		openTab: function(params) {
			if (params && params.searchTemplate) {
				this.openQueryTab(params.repository, params.searchTemplate);
			}
		},

		openSearch: function(tabType, repository, uid, searchTemplate) {
			this.openQueryTab(repository, searchTemplate);
		},

		_onNewQueryClick: function(evt) {
			evt.preventDefault();
			if (this.repository) {
				this.openQueryTab(this.repository);
			}
		},

		_findQueryTab: function(queryId) {
			return array.filter(this.tabContainer.getChildren(), function(tab) {
				return tab.savedQuery && tab.savedQuery.id === queryId;
			})[0];
		},

		_deleteSavedQuery: function(item) {
			var dialog = new ConfirmationDialog({
				text: "¿Eliminar la consulta \u201c" + item.name + "\u201d? Esta acción no se puede deshacer.",
				buttonLabel: "Eliminar",
				cancelButtonDefault: true,
				onExecute: lang.hitch(this, function() {
					QueryStoreClient.deleteQuery(item.queryId).then(lang.hitch(this, function() {
						var openTab = this._findQueryTab(item.queryId);
						if (openTab) {
							this.tabContainer.closeChild(openTab);
						}
						this.refreshTree();
					}), lang.hitch(this, function(error) {
						this._showError(error.message);
					}));
				})
			});
			dialog.show();
		},

		_showError: function(message) {
			new MessageDialog({ text: message }).show();
		},

		// Menú contextual de las consultas del árbol. Se asocia al contenedor, que no cambia al volver a dibujar el árbol.
		_createTreeMenu: function() {
			var menu = new Menu({ targetNodeIds: [ this.treeNode ], selector: ".dijitTreeRow" });
			var itemFor = lang.hitch(this, function() {
				var treeNode = registry.getEnclosingWidget(menu.currentTarget);
				return treeNode && treeNode.item && treeNode.item.type === "query" ? treeNode.item : null;
			});
			var actions = [
				{ label: "Abrir", run: lang.hitch(this, function(item) { this.openSavedQuery(item.queryId, false); }) },
				{ label: "Ejecutar", run: lang.hitch(this, function(item) { this.openSavedQuery(item.queryId, true); }) },
				{ label: "Eliminar", run: lang.hitch(this, this._deleteSavedQuery) }
			];
			var menuItems = array.map(actions, function(action) {
				var menuItem = new MenuItem({
					label: action.label,
					onClick: function() {
						var item = itemFor();
						if (item) {
							action.run(item);
						}
					}
				});
				menu.addChild(menuItem);
				return menuItem;
			});
			this.own(menu, aspect.after(menu, "_openMyself", function() {
				var enabled = !!itemFor();
				array.forEach(menuItems, function(menuItem) {
					menuItem.set("disabled", !enabled);
				});
			}, true));
			menu.startup();
		},

		_nextNewQueryTitle: function() {
			this._newQueryCount = (this._newQueryCount || 0) + 1;
			return this._newQueryCount === 1 ? "Nueva consulta" : "Nueva consulta " + this._newQueryCount;
		},

		// Muestra las pestañas si hay alguna abierta; si no, el estado vacío.
		_updateCenterView: function() {
			var hasTabs = this.tabContainer.getChildren().length > 0;
			this.centerStack.selectChild(hasTabs ? this.tabContainer : this.emptyPane);
		},

		_renderTree: function(treeItems) {
			var store = new Memory({
				data: treeItems,
				getChildren: function(object) {
					return this.query({ parent: object.id });
				}
			});
			var model = new ObjectStoreModel({
				store: store,
				query: { id: "root" },
				mayHaveChildren: function(item) {
					return item.type !== "query";
				}
			});

			if (this._tree) {
				this._tree.destroyRecursive();
			}
			domConstruct.empty(this.treeNode);

			this._tree = new Tree({
				model: model,
				showRoot: false,
				openOnClick: true,
				autoExpand: true,
				"aria-label": "Consultas guardadas",
				onClick: lang.hitch(this, function(item) {
					if (item.type === "query") {
						this.openSavedQuery(item.queryId, false);
					}
				}),
				getIconClass: function(item, opened) {
					if (item.type === "query") {
						return "dqQueryIcon";
					}
					return opened ? "dijitFolderOpened" : "dijitFolderClosed";
				}
			});
			this._tree.placeAt(this.treeNode);
			this._tree.startup();
		}
	});
});
