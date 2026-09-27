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
			// "operation" y no "action": ICN usa action para el id del servicio y lo sobrescribe. repositoryId lo
			// necesita ICN en el servidor para identificar al usuario (PluginServiceCallbacks.getUserId).
			requestParams: lang.mixin({ operation: operation, repositoryId: client.repositoryId || "" }, params),
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
			// ICN la invoca con el estado HTTP como texto ("599 Error 599: ...") cuando el servidor responde con error.
			requestFailedCallback: function(response) {
				var status = /^\s*(\d{3})/.exec(typeof response === "string" ? response : "");
				deferred.reject({
					code: "REQUEST_FAILED",
					message: "No se pudo comunicar con el servidor de ICN" + (status ? " (HTTP " + status[1] + ")" : "") + "."
				});
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

		/** Repositorio configurado del plug-in; lo fija DQ tras getSettings. Todas las operaciones salvo getSettings lo
		 *  necesitan. */
		repositoryId: null,

		/** { repositoryId }: configuración del plug-in que necesita el navegador ("" si no está configurado). */
		getSettings: function() {
			return call("getSettings");
		},

		/** params: { name, sort: "name"|"recent", limit, offset } */
		listQueries: function(params) {
			return call("listQueries", params);
		},

		getQuery: function(id) {
			return call("getQuery", { id: id });
		},

		/** query: { id?, version?, name, description, definition }. Con id actualiza. */
		saveQuery: function(query) {
			return call("saveQuery", null, query);
		},

		deleteQuery: function(id) {
			return call("deleteQuery", { id: id });
		}
	};

	return client;
});
