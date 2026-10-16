package co.com.portalup.extension;

import java.io.IOException;
import java.io.PrintWriter;
import java.util.List;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import com.ibm.ecm.extension.PluginLogger;
import com.ibm.ecm.extension.PluginService;
import com.ibm.ecm.extension.PluginServiceCallbacks;
import com.ibm.json.java.JSONObject;

/**
 * Entrega al navegador la configuración del plug-in que necesita el feature DQ: { repositoryId, projectsApiUrl,
 * canDesign }. canDesign dice si el usuario puede usar el diseñador: siempre si no hay grupos configurados
 * (PluginConfiguration.DESIGNER_GROUPS); si los hay, solo si pertenece a alguno en el repositorio de las consultas.
 * Las consultas y los proyectos los guarda el microservicio de DQ, al que el navegador llama directamente.
 *
 * La respuesta siempre es HTTP 200 con { ok: true, data } o { ok: false, error: { status, code, message } }, para que
 * el cliente muestre el error en su propio diálogo.
 */
public class SettingsService extends PluginService {

	/** Grupos de P8 del usuario conectado; interfaz para poder probar handle sin ICN. */
	interface UserGroups {
		List<String> fetch(String repositoryId) throws Exception;
	}

	public String getId() {
		return "SettingsService";
	}

	public void execute(PluginServiceCallbacks callbacks, HttpServletRequest request, HttpServletResponse response)
			throws Exception {
		PluginLogger logger = callbacks.getLogger();
		JSONObject result;
		try {
			final PluginServiceCallbacks serviceCallbacks = callbacks;
			result = handle(callbacks.loadConfiguration(), new UserGroups() {
				public List<String> fetch(String repositoryId) {
					return P8UserGroups.fetch(serviceCallbacks, repositoryId);
				}
			});
		} catch (Throwable t) {
			// También errores de la JVM (NoClassDefFoundError, NoSuchMethodError...), que catch (Exception) no atrapa:
			// sin esto ICN responde HTTP 599 sin cuerpo y el detalle solo queda en el log del servidor.
			logger.logError(this, "execute", "Error al leer la configuración del plug-in", t);
			result = new JSONObject();
			result.put("ok", Boolean.FALSE);
			result.put("error", error(500, "INTERNAL_ERROR",
					"Error inesperado al leer la configuración del plug-in (" + t.getClass().getName() + ": " + t.getMessage() + ")."));
		}
		response.setContentType("application/json");
		response.setCharacterEncoding("UTF-8");
		// toString() y no serialize(Writer): es lo que usan los plug-ins que ya funcionan en el servidor (PortalUpICN).
		PrintWriter writer = response.getWriter();
		try {
			writer.print(result.toString());
			writer.flush();
		} finally {
			writer.close();
		}
	}

	/** Lógica del servicio, separada de PluginServiceCallbacks (que solo existe dentro de ICN) para poder probarla. */
	JSONObject handle(String configuration, UserGroups userGroups) throws IOException {
		JSONObject config = PluginConfiguration.parse(configuration);
		String repositoryId = PluginConfiguration.get(config, PluginConfiguration.REPOSITORY_ID);
		JSONObject settings = new JSONObject();
		settings.put("repositoryId", repositoryId);
		settings.put("projectsApiUrl", PluginConfiguration.getProjectsApiUrl(config));
		JSONObject result = new JSONObject();
		List<String> designerGroups = PluginConfiguration.getDesignerGroups(config);
		boolean canDesign = designerGroups.isEmpty();
		// Sin repositorio no hay dónde buscar los grupos; el cliente ya muestra que falta configurarlo.
		if (!canDesign && repositoryId.length() > 0) {
			try {
				canDesign = isMemberOfAny(userGroups.fetch(repositoryId), designerGroups);
			} catch (Exception e) {
				result.put("ok", Boolean.FALSE);
				result.put("error", error(500, "USER_GROUPS_UNAVAILABLE",
						"No se pudieron leer los grupos del usuario en el repositorio " + repositoryId + ": " + e.getMessage()));
				return result;
			}
		}
		settings.put("canDesign", Boolean.valueOf(canDesign));
		result.put("ok", Boolean.TRUE);
		result.put("data", settings);
		return result;
	}

	private static boolean isMemberOfAny(List<String> userGroups, List<String> allowedGroups) {
		for (String userGroup : userGroups) {
			for (String allowedGroup : allowedGroups) {
				if (userGroup.equalsIgnoreCase(allowedGroup)) {
					return true;
				}
			}
		}
		return false;
	}

	private static JSONObject error(int status, String code, String message) {
		JSONObject error = new JSONObject();
		error.put("status", (long) status);
		error.put("code", code);
		error.put("message", message);
		return error;
	}
}
