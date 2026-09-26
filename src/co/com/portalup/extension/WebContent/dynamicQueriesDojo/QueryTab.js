define([
	"dojo/_base/declare",
	"dojo/dom-style",
	"ecm/widget/search/SearchBuilder"
],
function(declare, domStyle, SearchBuilder) {

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
			domStyle.set(this.searchDefinition.saveButton.domNode, "display", "none");
			domStyle.set(this.searchDefinition.saveAsButton.domNode, "display", "none");
		},

		// dijit/layout/TabContainer.closeChild solo cierra la pestaña si onClose devuelve true; SearchBuilder no lo
		// define porque en ICN lo cierra SearchTabContainer.
		onClose: function() {
			return true;
		}
	});
});
