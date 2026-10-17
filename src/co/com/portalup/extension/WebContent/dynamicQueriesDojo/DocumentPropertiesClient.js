define([
	"dojo/Deferred",
	"dojo/json",
	"ecm/model/Request"
],
function(Deferred, JSON, Request) {

	// Deben coincidir con DynamicQueries.getId() y DocumentPropertiesService.getId().
	var PLUGIN_ID = "DynamicQueries";
	var SERVICE_ID = "DocumentPropertiesService";

	return {
		/**
		 * Propiedades de un documento del repositorio del plug-in, leídas con la sesión de P8 del usuario, y su contenido
		 * en base64 si está en S3. Se resuelve con { properties: [ { name, label, value } ], s3, mimeType, file,
		 * fileError } y se rechaza con { code, message }.
		 */
		getProperties: function(documentId) {
			var deferred = new Deferred();
			Request.postPluginService(PLUGIN_ID, SERVICE_ID, "application/json", {
				requestBody: JSON.stringify({ documentId: documentId }),
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
