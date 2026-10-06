define([
	"dojo/Deferred",
	"dojo/request/xhr"
],
function(Deferred, xhr) {

	/**
	 * Llama al microservicio de proyectos directamente desde el navegador (no pasa por el servidor de ICN), así que la
	 * URL debe ser accesible desde el equipo del usuario y el servicio debe permitir CORS desde el origen de ICN.
	 * Igual que QueryStoreClient, rechaza con { status, code, message }, donde message es apto para mostrar al usuario.
	 */
	var client = {
		/** URL base configurada en el plug-in (projectsApiUrl); la fija DQ tras getSettings. "" = no configurado. */
		baseUrl: null,

		/** Proyectos { id, name, description, status, createdAt }; status opcional: "ACTIVE" | "INACTIVE". */
		listProjects: function(status) {
			return send("GET", "/project" + (status ? "?status=" + encodeURIComponent(status) : ""));
		},

		getProject: function(id) {
			return send("GET", "/project/" + encodeURIComponent(id));
		},

		/** project: { name, description, status? } (sin status queda ACTIVE). Se resuelve con el proyecto creado. */
		createProject: function(project) {
			return send("POST", "/project", project);
		},

		/** project: { name, description, status? } (sin status se conserva). Se resuelve con el proyecto actualizado. */
		updateProject: function(id, project) {
			return send("PUT", "/project/" + encodeURIComponent(id), project);
		},

		deleteProject: function(id) {
			return send("DELETE", "/project/" + encodeURIComponent(id));
		}
	};

	function send(method, path, body) {
		var deferred = new Deferred();
		if (!client.baseUrl) {
			deferred.reject({
				code: "NOT_CONFIGURED",
				message: "El servicio de proyectos no está configurado. Pida al administrador que configure su URL en el plug-in."
			});
			return deferred.promise;
		}
		var url = client.baseUrl.replace(/\/+$/, "") + path;
		var headers = {
			"Accept": "application/json",
			// dojo/request lo agrega por defecto y obligaría al servicio a permitirlo también en CORS.
			"X-Requested-With": null
		};
		if (body) {
			headers["Content-Type"] = "application/json";
		}
		xhr(url, {
			method: method,
			data: body ? JSON.stringify(body) : null,
			handleAs: "text",
			headers: headers
		}).response.then(function(response) {
			// dojo/request trata el estado 0 como éxito (por file://), pero aquí significa que el navegador no obtuvo
			// respuesta.
			if (!response.status) {
				fail(response);
				return;
			}
			var text = response.text;
			deferred.resolve(text && text.trim() ? JSON.parse(text) : null);
		}, function(error) {
			fail(error.response);
		});
		return deferred.promise;

		function fail(response) {
			var status = response && response.status;
			if (!status) {
				// Sin estado: el servicio no responde o el navegador bloqueó la solicitud (CSP de ICN si la URL no es
				// https, certificado no aceptado o CORS).
				deferred.reject({
					status: 0,
					code: "SERVICE_UNAVAILABLE",
					message: "No se pudo comunicar con el servicio de proyectos (" + url + "). Verifique que esté en " +
						"ejecución, que use https, que el navegador acepte su certificado y que permita solicitudes " +
						"(CORS) desde ICN."
				});
				return;
			}
			// ErrorResponse del servicio: { status, error, message, details[] }; details trae los errores de validación.
			var data = null;
			try {
				data = JSON.parse(response.text);
			} catch (e) {
				// Cuerpo que no es JSON: se usa el mensaje genérico.
			}
			var message = data && typeof data.message === "string" ? data.message :
				"El servicio de proyectos respondió con un error (HTTP " + status + ").";
			if (data && data.details instanceof Array && data.details.length) {
				message += " " + data.details.join(" ");
			}
			deferred.reject({
				status: status,
				code: data && typeof data.error === "string" ? data.error : "HTTP_" + status,
				message: message
			});
		}
	}

	return client;
});
