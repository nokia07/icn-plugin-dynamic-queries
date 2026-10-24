define([
	"dojo/Deferred",
	"dojo/json",
	"ecm/model/Request"
],
function(Deferred, JSON, Request) {

	// Deben coincidir con DynamicQueries.getId() y DocumentPropertiesService.getId().
	var PLUGIN_ID = "DynamicQueries";
	var SERVICE_ID = "DocumentPropertiesService";

	function post(body) {
		var deferred = new Deferred();
		Request.postPluginService(PLUGIN_ID, SERVICE_ID, "application/json", {
			requestBody: JSON.stringify(body),
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

	return {
		/**
		 * Propiedades de un documento del repositorio del plug-in, leídas con la sesión de P8 del usuario, y su contenido
		 * si está en S3, en base64 (file): el de file_key o, si tiene file_key_multivalue, el PDF compuesto (composed son
		 * los datos de la composición). Se resuelve con { properties: [ { name, label, value } ], s3, mimeType, file,
		 * composed: { pages, sizeBytes, reused }, composePending, releasedId, fileError } y se rechaza con
		 * { code, message }. Con compose false no se pide otra composición (ya se está esperando una).
		 */
		getProperties: function(documentId, compose) {
			var body = { documentId: documentId };
			if (compose === false) {
				body.compose = false;
			}
			return post(body);
		},

		/** Versión liberada de la serie de versiones del documento: se resuelve con { id, majorVersion }. */
		getReleasedVersion: function(documentId) {
			return post({ documentId: documentId, releasedVersion: true });
		}
	};
});
