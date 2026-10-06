package co.com.portalup.extension;

import java.io.IOException;

import com.ibm.json.java.JSONArray;
import com.ibm.json.java.JSONObject;

/**
 * Configuración del plug-in guardada por ConfigurationPane.js con el formato
 * { "configuration": [ { "name": ..., "value": ... } ] }.
 */
public final class PluginConfiguration {

	/** URL base de la API de consultas; vacía = modo simulado en memoria. */
	public static final String API_URL = "apiUrl";
	/** Token de servicio (Bearer) para la API. */
	public static final String API_TOKEN = "apiToken";
	public static final String TIMEOUT_SECONDS = "timeoutSeconds";
	/**
	 * URL base del microservicio de proyectos (p. ej. http://servidor:8080/api/v1). Lo llama el navegador directamente
	 * (ProjectServiceClient.js), así que debe ser accesible desde el equipo del usuario, permitir CORS desde ICN y ser
	 * https: la Content-Security-Policy de ICN bloquea las URL http: que no sean el propio ICN.
	 */
	public static final String PROJECTS_API_URL = "projectsApiUrl";
	/** URL de PROJECTS_API_URL mientras el administrador no la guarde (despliegue local). Debe coincidir con ConfigurationPane.js. */
	public static final String DEFAULT_PROJECTS_API_URL = "https://localhost:8443/api/v1";
	/** Id (en ICN) del único repositorio sobre el que se diseñan y ejecutan las consultas. */
	public static final String REPOSITORY_ID = "repositoryId";

	private PluginConfiguration() {
	}

	/**
	 * Convierte la configuración guardada (PluginServiceCallbacks.loadConfiguration()) en { nombre: valor }; vacía si
	 * el administrador aún no la guardó.
	 */
	public static JSONObject parse(String configuration) throws IOException {
		JSONObject values = new JSONObject();
		if (configuration == null || configuration.trim().length() == 0) {
			return values;
		}
		Object entries = JSONObject.parse(configuration).get("configuration");
		if (entries instanceof JSONArray) {
			for (Object entry : (JSONArray) entries) {
				if (entry instanceof JSONObject && ((JSONObject) entry).get("name") != null) {
					values.put(((JSONObject) entry).get("name"), ((JSONObject) entry).get("value"));
				}
			}
		}
		return values;
	}

	/** PROJECTS_API_URL, o la predeterminada si la configuración nunca la guardó; "" si el administrador la dejó vacía. */
	public static String getProjectsApiUrl(JSONObject config) {
		return config.containsKey(PROJECTS_API_URL) ? get(config, PROJECTS_API_URL) : DEFAULT_PROJECTS_API_URL;
	}

	/** Valor sin espacios, o "" si no está configurado. */
	public static String get(JSONObject config, String name) {
		Object value = config.get(name);
		return value == null ? "" : value.toString().trim();
	}
}
