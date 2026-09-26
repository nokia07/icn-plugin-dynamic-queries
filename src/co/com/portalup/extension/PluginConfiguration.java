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

	/** Valor sin espacios, o "" si no está configurado. */
	public static String get(JSONObject config, String name) {
		Object value = config.get(name);
		return value == null ? "" : value.toString().trim();
	}
}
