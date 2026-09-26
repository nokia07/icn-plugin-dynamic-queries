define([
	"dojo/_base/declare",
	"dojo/_base/lang",
	"dojo/_base/array",
	"dojo/dom-class",
	"dojo/dom-construct",
	"dijit/Dialog",
	"dijit/form/Button",
	"ecm/widget/search/SearchBuilder",
	"dynamicQueriesDojo/QuerySerializer"
],
function(declare, lang, array, domClass, domConstruct, Dialog, Button, SearchBuilder, QuerySerializer) {

	/**
	 * @name dynamicQueriesDojo.QueryTab
	 * @class Pestaña de una consulta: el constructor de búsqueda nativo de ICN (criterios, Buscar y resultados) sin
	 *        las opciones de guardar en P8, porque las consultas de DQ se guardan en el servicio externo.
	 *        Ver docs/icn-search-api.md.
	 * @augments ecm.widget.search.SearchBuilder
	 */
	return declare("dynamicQueriesDojo.QueryTab", [ SearchBuilder ], {
		/** @lends dynamicQueriesDojo.QueryTab.prototype */

		postCreate: function() {
			this.inherited(arguments);
			var searchDefinition = this.searchDefinition;
			// Con clase y no con estilo en línea: Restablecer vuelve a mostrar estos botones.
			domClass.add(searchDefinition.saveButton.domNode, "dqHiddenAction");
			domClass.add(searchDefinition.saveAsButton.domNode, "dqHiddenAction");

			var viewJsonButton = new Button({
				label: "Ver JSON",
				onClick: lang.hitch(this, this._showJson)
			});
			this.own(viewJsonButton);
			viewJsonButton.placeAt(searchDefinition.cancelButton.domNode, "after");
		},

		// dijit/layout/TabContainer.closeChild solo cierra la pestaña si onClose devuelve true; SearchBuilder no lo
		// define porque en ICN lo cierra SearchTabContainer.
		onClose: function() {
			return true;
		},

		/**
		 * Definición de la consulta según el contrato de la API: { definition, errors }.
		 */
		getQueryDefinition: function() {
			return QuerySerializer.serialize(this.searchDefinition, this.repository);
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
