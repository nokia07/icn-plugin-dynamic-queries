package co.com.portalup.extension;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import com.ibm.json.java.JSONArray;
import com.ibm.json.java.JSONObject;

/**
 * Configuración del plug-in guardada por ConfigurationPane.js con el formato
 * { "configuration": [ { "name": ..., "value": ... } ] }.
 */
public final class PluginConfiguration {

	/**
	 * URL base del microservicio de DQ, que atiende consultas ({url}/query) y proyectos ({url}/project), p. ej.
	 * http://servidor:8080/api/v1. Lo llama el navegador directamente (DqApiClient.js), así que debe ser accesible desde
	 * el equipo del usuario, permitir CORS desde ICN y ser https: la Content-Security-Policy de ICN bloquea las URL
	 * http: que no sean el propio ICN. El nombre del parámetro se conserva por compatibilidad con configuraciones ya
	 * guardadas.
	 */
	public static final String PROJECTS_API_URL = "projectsApiUrl";
	/** URL de PROJECTS_API_URL mientras el administrador no la guarde (despliegue local). Debe coincidir con ConfigurationPane.js. */
	public static final String DEFAULT_PROJECTS_API_URL = "https://localhost:8443/api/v1";
	/** Id (en ICN) del único repositorio sobre el que se diseñan y ejecutan las consultas. */
	public static final String REPOSITORY_ID = "repositoryId";
	/**
	 * Grupos de P8 (separados por punto y coma o saltos de línea: los DN llevan comas) cuyos miembros pueden usar el diseñador de consultas; vacío =
	 * todos los usuarios. Se comparan sin distinguir mayúsculas con el nombre corto, el nombre y el DN de los grupos.
	 */
	public static final String DESIGNER_GROUPS = "designerGroups";
	/**
	 * URL del servicio que entrega en base64 el contenido de los documentos en S3 (propiedades file_key y storage_name),
	 * el de S3Service de la consulta general: {client.s3.host}/gce-alm/documentos/s3descarga. La llama el servidor de ICN
	 * (DocumentPropertiesService), no el navegador. Vacía: los documentos en S3 no se pueden ver.
	 */
	public static final String S3_DOWNLOAD_URL = "s3DownloadUrl";
	/** Valor de la cabecera x-api-key para S3_DOWNLOAD_URL. Nunca se envía al navegador (salvo a la herramienta de administración). */
	public static final String S3_API_KEY = "s3ApiKey";

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

	/** DESIGNER_GROUPS como lista, sin vacíos; vacía si no hay restricción. */
	public static List<String> getDesignerGroups(JSONObject config) {
		List<String> groups = new ArrayList<String>();
		for (String group : get(config, DESIGNER_GROUPS).split("[;\\r\\n]+")) {
			if (group.trim().length() > 0) {
				groups.add(group.trim());
			}
		}
		return groups;
	}

	/** Valor sin espacios, o "" si no está configurado. */
	public static String get(JSONObject config, String name) {
		Object value = config.get(name);
		return value == null ? "" : value.toString().trim();
	}
}
