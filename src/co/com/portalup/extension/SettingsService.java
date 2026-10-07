package co.com.portalup.extension;

import java.io.IOException;
import java.io.PrintWriter;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

import com.ibm.ecm.extension.PluginLogger;
import com.ibm.ecm.extension.PluginService;
import com.ibm.ecm.extension.PluginServiceCallbacks;
import com.ibm.json.java.JSONObject;

/**
 * Entrega al navegador la configuración del plug-in que necesita el feature DQ: { repositoryId, projectsApiUrl }.
 * Las consultas y los proyectos los guarda el microservicio de DQ, al que el navegador llama directamente.
 *
 * La respuesta siempre es HTTP 200 con { ok: true, data } o { ok: false, error: { status, code, message } }, para que
 * el cliente muestre el error en su propio diálogo.
 */
public class SettingsService extends PluginService {

	public String getId() {
		return "SettingsService";
	}

	public void execute(PluginServiceCallbacks callbacks, HttpServletRequest request, HttpServletResponse response)
			throws Exception {
		PluginLogger logger = callbacks.getLogger();
		JSONObject result;
		try {
			result = handle(callbacks.loadConfiguration());
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
	JSONObject handle(String configuration) throws IOException {
		JSONObject config = PluginConfiguration.parse(configuration);
		JSONObject settings = new JSONObject();
		settings.put("repositoryId", PluginConfiguration.get(config, PluginConfiguration.REPOSITORY_ID));
		settings.put("projectsApiUrl", PluginConfiguration.getProjectsApiUrl(config));
		JSONObject result = new JSONObject();
		result.put("ok", Boolean.TRUE);
		result.put("data", settings);
		return result;
	}

	private static JSONObject error(int status, String code, String message) {
		JSONObject error = new JSONObject();
		error.put("status", (long) status);
		error.put("code", code);
		error.put("message", message);
		return error;
	}
}
