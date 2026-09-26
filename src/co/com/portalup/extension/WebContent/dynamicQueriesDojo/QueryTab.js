define([
	"dojo/_base/declare",
	"dijit/_WidgetBase",
	"dijit/_TemplatedMixin",
	"dojo/text!./templates/QueryTab.html"
],
function(declare, _WidgetBase, _TemplatedMixin, template) {

	/**
	 * @name dynamicQueriesDojo.QueryTab
	 * @class Pestaña de una consulta dentro del feature DQ. En la Fase 2 aloja el constructor de búsqueda nativo
	 *        de ICN; por ahora solo muestra el repositorio de trabajo.
	 */
	return declare("dynamicQueriesDojo.QueryTab", [ _WidgetBase, _TemplatedMixin ], {
		/** @lends dynamicQueriesDojo.QueryTab.prototype */

		templateString: template,

		// ecm.model.Repository sobre el que se construye la consulta.
		repository: null,

		postCreate: function() {
			this.inherited(arguments);
			this.repositoryNameNode.textContent = this.repository ? this.repository.name : "(sin repositorio)";
		}
	});
});
