define([
	"dojo/Deferred",
	"dojo/json",
	"ecm/model/Request"
],
function(Deferred, JSON, Request) {

	// Deben coincidir con DynamicQueries.getId() y ExecuteQueriesService.getId().
	var PLUGIN_ID = "DynamicQueries";
	var SERVICE_ID = "ExecuteQueriesService";

	return {
		/**
		 * Ejecuta las consultas en el repositorio del plug-in con la sesión de P8 del usuario: queries es
		 * [ { name, cesql, config } ] (cesql con los comodines ya reemplazados, config la ruta de agrupación). Se
		 * resuelve con { tree, failures: [ { name, message } ], truncated: [ name ] } y se rechaza con { code, message }.
		 */
		execute: function(queries) {
			var deferred = new Deferred();
			Request.postPluginService(PLUGIN_ID, SERVICE_ID, "application/json", {
				requestBody: JSON.stringify({ queries: queries }),
				requestCompleteCallback: function(response) {
					if (response && response.ok) {
						deferred.resolve(response.data);
					} else {
						deferred.reject((response && response.error) || {
							code: "INVALID_RESPONSE",
							message: "Respuesta inesperada del servidor de ICN."
						});
					}
				},
				// Como en SettingsClient: ICN la invoca con el estado HTTP como texto cuando el servidor responde con error.
				requestFailedCallback: function(response) {
					var status = /^\s*(\d{3})/.exec(typeof response === "string" ? response : "");
					deferred.reject({
						code: "REQUEST_FAILED",
						message: "No se pudo comunicar con el servidor de ICN" + (status ? " (HTTP " + status[1] + ")" : "") + "."
					});
				}
			});
			return deferred.promise;
		}
	};
});
