define([
	"dojo/_base/declare",
	"dojo/_base/lang",
	"dojo/_base/array",
	"dojo/aspect",
	"dojo/dom-construct",
	"dojo/store/Memory",
	"dijit/tree/ObjectStoreModel",
	"dijit/Tree",
	"ecm/widget/layout/_LaunchBarPane",
	"ecm/widget/layout/_RepositorySelectorMixin",
	"dynamicQueriesDojo/QueryTab",
	"dojo/text!./templates/DQ.html",
	"idx/layout/BorderContainer",
	"dijit/layout/ContentPane",
	"dijit/layout/StackContainer",
	"dijit/layout/TabContainer",
	"dijit/form/TextBox"
],
function(declare,
		lang,
		array,
		aspect,
		domConstruct,
		Memory,
		ObjectStoreModel,
		Tree,
		_LaunchBarPane,
		_RepositorySelectorMixin,
		QueryTab,
		template) {

	// Carpetas fijas del árbol. Las categorías y consultas guardadas se cuelgan de ellas (Fase 5).
	var ROOT_ITEMS = [
		{ id: "root", name: "Consultas", type: "root" },
		{ id: "recent", name: "Consultas recientes", type: "folder", parent: "root" },
		{ id: "categories", name: "Categorías", type: "folder", parent: "root" }
	];

	/**
	 * @name dynamicQueriesDojo.DQ
	 * @class Feature pane de consultas dinámicas: árbol de consultas a la izquierda y una pestaña por consulta
	 *        en el centro.
	 * @augments ecm.widget.layout._LaunchBarPane
	 */
	return declare("dynamicQueriesDojo.DQ", [
		_LaunchBarPane,
		_RepositorySelectorMixin
	], {
		/** @lends dynamicQueriesDojo.DQ.prototype */

		templateString: template,

		// Set to true if widget template contains DOJO widgets.
		widgetsInTemplate: true,

		// Items del árbol (carpetas, categorías y consultas) sin filtrar.
		_treeItems: null,

		postCreate: function() {
			this.logEntry("postCreate");
			this.inherited(arguments);

			this._createRepositorySelector();
			this.own(aspect.after(this.tabContainer, "removeChild", lang.hitch(this, this._updateCenterView)));
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

			if (!this.repository) {
				this.setPaneDefaultLayoutRepository();
			}
			if (!this.isLoaded) {
				this.isLoaded = true;
				this.needReset = false;
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
		 * Reemplaza las categorías y consultas del árbol. Cada item es { id, name, type: "category"|"query", parent },
		 * donde parent es "recent", "categories" o el id de una categoría.
		 */
		setTreeItems: function(items) {
			this._treeItems = ROOT_ITEMS.concat(items || []);
			this._renderTree(this.filterBox.get("value"));
		},

		// La API de _RepositorySelectorMixin debe confirmarse contra la versión de ICN del ambiente (Fase 0);
		// si falla, el panel sigue funcionando con el repositorio por defecto del escritorio.
		_createRepositorySelector: function() {
			try {
				this.setRepositoryTypes("p8");
				this.createRepositorySelector();
				this.doRepositorySelectorConnections();
				this.repositorySelector.placeAt(this.repositorySelectorArea);
			} catch (e) {
				this.logError("_createRepositorySelector", "No se pudo crear el selector de repositorio", e);
			}
		},

		_onNewQueryClick: function(evt) {
			evt.preventDefault();
			var tab = new QueryTab({
				title: "Nueva consulta",
				closable: true,
				repository: this.repository
			});
			this.tabContainer.addChild(tab);
			this._updateCenterView();
			this.tabContainer.selectChild(tab);
		},

		_onFilterChange: function(value) {
			this._renderTree(value);
		},

		// Muestra las pestañas si hay alguna abierta; si no, el estado vacío.
		_updateCenterView: function() {
			var hasTabs = this.tabContainer.getChildren().length > 0;
			this.centerStack.selectChild(hasTabs ? this.tabContainer : this.emptyPane);
		},

		_renderTree: function(filterText) {
			var store = new Memory({
				data: this._filterTreeItems(filterText),
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
				"aria-label": "Consultas guardadas",
				getIconClass: function(item, opened) {
					if (item.type === "query") {
						return "dqQueryIcon";
					}
					return opened ? "dijitFolderOpened" : "dijitFolderClosed";
				}
			});
			this._tree.placeAt(this.treeNode);
			this._tree.startup();
		},

		// Conserva las consultas cuyo nombre contiene el texto, junto con sus carpetas/categorías padre.
		_filterTreeItems: function(filterText) {
			var needle = this._normalize(filterText);
			if (!needle) {
				return this._treeItems;
			}
			var byId = {};
			array.forEach(this._treeItems, function(item) {
				byId[item.id] = item;
			});
			var keep = {};
			array.forEach(ROOT_ITEMS, function(item) {
				keep[item.id] = true;
			});
			array.forEach(this._treeItems, function(item) {
				if (item.type === "query" && this._normalize(item.name).indexOf(needle) !== -1) {
					for (var node = item; node && !keep[node.id]; node = byId[node.parent]) {
						keep[node.id] = true;
					}
				}
			}, this);
			return array.filter(this._treeItems, function(item) {
				return keep[item.id];
			});
		},

		// Minúsculas y sin tildes, para que "busqueda" encuentre "Búsqueda".
		_normalize: function(text) {
			return (text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
		}
	});
});
