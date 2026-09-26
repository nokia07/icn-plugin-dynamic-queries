define([
	"dojo/_base/lang",
	"dojo/Deferred",
	"ecm/model/Request"
],
function(lang, Deferred, Request) {

	// Deben coincidir con DynamicQueries.getId() y QueryStoreService.getId().
	var PLUGIN_ID = "DynamicQueries";
	var SERVICE_ID = "QueryStoreService";

	/**
	 * Llama a QueryStoreService. Devuelve una promesa que se resuelve con los datos o se rechaza con
	 * { status, code, message }, donde message es apto para mostrar al usuario.
	 */
	function call(operation, params, body) {
		var deferred = new Deferred();
		var options = {
			// "operation" y no "action": ICN usa action para el id del servicio y lo sobrescribe.
			requestParams: lang.mixin({ operation: operation }, params),
			requestCompleteCallback: function(response) {
				if (response && response.ok) {
					client.mode = response.mode;
					deferred.resolve(response.data);
				} else {
					deferred.reject((response && response.error) || {
						code: "INVALID_RESPONSE",
						message: "Respuesta inesperada del servidor de ICN."
					});
				}
			},
			requestFailedCallback: function() {
				deferred.reject({ code: "REQUEST_FAILED", message: "No se pudo comunicar con el servidor de ICN." });
			}
		};
		if (body) {
			options.requestBody = JSON.stringify(body);
			Request.postPluginService(PLUGIN_ID, SERVICE_ID, "application/json", options);
		} else {
			Request.invokePluginService(PLUGIN_ID, SERVICE_ID, options);
		}
		return deferred.promise;
	}

	var client = {
		/** "memory" (modo simulado) o "api"; se conoce después de la primera respuesta. */
		mode: null,

		listCategories: function() {
			return call("listCategories");
		},

		/** category: { name, description } */
		createCategory: function(category) {
			return call("createCategory", null, category);
		},

		/** params: { categoryId, name, sort: "name"|"recent", limit, offset } */
		listQueries: function(params) {
			return call("listQueries", params);
		},

		getQuery: function(id) {
			return call("getQuery", { id: id });
		},

		/** query: { id?, version?, name, description, categoryId, definition }. Con id actualiza. */
		saveQuery: function(query) {
			return call("saveQuery", null, query);
		},

		deleteQuery: function(id) {
			return call("deleteQuery", { id: id });
		}
	};

	return client;
});
