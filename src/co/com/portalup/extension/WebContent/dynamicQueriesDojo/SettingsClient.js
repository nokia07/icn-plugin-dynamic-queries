define([
	"dojo/Deferred",
	"ecm/model/Request"
],
function(Deferred, Request) {

	// Deben coincidir con DynamicQueries.getId() y SettingsService.getId().
	var PLUGIN_ID = "DynamicQueries";
	var SERVICE_ID = "SettingsService";

	return {
		/**
		 * Configuración del plug-in que necesita el navegador: { repositoryId, projectsApiUrl } ("" si no está
		 * configurado). Se rechaza con { code, message }, donde message es apto para mostrar al usuario.
		 */
		getSettings: function() {
			var deferred = new Deferred();
			Request.invokePluginService(PLUGIN_ID, SERVICE_ID, {
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
				// ICN la invoca con el estado HTTP como texto ("599 Error 599: ...") cuando el servidor responde con error.
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
